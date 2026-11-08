import test from 'node:test';
import assert from 'node:assert/strict';
import {latestReleaseAPI,releaseDownloads,applyReleaseDownloads} from '../src/downloads.ts';

const repository='https://github.com/gnl00/ciipapp';
function fixture(tag='v0.10.1'){
  return {tag_name:tag,draft:false,prerelease:false,assets:['arm64','x86_64'].map(arch=>{
    const name=`ciip-${tag}-macos-${arch}.dmg`;
    return {name,browser_download_url:`${repository}/releases/download/${tag}/${name}`};
  })};
}
test('both architectures follow the actual latest tag instead of a fixed version',()=>{
  for(const tag of ['v0.10.1','v0.11.0']){
    const value=fixture(tag),result=releaseDownloads(value,repository);
    assert.deepEqual(result,{tag,arm64:value.assets[0].browser_download_url,x86_64:value.assets[1].browser_download_url});
  }
});
test('drafts, prereleases and incomplete architecture pairs cannot become direct downloads',()=>{
  assert.ok(releaseDownloads(fixture(),repository));
  for(const changes of [{draft:true},{prerelease:true},{tag_name:'v0.11.0-beta.1'},{assets:fixture().assets.slice(0,1)}])assert.equal(releaseDownloads({...fixture(),...changes},repository),null);
  for(const value of [null,{},'invalid'])assert.equal(releaseDownloads(value,repository),null);
});
test('matching names must also resolve to the same repository, tag and DMG path',()=>{
  assert.ok(releaseDownloads(fixture(),repository));
  for(const url of ['javascript:alert(1)',`${repository.replace('gnl00','someone')}/releases/download/v0.10.1/ciip-v0.10.1-macos-arm64.dmg`,`${repository}/releases/download/v0.10.0/ciip-v0.10.1-macos-arm64.dmg`,`${repository}/releases/download/v0.10.1/ciip-v0.10.1-macos-arm64.zip`]){
    const value=fixture();value.assets[0].browser_download_url=url;
    assert.equal(releaseDownloads(value,repository),null);
  }
});
test('only GitHub repository URLs are used for build-time release lookup',()=>{
  assert.equal(latestReleaseAPI(repository+'/'),'https://api.github.com/repos/gnl00/ciipapp/releases/latest');
  for(const url of ['https://example.com/project','https://github.com/gnl00/ciipapp/releases','http://github.com/gnl00/ciipapp'])assert.equal(latestReleaseAPI(url),null);
});
test('production HTML includes both direct downloads and latest version without JavaScript',async()=>{
  const {readFile}=await import('node:fs/promises');
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const tag of ['v0.10.1','v0.11.0']){
    const downloads=releaseDownloads(fixture(tag),repository),output=applyReleaseDownloads(html,downloads);
    for(const architecture of ['arm64','x86_64'])assert.ok(output.includes(`data-download-arch="${architecture}" href="${downloads[architecture]}"`));
    assert.ok(output.includes(`<span id="site-version">${tag.slice(1)}</span>`));
    assert.ok(html.includes('data-download-arch="arm64" href="https://github.com/gnl00/ciipapp/releases/latest"'));
  }
});
