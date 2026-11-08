import {readTypeScript} from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readTypeScript(process.env.CIIP_APP_SOURCE || new URL('../src/app.ts',import.meta.url));
function functionSource(start,end) {
  const index=source.indexOf(start);
  assert.ok(index>=0,`Missing ${start}`);
  return source.slice(index,source.indexOf(end,index));
}
const confirmationSource=functionSource('async function confirmReplace(', '\nfunction readImage(');
const loadSource=functionSource('async function setDocument(', '\nasync function loadCapture(');

function confirmationHarness(animate=async()=>{}) {
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
  const nodes={'replace-dialog':dialog,'replace-cancel':{},'replace-confirm':{}};
  const context=vm.createContext({dirty:true,finishText(){},finishGesture(){},flushDocuments(){},queueMicrotask,
    $:id=>nodes[id],animatePanel:animate});
  vm.runInContext(confirmationSource,context);
  return {dialog,nodes,confirm:context.confirmReplace};
}
async function deadline(promise) {
  let timer;
  try {return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve('timed out'),80);})]);}
  finally {clearTimeout(timer);}
}

test('closing the editor cancels an active replacement prompt and ignores late acceptance',async()=>{
  const h=confirmationHarness(),controller=new AbortController();
  const result=h.confirm(controller.signal);
  assert.equal(h.dialog.open,true);
  controller.abort();
  assert.equal(await deadline(result),false);
  assert.equal(h.dialog.open,false);
  h.nodes['replace-confirm'].onclick();
  assert.equal(h.dialog.open,false);
});

test('an abort during the confirmation closing animation cancels acceptance',async()=>{
  let finishAnimation;
  const h=confirmationHarness((dialog,opening)=>opening?Promise.resolve():new Promise(resolve=>{finishAnimation=resolve;}));
  const controller=new AbortController(),result=h.confirm(controller.signal);
  h.nodes['replace-confirm'].onclick();
  controller.abort();finishAnimation();
  assert.equal(await deadline(result),false);
});

test('a cancelled transfer cannot replace the previous document after image decoding',async()=>{
  let finishRead;
  const previous={name:'unsaved screenshot'},next={base:'fixture',width:800,height:500,name:'incoming screenshot'};
  const context=vm.createContext({loadSequence:0,doc:previous,source:null,native:false,pinID:'',ocrGeneration:0,quickEditor:null,
    readImage:()=>new Promise(resolve=>{finishRead=resolve;}),finishText(){},setTool(){},fit(){},History:class{},$:()=>({})});
  vm.runInContext(loadSource,context);
  const controller=new AbortController();
  const result=context.setDocument(next,'','incoming',controller.signal);
  controller.abort();finishRead({naturalWidth:800,naturalHeight:500});
  await assert.rejects(result,{name:'AbortError'});
  assert.equal(context.doc,previous);
  const accepted=context.setDocument(next);
  finishRead({naturalWidth:800,naturalHeight:500});await accepted;
  assert.equal(context.doc,next);
});
