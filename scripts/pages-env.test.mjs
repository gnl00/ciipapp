import test from 'node:test';
import assert from 'node:assert/strict';
import {pagesEnvironment} from './pages-env.mjs';
test('existing account project uses its repository subpath',()=>{const env=pagesEnvironment('account1/ciipapp');assert.equal(env.VITE_BASE_PATH,'/ciipapp/');assert.equal(env.VITE_REPOSITORY_URL,'https://github.com/account1/ciipapp');assert.equal(env.VITE_RELEASE_URL,'https://github.com/account1/ciipapp/releases');});
test('account site uses root and custom domains can override the project prefix',()=>{assert.equal(pagesEnvironment('ciipapp/ciipapp.github.io').VITE_BASE_PATH,'/');assert.equal(pagesEnvironment('account1/ciipapp','/').VITE_BASE_PATH,'/');});
test('invalid workflow values cannot inject new environment lines',()=>{for(const [repo,base,url]of [['account1','', ''],['a/b','//evil/', ''],['a/b','/','https://example.test/\nX=Y'],['a/b','/','javascript:1']])assert.throws(()=>pagesEnvironment(repo,base,url));});

test('ciip publishes under its real repository and stable Releases list',()=>{const env=pagesEnvironment('gnl00/ciipapp');assert.deepEqual(env,{VITE_BASE_PATH:'/ciipapp/',VITE_REPOSITORY_URL:'https://github.com/gnl00/ciipapp',VITE_RELEASE_URL:'https://github.com/gnl00/ciipapp/releases'});});
