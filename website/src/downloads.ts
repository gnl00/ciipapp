export type DownloadArchitecture='arm64'|'x86_64';
export interface ReleaseDownloads {tag:string;arm64:string;x86_64:string}

export function latestReleaseAPI(repository:string):string|null {
  const match=/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/.exec(repository);
  return match?`https://api.github.com/repos/${match[1]}/${match[2]}/releases/latest`:null;
}

export function releaseDownloads(value:unknown,repository:string):ReleaseDownloads|null {
  if(!latestReleaseAPI(repository)||!value||typeof value!=='object')return null;
  const release=value as {tag_name?:unknown;draft?:unknown;prerelease?:unknown;assets?:unknown};
  if(typeof release.tag_name!=='string'||!/^v\d+\.\d+\.\d+(?:\+[\w.-]+)?$/.test(release.tag_name)||release.draft!==false||release.prerelease!==false||!Array.isArray(release.assets))return null;
  const tag=release.tag_name,base=repository.replace(/\/$/,'');
  const assetURL=(architecture:DownloadArchitecture):string|null=>{
    const name=`ciip-${tag}-macos-${architecture}.dmg`;
    for(const candidate of release.assets as unknown[]){
      if(!candidate||typeof candidate!=='object')continue;
      const asset=candidate as {name?:unknown;browser_download_url?:unknown};
      if(asset.name!==name||typeof asset.browser_download_url!=='string')continue;
      try{
        const url=new URL(asset.browser_download_url);
        if(url.origin==='https://github.com'&&!url.search&&!url.hash&&decodeURIComponent(url.pathname)===`${new URL(base).pathname}/releases/download/${tag}/${name}`)return url.href;
      }catch{continue;}
    }
    return null;
  };
  const arm64=assetURL('arm64'),intel=assetURL('x86_64');
  return arm64&&intel?{tag,arm64,x86_64:intel}:null;
}

export function applyReleaseDownloads(html:string,release:ReleaseDownloads):string {
  return html.replace(/(data-download-arch="(arm64|x86_64)" href=")[^"]*"/g,
    (_match,prefix:string,architecture:DownloadArchitecture)=>`${prefix}${release[architecture]}"`)
    .replace(/(<span id="site-version">)[^<]*/,`$1${release.tag.slice(1)}`);
}
