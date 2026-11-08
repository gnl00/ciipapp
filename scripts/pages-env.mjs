import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function pagesEnvironment(repository,override='',releaseURL='') {
  if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))throw Error('GITHUB_REPOSITORY must be owner/repository');
  const [owner,repo]=repository.split('/');
  const base=override||(repo.toLowerCase()===`${owner}.github.io`.toLowerCase()?'/':`/${repo}/`);
  if(!/^\/(?:[a-zA-Z0-9_.-]+\/)*$/.test(base))throw Error('PAGES_BASE_PATH must start and end with /');
  if(releaseURL&&!/^https:\/\//.test(releaseURL))throw Error('CIIP_RELEASE_URL must use HTTPS');
  if(/[\r\n]/.test(releaseURL))throw Error('release URL must be one line');
  const repositoryURL=`https://github.com/${repository}`;
  return {VITE_BASE_PATH:base,VITE_REPOSITORY_URL:repositoryURL,VITE_RELEASE_URL:releaseURL||`${repositoryURL}/releases/latest`};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.env.GITHUB_ENV)throw Error('GITHUB_ENV is required');
  const env=pagesEnvironment(process.env.GITHUB_REPOSITORY||'',process.env.PAGES_BASE_PATH||'',process.env.RELEASE_URL||'');
  appendFileSync(process.env.GITHUB_ENV,Object.entries(env).map(([key,value])=>`${key}=${value}\n`).join(''));
}
