import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// SemVer 2.0.0, including prerelease and build metadata; tags always start with v.
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function releaseInfo(tag) {
  const match = typeof tag === 'string' && tag.startsWith('v') && semver.exec(tag.slice(1));
  if (!match) throw Error('Release tag must be v followed by a valid SemVer, for example v0.10.1 or v0.11.0-beta.1');
  return {tag, version: tag.slice(1), prerelease: Boolean(match[4]), core: match.slice(1, 4)};
}

export function validateProject(tag, root = process.cwd()) {
  const info = releaseInfo(tag);
  const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const lock = json('package-lock.json');
  const source = readFileSync(join(root, 'internal/app/version.go'), 'utf8');
  const app = readFileSync(join(root, 'internal/app/app.go'), 'utf8');
  const goVersion = source.match(/^var Version = "([^"]+)"$/m)?.[1];
  const versions = {
    'mygo.json': json('mygo.json').version,
    'package.json': json('package.json').version,
    'package-lock.json': lock.version,
    'package-lock.json packages[""]': lock.packages?.['']?.version,
    'internal/app/version.go': goVersion,
  };
  for (const [file, version] of Object.entries(versions)) {
    if (version !== info.version) throw Error(`${file} version ${JSON.stringify(version)} must match ${info.version}`);
  }
  if (!/mygo\.App\.SetVersion\(Version\)/.test(app)) throw Error('Application must use SetVersion(Version) so runtime and bundle versions agree');
  return info;
}

export function expectedAssets(tag) {
  releaseInfo(tag);
  return ['arm64', 'x86_64'].flatMap(arch => ['dmg', 'zip'].map(ext => `ciip-${tag}-macos-${arch}.${ext}`)).sort();
}

const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export function prepareAssets(tag, directory) {
  const names = expectedAssets(tag);
  const allowed = new Set([...names, 'SHA256SUMS']);
  for (const name of readdirSync(directory)) {
    if (!allowed.has(name)) throw Error(`Unexpected release asset: ${name}`);
  }
  for (const name of names) {
    if (!statSync(join(directory, name)).isFile() || !statSync(join(directory, name)).size) throw Error(`Empty release asset: ${name}`);
  }
  // Only write the manifest after every architecture and file is present.
  writeFileSync(join(directory, 'SHA256SUMS'), names.map(name => `${digest(join(directory, name))}  ${name}\n`).join(''));
  return [...names, 'SHA256SUMS'];
}

export function shouldMarkLatest(info, currentTag) {
  if (info.prerelease) return false;
  if (!currentTag) return true;
  let current;
  try { current = releaseInfo(currentTag); } catch { return false; }
  for (let i = 0; i < 3; i++) {
    if (BigInt(info.core[i]) !== BigInt(current.core[i])) return BigInt(info.core[i]) > BigInt(current.core[i]);
  }
  return info.tag === currentTag;
}

function github(args, allow404 = false) {
  const result = spawnSync('gh', args, {encoding: 'utf8'});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allow404 && /\(HTTP 404\)/.test(result.stderr)) return null;
    throw Error(`gh ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function verifyRemoteAssets(release, names, directory, checkDigests) {
  const assets = release.assets ?? [];
  if (assets.length !== names.length || !names.every(name => assets.some(asset => asset.name === name && asset.size > 0))) {
    throw Error('Release must contain exactly both architecture ZIPs and DMGs plus SHA256SUMS');
  }
  if (checkDigests) {
    for (const asset of assets) {
      if (asset.digest !== `sha256:${digest(join(directory, asset.name))}`) throw Error(`Uploaded asset digest does not match: ${asset.name}`);
    }
  }
}

export function publishRelease(tag, directory, repository, run = github) {
  const info = releaseInfo(tag);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw Error('GITHUB_REPOSITORY must be owner/repository');
  // Never contact GitHub until the complete local set has passed validation.
  const names = prepareAssets(tag, directory);
  const view = () => {
    // The tag endpoint only finds published releases. The authenticated list
    // includes drafts, so interrupted uploads can resume before publication.
    // Filter each page in gh, keeping other releases out of the stdout buffer.
    const raw = run(['api', `repos/${repository}/releases?per_page=100`, '--paginate',
      '--jq', `.[] | select(.tag_name == ${JSON.stringify(tag)})`]);
    return raw.trim() ? JSON.parse(raw) : null;
  };
  let release = view();
  if (release && !release.draft) {
    verifyRemoteAssets(release, names, directory, false);
    if (release.prerelease !== info.prerelease) throw Error('Existing published release has a different prerelease state');
    // A published release can be immutable. Reruns never replace its binaries.
    return 'already published';
  }
  const notes = join(resolve(directory, '..'), 'release-notes.md');
  writeFileSync(notes, `ciip ${tag}\n\n` +
    '- Apple Silicon (M1 and later): choose the arm64 DMG or ZIP.\n' +
    '- Intel Mac: choose the x86_64 DMG or ZIP.\n' +
    '- Open the DMG and drag ciip.app to Applications, or extract the ZIP.\n' +
    '- SHA256SUMS contains the SHA-256 checksums of all four downloads.\n\n' +
    'These builds have an ad hoc signature and are not notarized by Apple. macOS may block first launch. ' +
    'See Apple’s guidance for opening an app from an unidentified developer: ' +
    'https://support.apple.com/guide/mac-help/mh40616/mac\n');
  if (!release) {
    run(['release', 'create', tag, '--repo', repository, '--verify-tag', '--draft', '--latest=false',
      '--title', `ciip ${tag}`, '--notes-file', notes, ...(info.prerelease ? ['--prerelease'] : [])]);
  }
  run(['release', 'upload', tag, '--repo', repository, '--clobber', ...names.map(name => join(directory, name))]);
  release = view();
  if (!release?.draft) throw Error('Expected a draft release before publishing');
  verifyRemoteAssets(release, names, directory, true);
  const latestRaw = run(['api', `repos/${repository}/releases/latest`], true);
  const latestTag = latestRaw === null ? null : JSON.parse(latestRaw).tag_name;
  run(['release', 'edit', tag, '--repo', repository, '--verify-tag', '--draft=false',
    `--prerelease=${info.prerelease}`, `--latest=${shouldMarkLatest(info, latestTag)}`, '--notes-file', notes]);
  return 'published';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, tag, directory] = process.argv.slice(2);
    if (command === 'validate') console.log(JSON.stringify(validateProject(tag)));
    else if (command === 'publish') {
      validateProject(tag);
      if (!directory) throw Error('Release asset directory is required');
      console.log(publishRelease(tag, directory, process.env.GITHUB_REPOSITORY));
    } else throw Error('Usage: node scripts/release.mjs validate vX.Y.Z | publish vX.Y.Z <asset-directory>');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
