import {errorMessage} from '../src/native.ts';
import {readTypeScript} from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {quickCanvasRect,fitQuickImage} from '../src/quick-layout.ts';
import {createQuickWindowGesture} from '../src/quick-window.ts';

const source=readTypeScript(process.env.CIIP_QUICK_SOURCE||new URL('../src/quick.ts',import.meta.url))
 .replace(/^import .*;\n/gm,'').replace(/^export const isQuickMode=.*;$/m,'const isQuickMode=true;').replace('export function createQuickEditor','function createQuickEditor');
function fixture(image={dataURL:'fixture',width:1280,height:720},placement={panel:{width:664,height:500},image:{x:12,y:28,width:640,height:360},scale:.5,original:true},manualFrames=false) {
 const listeners={},nodes=[],calls=[],observers=[],frames=[];
 const node=()=>{const n={dataset:{},attributes:{},hasPointerCapture(){return false;},setPointerCapture(){},releasePointerCapture(){},style:{setProperty(key,value){this[key]=value;}},events:{},children:[],hidden:true,clientWidth:640,scrollWidth:640,scrollLeft:0,offsetWidth:640,offsetHeight:84,classList:{add(){},remove(){},toggle(){}},setAttribute(key,value){this.attributes[key]=value;},before(){},append(...children){this.children.push(...children);for(const child of children)child.parentElement=this;},addEventListener(type,fn){this.events[type]=fn;},removeEventListener(type){delete this.events[type];},querySelector(){return {remove(){}};},getBoundingClientRect(){return {left:0,right:this.clientWidth};},click(event={detail:1}){if(!this.disabled)return this.onclick?.(event);}};nodes.push(n);return n;};
 const toolbar=node(),properties=node(),copy=node(),wrap=node(),busy=node(),canvas=node(),tools=node();
 let toolsWidth=640;
 Object.defineProperty(tools,'clientWidth',{get(){return toolsWidth-(tools.parentElement?.children.filter(child=>child!==tools&&!child.hidden).length||0)*20;}});
 tools.scrollWidth=430;tools.scrollCalls=[];
 tools.scrollBy=options=>{tools.scrollCalls.push(options);tools.scrollLeft=Math.max(0,Math.min(tools.scrollWidth-tools.clientWidth,tools.scrollLeft+options.left));tools.events.scroll?.();};
 const toolButtons=Array.from({length:12},(_,index)=>{const button=node();button.dataset.tool=String(index);button.attributes['aria-pressed']=String(index===0);button.getBoundingClientRect=()=>({left:index*36-tools.scrollLeft,right:index*36+32-tools.scrollLeft});return button;});
 tools.append(...toolButtons);tools.querySelector=()=>toolButtons.find(button=>button.attributes['aria-pressed']==='true');
 let modal=false,closable=true,labelRemoved=false,focused=null;
 canvas.focus=()=>{focused=canvas;};
 copy.querySelector=()=>({remove(){labelRemoved=true;}});
 const document={body:node(),createElement:node,querySelector:selector=>({'.toolbar':toolbar,'.properties':properties,'#tools':tools,'#copy':copy,'#canvas-wrap':wrap,'#busy':busy,'#canvas':canvas,'dialog[open]':modal?{}:null}[selector]),addEventListener(){}};
 const observer=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 const context=vm.createContext({errorMessage,document,ResizeObserver:observer,MutationObserver:observer,matchMedia:()=>({matches:false}),innerWidth:664,innerHeight:500,window:{addEventListener:(type,fn)=>listeners[type]=fn},requestAnimationFrame:fn=>manualFrames?frames.push(fn):setImmediate(fn),setTimeout,clearTimeout,createQuickWindowGesture:options=>createQuickWindowGesture({...options,requestFrame:fn=>setImmediate(fn),cancelFrame:clearImmediate}),quickCanvasRect,fitQuickImage});
 vm.runInContext(source,context);
 const editor=context.createQuickEditor({call:async(method,...args)=>{calls.push({method,args});if(method==='GetQuickCapture')return {image,placement,doubleClickMS:800};if(method==='QuickReady')focused=toolbar;if(method==='GetQuickBounds')return {x:100,y:100,width:664,height:500};},loadCapture:async()=>{},finishEditing(){},serialize:()=>'{"base":"fixture"}',notify(){},canCloseCanvas:()=>closable});
 return {editor,calls,listeners,wrap,busy,canvas,toolbar,tools,observers,toolButtons,body:document.body,nodes,frame(){frames.splice(0).forEach(fn=>fn());},get focused(){return focused;},get labelRemoved(){return labelRemoved;},set modal(value){modal=value;},set closable(value){closable=value;},resizeTools(width){toolsWidth=width;if(tools.parentElement)tools.parentElement.clientWidth=width;observers.forEach(observer=>observer.callback([]));},selectTool(index){toolButtons.forEach((button,i)=>button.attributes['aria-pressed']=String(i===index));observers.forEach(observer=>observer.callback([]));},resize(width,height){context.innerWidth=width;context.innerHeight=height;listeners.resize();}};
}
const baseLayout={crop:{x:0,y:0},offsetX:0,offsetY:0,width:1280,height:720};

test('quick startup restores canvas focus after native activation instead of leaving the first tool focused',async()=>{
 const h=fixture();await h.editor.start();assert.equal(h.focused,h.canvas);
});

test('quick readiness waits for a painted canvas and remains bounded when a hidden WebView pauses frames',async()=>{
 const h=fixture(undefined,undefined,true),started=h.editor.start();await new Promise(setImmediate);
 assert.equal(h.calls.some(call=>call.method==='QuickReady'),false);
 h.frame();await new Promise(setImmediate);assert.equal(h.calls.some(call=>call.method==='QuickReady'),false);
 h.frame();await started;assert.equal(h.calls.filter(call=>call.method==='QuickReady').length,1);
 const hidden=fixture(undefined,undefined,true);await hidden.editor.start();assert.equal(hidden.calls.filter(call=>call.method==='QuickReady').length,1);
});

test('overflowing quick tools expose directional scrolling while wide toolbars need no controls',()=>{
 const h=fixture(),back=h.nodes.find(node=>node.attributes['aria-label']==='向左查看更多工具'),next=h.nodes.find(node=>node.attributes['aria-label']==='向右查看更多工具');
 assert.ok(back&&next,'the clipped tools need operable overflow controls');assert.equal(back.hidden,true);assert.equal(next.hidden,true);
 h.resizeTools(200);assert.equal(back.hidden,false);assert.equal(next.hidden,false);assert.equal(back.disabled,true);assert.equal(next.disabled,false);
 next.click();assert.ok(h.tools.scrollLeft>0);assert.equal(back.disabled,false);
 for(let i=0;i<4;i++)next.click();assert.equal(next.disabled,true);assert.equal(back.disabled,false);
 h.resizeTools(640);assert.equal(back.hidden,true);assert.equal(next.hidden,true);
});

test('quick tool selection reveals a clipped tool but manual scrolling does not snap to the selection',()=>{
 const h=fixture();h.resizeTools(200);h.selectTool(11);
 assert.ok(h.tools.scrollLeft>0);assert.ok(h.toolButtons[11].getBoundingClientRect().right<=h.tools.clientWidth+1);
 h.tools.scrollLeft=0;h.tools.events.scroll();assert.equal(h.tools.scrollLeft,0);
 h.tools.scrollLeft=200;h.tools.events.scroll();
 h.selectTool(0);assert.equal(h.tools.scrollLeft,0);
});

test('keyboard overflow navigation remains immediate and quick teardown releases observers',()=>{
 const h=fixture();h.resizeTools(200);
 const next=h.nodes.find(node=>node.attributes['aria-label']==='向右查看更多工具');assert.ok(next);next.click({detail:0});
 assert.equal(h.tools.scrollCalls.at(-1).behavior,'auto');
 h.tools.events.focusin({target:{closest:()=>h.toolButtons[11]}});
 assert.ok(h.toolButtons[11].getBoundingClientRect().right<=h.tools.clientWidth+1);assert.equal(h.tools.scrollCalls.at(-1).behavior,'auto');
 h.listeners.pagehide();assert.ok(h.observers.length>=2);assert.ok(h.observers.every(observer=>observer.disconnected));
 assert.equal(h.tools.events.scroll,undefined);assert.equal(h.tools.events.focusin,undefined);
});

test('quick editor fits padded output above the toolbar without clipping screen edges',async()=>{
 const h=fixture();await h.editor.start();
 const layout={crop:{x:0,y:0},offsetX:240,offsetY:240,width:1760,height:1200};
 const scale=h.editor.scale(layout);h.editor.position(layout,scale);
 const x=parseFloat(h.wrap.style.left),y=parseFloat(h.wrap.style.top);
 assert.ok(x>=12&&y>=28&&x+layout.width*scale<=652&&y+layout.height*scale<=388+1e-9);
});

test('quick editor preserves initial metadata placement then refits when its native window resizes',async()=>{
 const h=fixture();await h.editor.start();
 assert.equal(h.editor.scale(baseLayout),.5);h.editor.position(baseLayout,.5);
 assert.equal(h.wrap.style.left,'12px');assert.equal(h.wrap.style.top,'28px');
 h.resize(344,320);
 assert.equal(h.editor.scale(baseLayout),.25);h.editor.position(baseLayout,.25);
 assert.equal(h.wrap.style.left,'12px');assert.equal(h.wrap.style.top,'28px');
});

test('native menu uses the same transfer action and prevents duplicate requests',async()=>{
 const h=fixture();await h.editor.start();
 h.listeners['ciip:quick-open-editor']();h.listeners['ciip:quick-open-editor']();
 assert.equal(h.calls.filter(call=>call.method==='OpenQuickInEditor').length,1);
 h.listeners['ciip:quick-transfer-cancelled']();h.listeners['ciip:quick-open-editor']();
 assert.equal(h.calls.filter(call=>call.method==='OpenQuickInEditor').length,2);
});

test('native menu cannot transfer a document behind an open modal or during export',async()=>{
 const h=fixture();await h.editor.start();
 h.modal=true;h.listeners['ciip:quick-open-editor']();
 h.modal=false;h.busy.hidden=false;h.listeners['ciip:quick-open-editor']();
 assert.equal(h.calls.filter(call=>call.method==='OpenQuickInEditor').length,0);
 h.busy.hidden=true;h.listeners['ciip:quick-open-editor']();
 assert.equal(h.calls.filter(call=>call.method==='OpenQuickInEditor').length,1);
});

test('blank canvas captures a window move and sends global endpoint deltas',async()=>{
 const h=fixture();await h.editor.start();let prevented=false;
 assert.equal(h.editor.moveCanvas({button:0,pointerId:1,currentTarget:h.canvas,timeStamp:100,screenX:400,screenY:300,preventDefault(){prevented=true;},stopPropagation(){}}),true);
 assert.equal(prevented,true);h.listeners.pointerup({pointerId:1,screenX:450,screenY:320});
 // Drain the fixture's immediate-frame queue instead of racing a wall-clock timer.
 await new Promise(setImmediate);await new Promise(setImmediate);
 const moved=h.calls.find(call=>call.method==='TransformQuickWindow');assert.ok(moved);assert.deepEqual(moved.args.slice(1),['move',50,20]);
 assert.equal(h.calls.filter(call=>call.method==='CloseQuick').length,0);
});

test('double click uses the system interval and closes before the second native title-bar action',async()=>{
 const h=fixture();await h.editor.start();let prevented=0;
 for(const timeStamp of [100,750])h.editor.moveCanvas({button:0,pointerId:1,currentTarget:h.canvas,timeStamp,screenX:400,screenY:300,preventDefault(){prevented++;},stopPropagation(){}});
 assert.equal(prevented,2);assert.equal(h.calls.filter(call=>call.method==='CloseQuick').length,1);
});

test('a second click after moving the window cannot close the editor',async()=>{
 const h=fixture();await h.editor.start();
 for(const [timeStamp,screenX]of [[100,400],[200,500]])h.editor.moveCanvas({button:0,pointerId:1,currentTarget:h.canvas,timeStamp,screenX,screenY:300,preventDefault(){},stopPropagation(){}});
 assert.equal(h.calls.filter(call=>call.method==='CloseQuick').length,0);
});

test('copy is icon only and close sits inside the screenshot top-right outside the toolbar',async()=>{
 const h=fixture();await h.editor.start();h.editor.position(baseLayout,.5);
 const close=h.nodes.find(node=>node.className==='quick-close');
 assert.equal(h.labelRemoved,true);assert.ok(h.body.children.includes(close));assert.ok(!h.toolbar.children.includes(close));
 assert.equal(close.style.left,'618px');assert.equal(close.style.top,'36px');
 h.closable=false;h.canvas.events.dblclick({preventDefault(){assert.fail('annotation text must keep double-click editing');}});
 assert.equal(h.calls.filter(call=>call.method==='CloseQuick').length,0);
 h.closable=true;h.canvas.events.dblclick({preventDefault(){}});
 assert.equal(h.calls.filter(call=>call.method==='CloseQuick').length,1);
});

test('close stays inside normal and short captures with clear space around every resize handle',async()=>{
 for(const [x,y,width,height]of [[98,45,124,34],[98,45,34,124],[98,45,42,34],[98,45,34,42],[98,45,124,200],[516,28,136,34]]){
  const h=fixture({dataURL:'small',width:width*2,height:height*2},{panel:{width:664,height:500},image:{x,y,width,height},scale:.5,original:true});
  await h.editor.start();h.editor.position({crop:{x:0,y:0},offsetX:0,offsetY:0,width:width*2,height:height*2},.5);
  const close=h.nodes.find(node=>node.className==='quick-close'),left=parseFloat(close.style.left),top=parseFloat(close.style.top);
  assert.ok(left>=x&&top>=y&&left+26<=x+width&&top+26<=y+height,'the control must fit inside the screenshot');
  assert.ok(left>x+3&&left+26<x+width-3&&top>y+3&&top+26<y+height-3,'edge resize hit areas must remain clear');
  assert.ok(x+width-left-26>=8||top-y>=8,'the top-right resize corner must remain clear');
 }
});

test('captures too small for the close control and resize handles use clear space beside or above/below the image',async()=>{
 for(const [x,y,width,height]of [[12,28,20,20],[620,28,20,20],[12,28,40,40],[12,28,640,32],[12,80,640,20]]){
  const h=fixture({dataURL:'tiny',width:width*2,height:height*2},{panel:{width:664,height:500},image:{x,y,width,height},scale:.5,original:true});
  await h.editor.start();h.editor.position({crop:{x:0,y:0},offsetX:0,offsetY:0,width:width*2,height:height*2},.5);
  const close=h.nodes.find(node=>node.className==='quick-close'),left=parseFloat(close.style.left),top=parseFloat(close.style.top);
  assert.ok(left>=8&&top>=8&&left+26<=656&&top+26<=492,'the control must remain fully visible');
  assert.ok(left>=x+width+8||left+26<=x-8||top+26<=y-8||top>=y+height+8,'the control must clear the image and all resize handles');
 }
});
