export interface SiteEnvironment {repositoryUrl?:string;releaseUrl?:string}
export const repositoryUrl='https://github.com/gnl00/ciipapp';
export const releaseUrl=repositoryUrl+'/releases/latest';
function publicLink(value:string|undefined):string|null {
  if(!value?.trim())return null;
  try{const url=new URL(value.trim());return url.protocol==='https:'?url.href:null;}catch{return null;}
}
export function resolveSiteConfig(environment:SiteEnvironment){
  return {version:'0.10.1',repositoryUrl:publicLink(environment.repositoryUrl)??repositoryUrl,releaseUrl:publicLink(environment.releaseUrl)??releaseUrl} as const;
}
