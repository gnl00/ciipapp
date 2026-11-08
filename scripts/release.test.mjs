import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {expectedAssets, prepareAssets, publishRelease, releaseInfo, shouldMarkLatest, validateProject} from './release.mjs';

function fixture(t, version = '0.10.1') {
  const root = mkdtempSync(join(tmpdir(), 'ciip-release-test-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'internal/app'), {recursive: true});
  const json = (name, value) => writeFileSync(join(root, name), JSON.stringify(value));
  json('mygo.json', {version});
  json('package.json', {version});
  json('package-lock.json', {version, packages: {'': {version}}});
  writeFileSync(join(root, 'internal/app/version.go'), `package app\nvar Version = "${version}"\n`);
  writeFileSync(join(root, 'internal/app/app.go'), 'package app\nfunc Run() { mygo.App.SetVersion(Version) }\n');
  const directory = join(root, 'assets');
  mkdirSync(directory);
  const tag = `v${version}`;
  for (const name of expectedAssets(tag)) writeFileSync(join(directory, name), `fixture:${name}`);
  return {root, directory, tag};
}

function fakeGitHub(directory, {tag = 'v0.10.1', existing = null, latest = null, failUpload = false, corrupt = false, olderReleases = []} = {}) {
  let release = existing;
  const calls = [];
  const run = args => {
    calls.push(args);
    if (args[0] === 'api') {
      if (args[1].endsWith('/latest')) return latest === null ? null : JSON.stringify(latest);
      // Match REST behavior: tag lookups never return an unpublished draft.
      assert.ok(args[1].endsWith('/releases?per_page=100'));
      assert.ok(args.includes('--paginate'));
      assert.equal(args[args.indexOf('--jq') + 1], `.[] | select(.tag_name == ${JSON.stringify(tag)})`);
      const result = [...olderReleases, ...(release ? [{...release, tag_name: tag}] : [])].find(item => item.tag_name === tag);
      return result ? JSON.stringify(result) : '';
    }
    if (args[1] === 'create') { release = {draft: true, assets: []}; return ''; }
    if (args[1] === 'upload') {
      if (failUpload) throw Error('simulated upload failure');
      const names = [...expectedAssets(args[2]), 'SHA256SUMS'];
      release.assets = names.map(name => {
        const data = readFileSync(join(directory, name));
        return {name, size: data.length, digest: `sha256:${createHash('sha256').update(data).digest('hex')}`};
      });
      if (corrupt) release.assets[0].digest = 'sha256:invalid';
      return '';
    }
    if (args[1] === 'edit') { release.draft = false; return ''; }
    throw Error(`Unexpected gh arguments: ${args}`);
  };
  return {calls, run};
}

test('only complete SemVer tags are accepted, including prereleases', () => {
  assert.equal(releaseInfo('v1.2.3').prerelease, false);
  assert.equal(releaseInfo('v1.2.3-beta.1+build.7').prerelease, true);
  assert.equal(releaseInfo('v0.0.0+7').version, '0.0.0+7');
  for (const tag of ['1.2.3', 'v1.2', 'v01.2.3', 'v1.02.3', 'v1.2.3-01', 'v1.2.3-beta.01', 'v1.2.3-', 'v1.2.3\nX=Y']) assert.throws(() => releaseInfo(tag));
});

test('tag, runtime source, bundle and npm versions must match', t => {
  const {root, tag} = fixture(t);
  assert.equal(validateProject(tag, root).version, '0.10.1');
  assert.throws(() => validateProject('v0.10.2', root), /must match/);
  writeFileSync(join(root, 'internal/app/version.go'), 'package app\nvar Version = "0.10.0"\n');
  assert.throws(() => validateProject(tag, root), /internal\/app\/version.go/);
});

test('an outdated lockfile or independent SetVersion override blocks release', t => {
  const {root, tag} = fixture(t);
  const path = join(root, 'package-lock.json');
  const lock = JSON.parse(readFileSync(path, 'utf8'));
  lock.packages[''].version = '0.10.0';
  writeFileSync(path, JSON.stringify(lock));
  assert.throws(() => validateProject(tag, root), /packages\[""\]/);
  lock.packages[''].version = '0.10.1';
  writeFileSync(path, JSON.stringify(lock));
  writeFileSync(join(root, 'internal/app/app.go'), 'mygo.App.SetVersion("0.10.1")');
  assert.throws(() => validateProject(tag, root), /SetVersion\(Version\)/);
});

test('checksums contain exactly four architecture downloads', t => {
  const {directory, tag} = fixture(t);
  const names = prepareAssets(tag, directory);
  assert.equal(names.length, 5);
  const lines = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 4);
  for (const line of lines) {
    const [hash, name] = line.split('  ');
    assert.equal(hash, createHash('sha256').update(readFileSync(join(directory, name))).digest('hex'));
  }
});

test('a missing architecture blocks all GitHub mutations', t => {
  const {directory, tag} = fixture(t);
  rmSync(join(directory, expectedAssets(tag)[0]));
  const gh = fakeGitHub(directory);
  assert.throws(() => publishRelease(tag, directory, 'gnl00/ciipapp', gh.run));
  assert.equal(gh.calls.length, 0);
});

test('unexpected or empty files cannot enter the release', t => {
  const {directory, tag} = fixture(t);
  writeFileSync(join(directory, 'debug.log'), 'private debug output');
  assert.throws(() => prepareAssets(tag, directory), /Unexpected/);
  rmSync(join(directory, 'debug.log'));
  writeFileSync(join(directory, expectedAssets(tag)[0]), '');
  assert.throws(() => prepareAssets(tag, directory), /Empty/);
});

test('publish creates a draft, uploads all assets, verifies their digests, then publishes', t => {
  const {directory, tag} = fixture(t);
  const gh = fakeGitHub(directory);
  assert.equal(publishRelease(tag, directory, 'gnl00/ciipapp', gh.run), 'published');
  assert.deepEqual(gh.calls.filter(args => args[0] === 'release').map(args => args[1]), ['create', 'upload', 'edit']);
  assert.ok(gh.calls.find(args => args[1] === 'create').includes('--draft'));
  assert.ok(gh.calls.find(args => args[1] === 'create').includes('--verify-tag'));
  assert.ok(gh.calls.at(-1).includes('--draft=false'));
  assert.ok(gh.calls.at(-1).includes('--latest=true'));
});

test('upload failure or mismatched remote digest leaves the draft unpublished', t => {
  const {directory, tag} = fixture(t);
  for (const options of [{failUpload: true}, {corrupt: true}]) {
    const gh = fakeGitHub(directory, options);
    assert.throws(() => publishRelease(tag, directory, 'gnl00/ciipapp', gh.run));
    assert.equal(gh.calls.some(args => args[1] === 'edit'), false);
  }
});

test('a failed draft upload can be retried without creating a second release', t => {
  const {directory, tag} = fixture(t);
  const gh = fakeGitHub(directory, {existing: {draft: true, assets: []}});
  assert.equal(publishRelease(tag, directory, 'gnl00/ciipapp', gh.run), 'published');
  assert.equal(gh.calls.some(args => args[1] === 'create'), false);
  assert.ok(gh.calls.find(args => args[1] === 'upload').includes('--clobber'));
});

test('a draft beyond the first release page is found before uploading', t => {
  const {directory, tag} = fixture(t);
  const gh = fakeGitHub(directory, {
    existing: {draft: true, assets: []},
    olderReleases: Array.from({length: 100}, (_, i) => ({tag_name: `v0.9.${i}`, draft: false})),
  });
  assert.equal(publishRelease(tag, directory, 'gnl00/ciipapp', gh.run), 'published');
  assert.equal(gh.calls.some(args => args[1] === 'create'), false);
});

test('rerunning a completed published release preserves immutable binaries', t => {
  const {directory, tag} = fixture(t);
  const gh = fakeGitHub(directory, {existing: {draft: false, prerelease: false, assets: [...expectedAssets(tag), 'SHA256SUMS'].map(name => ({name, size: 1}))}});
  assert.equal(publishRelease(tag, directory, 'gnl00/ciipapp', gh.run), 'already published');
  assert.equal(gh.calls.length, 1);
  const incomplete = fakeGitHub(directory, {existing: {draft: false, prerelease: false, assets: []}});
  assert.throws(() => publishRelease(tag, directory, 'gnl00/ciipapp', incomplete.run), /exactly/);
  assert.equal(incomplete.calls.length, 1);
});

test('prereleases never replace latest and old stable tags do not displace newer versions', t => {
  const {directory, tag} = fixture(t, '0.11.0-beta.1');
  const gh = fakeGitHub(directory, {tag, latest: {tag_name: 'v0.10.1'}});
  publishRelease(tag, directory, 'gnl00/ciipapp', gh.run);
  assert.ok(gh.calls.at(-1).includes('--prerelease=true'));
  assert.ok(gh.calls.at(-1).includes('--latest=false'));
  assert.equal(shouldMarkLatest(releaseInfo('v0.10.1'), 'v0.11.0'), false);
  assert.equal(shouldMarkLatest(releaseInfo('v0.12.0'), 'v0.11.0'), true);
  assert.equal(shouldMarkLatest(releaseInfo('v0.11.0'), 'v0.11.0'), true);
});
