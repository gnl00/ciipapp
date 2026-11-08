import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function checkPage(url) {
  const html=await readFile(url,'utf8');
  const base=new URL(html.match(/<base\b[^>]*href="([^"]+)"/)?.[1]||'.',url);
  const links=[...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)];
  assert.ok(links.length>0,'page must load its production scripts or styles');
  for(const [,reference]of links){
    const resource=new URL(reference,base);
    if(resource.protocol==='file:')await readFile(resource);
  }
}

test('prototype and design guide resolve their local assets after directory changes',async()=>{
  await checkPage(new URL('./preview.html',import.meta.url));
  await checkPage(new URL('../docs/design-system.html',import.meta.url));
});

test('prototype backend imports resolve from its own module location',async()=>{
  const sourceURL=new URL('./mock.js',import.meta.url),source=await readFile(sourceURL,'utf8');
  const imports=[...source.matchAll(/import\(['"](\.[^'"]+)['"]\)/g)];
  assert.ok(imports.length>0,'mock must reuse the production document model');
  for(const [,reference]of imports)await readFile(new URL(reference,sourceURL));
});
