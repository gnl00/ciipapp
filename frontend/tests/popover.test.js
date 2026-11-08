import test from 'node:test';
import assert from 'node:assert/strict';
import {animatePanel,createPopover} from '../src/popover.ts';

test('background and reduced-motion panels complete without an animation timeline', async () => {
  const element = {getAnimations: () => [], animate: () => {throw new Error('background animation');}};
  globalThis.matchMedia = () => ({matches: false});
  globalThis.document = {hidden: true, hasFocus: () => true};
  await animatePanel(element, true);
  globalThis.document = {hidden: false, hasFocus: () => false};
  await animatePanel(element, false);
  globalThis.document = {hidden: false, hasFocus: () => true};
  globalThis.matchMedia = () => ({matches: true});
  await animatePanel(element, true);
});

test('dismissal completes when the animation timeline stalls after starting', async () => {
  globalThis.document = {hidden: false, hasFocus: () => true};
  globalThis.matchMedia = () => ({matches: false});
  let cancelled = false;
  const element = {getAnimations: () => [], animate: () => ({
    finished: new Promise(() => {}), cancel: () => {cancelled = true;}
  })};
  await animatePanel(element, false);
  assert.equal(cancelled, true);
});

test('interrupted motion still releases the caller waiting to dismiss a panel', async () => {
  globalThis.document = {hidden: false, hasFocus: () => true};
  globalThis.matchMedia = () => ({matches: false});
  let cancelled = 0;
  const element = {getAnimations: () => [], animate: () => ({
    finished: Promise.reject(new Error('interrupted')), cancel: () => {cancelled++;}
  })};
  await animatePanel(element, false);
  assert.equal(cancelled, 1);
});

test('panel motion consumes the inherited design tokens instead of fixing a second duration',async()=>{
 globalThis.document={hidden:false,hasFocus:()=>true};globalThis.matchMedia=()=>({matches:false});
 globalThis.getComputedStyle=()=>({getPropertyValue:name=>({'--motion-panel-in':'140ms','--motion-panel-out':'90ms','--ease-panel':'cubic-bezier(.2,1,.3,1)','--ease-exit':'linear'}[name]||'')});
 const options=[],element={getAnimations:()=>[],animate:(frames,settings)=>{options.push(settings);return {finished:Promise.resolve(),cancel(){}};}};
 try{await animatePanel(element,true);await animatePanel(element,false);assert.deepEqual(options.map(option=>[option.duration,option.easing]),[[140,'cubic-bezier(.2,1,.3,1)'],[90,'linear']]);}
 finally{delete globalThis.getComputedStyle;}
});

test('panel duration tokens accept milliseconds, seconds and zero with malformed values falling back',async()=>{
 globalThis.document={hidden:false,hasFocus:()=>true};globalThis.matchMedia=()=>({matches:false});
 let token;const durations=[];
 globalThis.getComputedStyle=()=>({getPropertyValue:name=>name==='--motion-panel-in'?token:''});
 const element={getAnimations:()=>[],animate:(frames,settings)=>{durations.push(settings.duration);return {finished:Promise.resolve(),cancel(){}};}};
 try{for(const [value,expected]of [['140ms',140],['.2s',200],['0',null],['0ms',null],['garbage',170],['12bad',170],['12',170]]){
  token=value;const before=durations.length;await animatePanel(element,true);
  if(expected===null)assert.equal(durations.length,before);else assert.equal(durations.at(-1),expected);
 }}finally{delete globalThis.getComputedStyle;}
});

test('an appearance panel escapes the footer and stays above its anchor inside a resized window',async()=>{
 const windowEvents={},body={appendChild(element){element.parentElement=this;}};
 let rect={left:124,top:720,bottom:746};
 const trigger={setAttribute(){},addEventListener(){},contains(){return false;}};
 const panel={id:'appearance-panel',dataset:{anchor:'appearance-toggle',placement:'top'},parentElement:{},style:{},hidden:true,offsetWidth:296,offsetHeight:480,
  addEventListener(){},querySelector(){return null;},getAnimations(){return [];}};
 globalThis.document={hidden:false,hasFocus:()=>true,body,getElementById:()=>({getBoundingClientRect:()=>rect}),addEventListener(){}};
 globalThis.window={innerWidth:1000,innerHeight:760,addEventListener:(name,callback)=>windowEvents[name]=callback};
 globalThis.matchMedia=()=>({matches:true});
 const popover=createPopover(trigger,panel);await popover.show();
 assert.equal(panel.parentElement,body);assert.deepEqual(panel.style,{left:'124px',top:'234px'});
 rect={left:170,top:490,bottom:516};window.innerWidth=460;window.innerHeight=540;windowEvents.resize();
 assert.deepEqual(panel.style,{left:'156px',top:'8px'});
 await popover.hide(false,true);
});


test('capture popover escapes the toolbar, follows its anchor and keeps dismissal and focus behavior', async () => {
  const documentEvents={},windowEvents={},triggerEvents={},panelEvents={};
  const toolbar={},body={appendChild(element){element.parentElement=this;}};
  let rect={left:96,bottom:49},focused=0;
  const first={focus(){globalThis.document.activeElement=this;}};
  const trigger={setAttribute(name,value){this[name]=value;},addEventListener(name,callback){triggerEvents[name]=callback;},contains(target){return target===this;},focus(){focused++;}};
  const panel={id:'capture-menu',dataset:{anchor:'capture'},parentElement:toolbar,style:{},hidden:true,inert:false,offsetWidth:238,offsetHeight:164,
    setAttribute(){},getAttribute(name){return name==='role'?'menu':null;},addEventListener(name,callback){panelEvents[name]=callback;},
    contains(target){return target===this||target===first;},querySelector(){return first;},querySelectorAll(){return [first];},getAnimations(){return [];}};
  globalThis.document={hidden:false,hasFocus:()=>true,body,getElementById:id=>id==='capture'?{getBoundingClientRect:()=>rect}:null,addEventListener(name,callback){documentEvents[name]=callback;}};
  globalThis.window={innerWidth:1120,innerHeight:760,addEventListener(name,callback){windowEvents[name]=callback;}};
  globalThis.matchMedia=()=>({matches:true});
  const popover=createPopover(trigger,panel);
  assert.equal(panel.parentElement,body,'the backdrop must not remain inside the toolbar stacking context');
  await popover.show(true);
  assert.equal(panel.hidden,false);assert.equal(trigger['aria-expanded'],'true');
  assert.deepEqual(panel.style,{left:'96px',top:'55px'});
  assert.equal(document.activeElement,first);
  rect={left:720,bottom:500};window.innerWidth=840;window.innerHeight=540;windowEvents.resize();
  assert.deepEqual(panel.style,{left:'594px',top:'368px'});
  let prevented=false;
  documentEvents.keydown({key:'Escape',preventDefault(){prevented=true;},stopImmediatePropagation(){}});
  await Promise.resolve();
  assert.equal(prevented,true);assert.equal(popover.open,false);assert.equal(panel.hidden,true);assert.equal(focused,1);
  await popover.show();documentEvents.pointerdown({target:{}});await Promise.resolve();
  assert.equal(popover.open,false);assert.equal(panel.hidden,true);
  await popover.show();const closing=popover.hide();await popover.show();await closing;
  assert.equal(panel.hidden,false,'reopening must cancel stale dismissal');
  // WebKit moves focus to the page before delivering the next button click.
  document.activeElement=body;panelEvents.focusout({relatedTarget:null});await Promise.resolve();
  assert.equal(popover.open,true,'pointer selection must not make the panel inert before click');
  panelEvents.focusout({relatedTarget:first});await Promise.resolve();
  assert.equal(popover.open,true,'internal focus transitions may report BODY before focusin');
  const outside={};document.activeElement=outside;panelEvents.focusout({relatedTarget:outside});await Promise.resolve();
  assert.equal(popover.open,false,'tabbing into another control still dismisses the panel');
  await popover.hide(false,true);
});
