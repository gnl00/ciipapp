import {defineConfig} from 'vite';
import {execFileSync} from 'node:child_process';
import {resolveSiteConfig} from './src/config.ts';
import {latestReleaseAPI,releaseDownloads,applyReleaseDownloads} from './src/downloads.ts';

export default defineConfig(()=>{
  const site=resolveSiteConfig({repositoryUrl:process.env.VITE_REPOSITORY_URL,releaseUrl:process.env.VITE_RELEASE_URL});
  const api=latestReleaseAPI(site.repositoryUrl);
  if(!api)throw Error('Website downloads require a GitHub repository URL');
  const release=releaseDownloads(JSON.parse(execFileSync('gh',['api',api],{encoding:'utf8',timeout:20000})),site.repositoryUrl);
  if(!release)throw Error('Latest stable release must contain both architecture DMGs');
  return {
    base:process.env.VITE_BASE_PATH||'./',build:{target:'safari15',outDir:'dist'},
    define:{'import.meta.env.VITE_RELEASE_VERSION':JSON.stringify(release.tag.slice(1))},
    plugins:[{name:'ciip-release-downloads',transformIndexHtml:html=>applyReleaseDownloads(html,release)}],
  };
});
