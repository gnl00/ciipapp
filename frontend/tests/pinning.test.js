import {readTypeScript} from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readTypeScript(process.env.CIIP_APP_SOURCE||new URL('../src/app.ts',import.meta.url));
const from=source.indexOf('async function pinImage()'),to=source.indexOf('\nfunction segmentValue(',from);
function fixture(pinID='',{quick=true,failMethod=''}={}){
 const calls=[],rect={left:12,top:28,width:640,height:360},doc={width:1280,height:720,annotations:[]};
 const context=vm.createContext({pinID,doc,tool:'select',native:true,dirty:true,canvas:{getBoundingClientRect:()=>rect},run:async(label,fn)=>fn(),exportPNG:()=> 'source-png',serializeDocument:()=> 'editable-json',
 call:async(method,...args)=>{calls.push({method,args});if(method===failMethod)throw Error('pin failed');return 'pin-created';},$:()=>({}),notify(){},quickEditor:quick?{finish:async()=>{calls.push({method:'finish'});}}:null});
 vm.runInContext(source.slice(from,to),context);return {calls,context,doc,pin:context.pinImage};
}

test('pinning sends the displayed canvas rectangle and keeps the full-resolution document',async()=>{
 const h=fixture();await h.pin();const request=h.calls[0];
 assert.equal(request.method,'PinImage');assert.equal(request.args.length,3);
 assert.equal(request.args[0],'source-png');assert.equal(request.args[1],'editable-json');
 assert.deepEqual(JSON.parse(JSON.stringify(request.args[2])),{x:12,y:28,width:640,height:360});
 assert.equal(h.doc.width,1280);assert.equal(h.doc.height,720);assert.equal(h.calls[1].method,'finish');
});

test('updating an existing pin keeps its identity and position rather than creating another',async()=>{
 const h=fixture('existing-pin');await h.pin();
 assert.equal(h.calls[0].method,'UpdatePin');assert.deepEqual(h.calls[0].args,['existing-pin','source-png','editable-json']);
 assert.equal(h.context.pinID,'existing-pin');
});

for(const pinID of ['', 'existing-pin']){
 test(`full editor closes after ${pinID?'updating':'creating'} a pin successfully`,async()=>{
  const h=fixture(pinID,{quick:false});await h.pin();
  assert.deepEqual(h.calls.map(c=>c.method),[pinID?'UpdatePin':'PinImage','CloseEditor']);
  assert.equal(h.context.pinID,pinID||'pin-created');assert.equal(h.context.dirty,false);
 });
 test(`failed ${pinID?'update':'creation'} keeps the editor and unsaved document open`,async()=>{
  const method=pinID?'UpdatePin':'PinImage',h=fixture(pinID,{quick:false,failMethod:method});
  await assert.rejects(h.pin(),/pin failed/);
  assert.deepEqual(h.calls.map(c=>c.method),[method]);assert.equal(h.context.dirty,true);assert.equal(h.context.pinID,pinID);
 });
}
