import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {readTypeScript} from './helpers.mjs';
import {createEditorStyleStore,defaultEditorStyle,normalizeEditorStyle} from '../src/editor-style.ts';
import {createDocument,cloneDocument,frameLayout,hitTest,nextNumber,History} from '../src/editor.ts';

const source=readTypeScript(process.env.CIIP_APP_SOURCE||new URL('../src/app.ts',import.meta.url));
function fragment(start,end) {
 const from=source.indexOf(start),to=source.indexOf(end,from);
 assert.ok(from>=0&&to>from,`Missing app fragment ${start}`);
 return source.slice(from,to);
}
const controls=[
 fragment('const editorStyles=createEditorStyleStore(', '\nlet quickEditor'),
 fragment('async function setDocument(', '\nasync function loadCapture('),
 fragment('function setTool(', '\nfunction undo('),
 fragment('function newAnnotation(', '\nconst handleNames'),
 fragment('function updateSelectedStyle(', '\nfunction updateAnnotationOption('),
 fragment("$('tools').onclick=", '\nbindSegments'),
 fragment("$('number-value').onchange=", "\n$('font-size').onchange="),
 fragment("canvas.addEventListener('pointerdown',", "\ncanvas.addEventListener('dblclick',"),
].join('\n');
const base='data:image/png;base64,iVBORw0KGgo=';
function storage() {
 let style={...defaultEditorStyle};
 return {read:async()=>({...style}),write:async patch=>(style={...style,...patch})};
}
function harness(backend) {
 const nodes=new Map(),events={};
 const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',focus(){}});return nodes.get(id);};
 let context;
 const canvas={focus(){},setPointerCapture(){},addEventListener(type,callback){events[type]=callback;}};
 context=vm.createContext({
  ...defaultEditorStyle,doc:null,selected:null,tool:'select',busy:false,gesture:null,textEdit:null,preview:null,cropRect:null,
  numberOverride:null,loadSequence:0,pinID:'',native:true,quickEditor:null,ocrGeneration:0,scale:1,
  createEditorStyleStore,normalizeEditorStyle,cloneDocument,frameLayout,hitTest,nextNumber,History,crypto:{randomUUID},
  palette:[defaultEditorStyle.color,'#e6a32b'],$: $,canvas,
  call:async(method,patch)=>{if(method==='GetEditorStyle')return backend.read();if(method==='SetEditorStyle')return backend.write(patch);assert.fail(`Unexpected bridge call ${method}`);},
  readImage:async()=>({naturalWidth:800,naturalHeight:600}),finishText(){},finishGesture(){context.gesture=null;},
  render(){},fit(){},updateUI(){},updateRanges(){},recognizeText(){},notify:assert.fail,
  pointer:()=>({x:20,y:20}),
 });
 vm.runInContext(controls,context);
 const clickTool=tool=>$('tools').onclick({target:{closest:()=>({dataset:{tool}})}});
 return {
  context,
  load:()=>context.setDocument(createDocument(base,800,600,'capture.png')),
  choose:clickTool,
  width:value=>{$('stroke').value=String(value);$('stroke').onchange();},
  color:value=>$('colors').onclick({target:{closest:()=>({dataset:{color:value}})}}),
  number:value=>{$('number-value').value=String(value);$('number-value').onchange();},
  press:()=>events.pointerdown({button:0,pointerId:1,preventDefault(){}}),
  annotation:()=>context.newAnnotation({x:20,y:20}),
  snapshot:()=>vm.runInContext('editorStyles.snapshot()',context),
  flush:()=>vm.runInContext('editorStyles.flush()',context),
 };
}

test('pen width survives replacing a screenshot without switching tools and a fresh editor',async()=>{
 const backend=storage(),first=harness(backend);await first.load();
 first.choose('pen');first.width(8);assert.equal(first.context.tool,'pen');
 // setDocument must flush and refresh even when the previous tool was never left.
 await first.load();first.choose('pen');assert.equal(first.annotation().width,8);
 const fresh=harness(backend);await fresh.load();fresh.choose('pen');
 assert.equal(fresh.annotation().width,8);
});

test('pen, highlighter and ordinary stroke widths stay independent through real controls',async()=>{
 const h=harness(storage());await h.load();h.choose('pen');h.width(8);
 for(const [tool,width]of [['highlighter',20],['rectangle',4],['arrow',4],['pen',8]]){
  h.choose(tool);assert.equal(h.annotation().width,width,tool);
 }
 h.choose('highlighter');h.width(24);h.choose('rectangle');h.width(6);
 await h.load();
 for(const [tool,width]of [['highlighter',24],['rectangle',6],['pen',8]]){
  h.choose(tool);assert.equal(h.annotation().width,width,tool);
 }
});

test('an explicitly red highlighter stays red on the next screenshot while the pen color stays independent',async()=>{
 const backend=storage(),h=harness(backend);await h.load();
 h.choose('pen');h.color('#347bc7');h.choose('highlighter');assert.equal(h.annotation().color,'#e6a32b');
 h.color('#c94632');await h.flush();
 const fresh=harness(backend);await fresh.load();fresh.choose('highlighter');assert.equal(fresh.annotation().color,'#c94632');
 fresh.choose('pen');assert.equal(fresh.annotation().color,'#347bc7');
});

test('recoloring a selected old pen preserves its width and the pen default until width is explicitly changed',async()=>{
 const backend=storage(),h=harness(backend);await h.load();h.choose('pen');h.width(8);await h.flush();
 const old={id:'old-pen',type:'pen',points:[{x:20,y:20},{x:100,y:20}],color:'#c94632',width:40};
 h.context.doc.annotations.push(old);h.choose('select');h.press();
 assert.equal(h.context.selected,old.id);assert.equal(h.context.stroke,40);
 h.color('#347bc7');assert.equal(old.color,'#347bc7');assert.equal(old.width,40);
 h.choose('pen');assert.equal(h.annotation().width,8);assert.equal(h.snapshot().penStroke,8);
 h.choose('select');h.press();h.width(12);await h.flush();
 assert.equal(old.width,12);h.choose('pen');assert.equal(h.annotation().width,12);
 const fresh=harness(backend);await fresh.load();fresh.choose('pen');assert.equal(fresh.annotation().width,12);
});

test('number counter and pending overrides reset for each document instead of becoming saved styles',async()=>{
 const backend=storage(),h=harness(backend);await h.load();h.choose('number');h.number(88);h.press();h.press();
 assert.deepEqual(Array.from(h.context.doc.annotations,a=>a.number),[88,89]);
 h.number(99);assert.equal(h.context.numberOverride,99);
 await h.load();h.choose('number');h.press();assert.equal(h.context.doc.annotations[0].number,1);
 const fresh=harness(backend);await fresh.load();fresh.choose('number');fresh.press();
 assert.equal(fresh.context.doc.annotations[0].number,1);assert.equal(Object.hasOwn(await backend.read(),'numberOverride'),false);
});
