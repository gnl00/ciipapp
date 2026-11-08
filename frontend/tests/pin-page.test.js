import {readTypeScript} from './helpers.mjs';
import {errorMessage} from '../src/native.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(process.env.CIIP_PIN_HTML_SOURCE||new URL('../src/pin.template.html',import.meta.url),'utf8');
const source=readTypeScript(new URL('../src/pin.ts',import.meta.url)).replace(/^import .*;\n/gm,'').replace('export function startPin','function startPin');
function fixture({reducedMotion=false,nativePinch=false}={}){
 const script=source+'\nstartPin('+JSON.stringify({id:'pin-one',dataURL:'fixture',nativePinch})+');';
 const nodes=new Map(),listeners={},calls=[],steps=[],frames=[],animations=[],gestures=[],wheels=[];
 let layout={left:0,top:0,width:500,height:300,percentage:'50%'};
 const document={activeElement:null,getElementById:id=>nodes.get(id),querySelector:selector=>nodes.get(selector)};
 function node(id){const n={id,style:{},classList:{toggle(){}},events:{},naturalWidth:1000,naturalHeight:600,focusable:id!=='image'||/<img[^>]*id="image"[^>]*tabindex="-1"/.test(html),
  addEventListener(type,callback){(this.events[type]??=[]).push(callback);},setAttribute(){},focus(){if(this.focusable)document.activeElement=this;},closest(selector){return selector==='button'&&['minus','plus','edit','copy','close'].includes(id)?this:null;},
  animate(keyframes,options){const animation={keyframes,options,playState:'running',cancel(){this.playState='idle';}};animations.push(animation);return animation;}};nodes.set(id,n);return n;}
 for(const id of ['image','surface','scale','message','minus','plus','edit','copy','close','.controls'])node(id);
 const window={addEventListener(type,callback){(listeners[type]??=[]).push(callback);},matchMedia:()=>({matches:reducedMotion}),mygo:{call:async(method,...args)=>{calls.push({method,args});}}};
 vm.runInNewContext(script,{errorMessage,document,window,innerWidth:500,innerHeight:300,requestAnimationFrame:callback=>frames.push(callback),getComputedStyle:node=>({lineHeight:'16px',opacity:'1',transform:'none',...node?.computed}),
  pinImageLayout:()=>layout,
  createPinZoomController:()=>({step:factor=>steps.push(factor),wheel:event=>wheels.push(event),gestureStart:()=>gestures.push('start'),gestureChange:()=>gestures.push('change'),gestureEnd:()=>gestures.push('end'),destroy(){}}),setTimeout(){}});
 return {document,nodes,calls,steps,animations,gestures,wheels,resize:size=>{Object.assign(layout,size);(listeners.resize||[]).forEach(callback=>callback());},frame:()=>frames.splice(0).forEach(callback=>callback()),load:()=>(nodes.get('image').events.load||[]).forEach(callback=>callback()),fire:(type,event={})=>(listeners[type]||[]).forEach(callback=>callback(event))};
}

test('a pin starts focused on its image and restores neutral focus after native activation',()=>{
 const h=fixture(),image=h.nodes.get('image');assert.equal(h.document.activeElement===image,true);
 h.document.activeElement=h.nodes.get('minus');h.fire('focus');assert.equal(h.document.activeElement===image,true);
});

test('pointer use of toolbar buttons keeps neutral focus without cancelling their actions',()=>{
 const h=fixture();let prevented=false;h.document.activeElement=h.nodes.get('minus');
 for(const listener of h.nodes.get('.controls').events.mousedown||[])listener({button:0,preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(h.document.activeElement===h.nodes.get('image'),true);
 h.nodes.get('plus').onclick();assert.equal(h.steps[0],1.15);
});

test('Enter on a focused toolbar button keeps its native button action rather than opening the editor',()=>{
 const h=fixture();h.fire('keydown',{key:'Enter',target:h.nodes.get('plus'),preventDefault(){}});
 assert.equal(h.calls.length,0);
 h.fire('keydown',{key:'Enter',target:h.nodes.get('image'),preventDefault(){}});
 assert.equal(h.calls[0].method,'CaptureService.EditPin');
});

test('initial and updated images refresh their native shadow after the image can paint',()=>{
 const h=fixture();h.load();assert.equal(h.calls.length,0);
 h.frame();assert.equal(h.calls.length,0);
 h.frame();assert.deepEqual(h.calls[0],{method:'CaptureService.RefreshPinShadow',args:['pin-one']});
 h.load();h.frame();h.frame();assert.equal(h.calls.length,2);
});

test('closing a pin before its image paints cancels the pending shadow refresh',()=>{
 const h=fixture();h.load();h.fire('pagehide');h.frame();h.frame();
 assert.equal(h.calls.length,0);
});

test('toolbar motion runs only when its display mode changes, not on initial paint or ordinary resizing',()=>{
 const h=fixture();h.load();assert.equal(h.animations.length,0);
 h.resize({width:480});assert.equal(h.animations.length,0);
 h.resize({width:400});assert.equal(h.animations.length,1);
 h.resize({width:300});assert.equal(h.animations.length,1);
 h.resize({width:249});assert.equal(h.animations.length,2);
 assert.equal(h.animations[1].options.duration,140);
 assert.deepEqual(Object.keys(h.animations[1].keyframes[0]).sort(),['opacity','transform']);
 h.resize({width:260});assert.equal(h.animations.length,3);
 h.resize({height:53});assert.equal(h.animations.length,4);
});

test('a reversed toolbar transition continues from the current visible frame and cancels its predecessor',()=>{
 const h=fixture();h.load();h.resize({width:249});
 h.nodes.get('.controls').computed={opacity:'0.45',transform:'matrix(0.98, 0, 0, 0.98, 0, -1)'};
 h.resize({width:260});
 assert.equal(h.animations[0].playState,'idle');
 assert.equal(h.animations[1].keyframes[0].opacity,'0.45');
 assert.equal(h.animations[1].keyframes[0].transform,'matrix(0.98, 0, 0, 0.98, 0, -1)');
});

test('reduced motion changes toolbar modes without animation',()=>{
 const h=fixture({reducedMotion:true});h.load();h.resize({width:249});h.resize({width:500});
 assert.equal(h.animations.length,0);
});

test('pin toolbar motion consumes shared time and easing tokens, including zero and fallback',()=>{
 for(const [token,expected]of [['250ms',250],['.2s',200],['0ms',0],['invalid',140]]){
  const h=fixture();h.load();
  h.nodes.get('.controls').computed={getPropertyValue:name=>name==='--motion-pin-toolbar'?token:'linear'};
  h.resize({width:249});
  assert.equal(h.animations.length,expected?1:0);
  if(expected){assert.equal(h.animations[0].options.duration,expected);assert.equal(h.animations[0].options.easing,'linear');}
 }
});

test('toolbar transitions respect hidden hover state and release their opacity when the pointer leaves the pin',()=>{
 const h=fixture();h.load();h.nodes.get('.controls').computed={opacity:'0'};
 h.resize({width:249});assert.equal(h.animations.length,0);
 h.nodes.get('.controls').computed={opacity:'1'};h.resize({width:260});
 assert.equal(h.animations.length,1);
 h.fire('mouseout',{relatedTarget:null});assert.equal(h.animations[0].playState,'idle');
});

test('native magnify ownership prevents duplicate WebKit gesture zoom and preserves wheel input',()=>{
 const h=fixture({nativePinch:true});let prevented=0;
 for(const type of ['gesturestart','gesturechange','gestureend'])h.fire(type,{scale:1.2,preventDefault(){prevented++;}});
 assert.deepEqual(h.gestures,[]);assert.equal(prevented,3);
 h.fire('wheel',{deltaY:10});assert.equal(h.wheels.length,1);
});

test('WebKit gesture fallback remains enabled when native magnify cannot be installed',()=>{
 const h=fixture();for(const type of ['gesturestart','gesturechange','gestureend'])h.fire(type,{scale:1.2,preventDefault(){}});
 assert.deepEqual(h.gestures,['start','change','end']);
});
