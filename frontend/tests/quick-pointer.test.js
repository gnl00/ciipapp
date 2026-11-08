import {readTypeScript} from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('a blank quick-canvas press reaches native movement without a blocking canvas redraw',()=>{
 const source=readTypeScript(process.env.CIIP_APP_SOURCE||new URL('../src/app.ts',import.meta.url));
 const from=source.indexOf("canvas.addEventListener('pointerdown',event=>{"),to=source.indexOf("canvas.addEventListener('dblclick'",from);
 let handler,painted=0,laidOut=0,prevented=false;
 const context=vm.createContext({doc:{annotations:[]},busy:false,gesture:null,tool:'select',selected:'previous',scale:1,
  quickEditor:{resetMove(){},moveCanvas(){return true;}},finishText(){},pointer:()=>({x:20,y:20}),
  frameLayout:()=>({crop:{x:0,y:0,w:100,h:100}}),hitTest:()=>false,
  canvas:{addEventListener(type,fn){handler=fn;},focus(){},setPointerCapture(){assert.fail('native movement needs the mouse event');}},
  render(){painted++;},layoutSelection(){laidOut++;},requestAnimationFrame(){},updateUI(){}});
 vm.runInContext(source.slice(from,to),context);
 handler({button:0,preventDefault(){prevented=true;}});
 assert.equal(context.selected,null);assert.equal(prevented,false);
 assert.equal(painted,0,'redrawing the image before compatibility mousedown can make native drag arrive after mouse-up');
 assert.equal(laidOut,1);
});

test('native quick-window resizing refits after manual zoom while the full editor keeps its zoom',()=>{
 const source=readTypeScript(process.env.CIIP_APP_SOURCE||new URL('../src/app.ts',import.meta.url));
 const line=source.split('\n').find(line=>line.startsWith('new ResizeObserver('));let callback,fits=0;
 const context=vm.createContext({ResizeObserver:class{constructor(fn){callback=fn;}observe(){}},$:()=>({}),finishGesture(){},fit(){fits++;},layoutSelection(){},quickEditor:{},autoFit:false,selected:null});
 vm.runInContext(line,context);callback();assert.equal(fits,1);
 context.quickEditor=null;callback();assert.equal(fits,1);
 context.autoFit=true;callback();assert.equal(fits,2);
});
