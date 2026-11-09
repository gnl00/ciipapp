import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorStyleStore,defaultEditorStyle,normalizeEditorStyle} from '../src/editor-style.ts';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function storage(){let saved={...defaultEditorStyle};return {read:async()=>saved,write:async patch=>(saved={...saved,...patch})};}

test('tool choices survive fresh editors and preserve independent pen/highlighter widths',async()=>{
 const disk=storage(),first=createEditorStyleStore({...disk,onError:assert.fail});
 await first.refresh();first.update({penStroke:8});await first.flush();
 const next=createEditorStyleStore({...disk,onError:assert.fail});await next.refresh();
 assert.equal(next.snapshot().penStroke,8);assert.equal(next.snapshot().stroke,4);assert.equal(next.snapshot().highlightStroke,20);
 next.update({arrowStyle:'curved',numberStyle:'outline',numberRadius:24,redactStyle:'pixelate',redactStrength:28,textSize:36,color:'#347bc7'});await next.flush();
 await first.refresh();assert.equal(first.snapshot().penStroke,8);assert.equal(first.snapshot().textSize,36);assert.equal(first.snapshot().arrowStyle,'curved');
});

test('writes serialize and closing flush waits for the newest pending choice',async()=>{
 const block=gate(),calls=[],disk=storage();let first=true;
 const store=createEditorStyleStore({read:disk.read,onError:assert.fail,write:async patch=>{calls.push(patch);if(first){first=false;await block.promise;}return disk.write(patch);}});
 store.update({penStroke:8});await tick();store.update({textSize:36});
 let finished=false;const closing=store.flush().then(()=>{finished=true;});await tick();
 assert.equal(calls.length,1);assert.equal(finished,false);
 block.resolve();await closing;assert.equal(store.snapshot().penStroke,8);assert.equal(store.snapshot().textSize,36);
 assert.equal(calls.length,2);
});

test('late reads cannot overwrite an explicit style change',async()=>{
 const block=gate(),disk=storage();
 const store=createEditorStyleStore({read:()=>block.promise,write:disk.write,onError:assert.fail});
 const loading=store.refresh();await tick();store.update({penStroke:8});block.resolve(defaultEditorStyle);
 await loading;await store.flush();assert.equal(store.snapshot().penStroke,8);
});

test('failed saves retain pending changes, report errors and can be retried before closing',async()=>{
 const disk=storage(),errors=[];let fail=true;
 const store=createEditorStyleStore({read:disk.read,onError:error=>errors.push(error),write:async patch=>{if(fail)throw Error('disk unavailable');return disk.write(patch);}});
 store.update({penStroke:8});await assert.rejects(store.flush(),/disk unavailable/);
 assert.ok(errors.length);assert.equal(store.snapshot().penStroke,8);
 fail=false;await store.flush();const next=createEditorStyleStore({...disk,onError:assert.fail});await next.refresh();assert.equal(next.snapshot().penStroke,8);
});

test('invalid stored fields recover independently and invalid patches never reach storage',()=>{
 const recovered=normalizeEditorStyle({penStroke:8,stroke:Infinity,textSize:1,color:'url(evil)',arrowStyle:'invalid'});
 assert.equal(recovered.penStroke,8);assert.equal(recovered.stroke,4);assert.equal(recovered.textSize,24);assert.equal(recovered.color,defaultEditorStyle.color);
 const store=createEditorStyleStore({...storage(),onError:assert.fail});
 for(const patch of [{penStroke:NaN},{textSize:1024},{numberRadius:0},{color:'url(evil)'},{numberOverride:99}])assert.throws(()=>store.update(patch),/样式无效/);
 assert.deepEqual(store.snapshot(),defaultEditorStyle);
});
