import {errorMessage} from '../src/native.ts';
import {readTypeScript} from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {shortcutActions,defaultShortcuts,shortcutLabel,shortcutFromEvent,shortcutConflict} from '../src/shortcuts.ts';

const source=readTypeScript(process.env.CIIP_SETTINGS_SOURCE||new URL('../src/settings.ts',import.meta.url))
  .replace(/^import .*\n/gm,'').replace('export function initializeSettings','function initializeSettings');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function harness({endGate,closeGate,updateGate,updateResult,updateError}={}) {
  class Element {
    constructor(){this.nodes=new Map();this.events={};this.dataset={};this.classList={toggle(){},add(){},remove(){}};this.open=false;this.focusCount=0;this.closeCount=0;}
    querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Element());return this.nodes.get(selector);}
    querySelectorAll(){return [];}
    setAttribute(){}
    addEventListener(name,handler){this.events[name]=handler;}
    append(){}
    replaceChildren(){}
    showModal(){this.open=true;this.querySelector('.settings-close').focus();}
    close(){this.open=false;this.closeCount++;}
    focus(){this.focusCount++;document.activeElement=this;}
  }
  const dialog=new Element(),trigger=new Element(),calls=[],animations=[];
  const document={createElement:()=>dialog,body:{append(){}},activeElement:trigger,addEventListener(){}};
  const preferences={shortcuts:{...defaultShortcuts},ocrEngine:'vision'};
  const context=vm.createContext({errorMessage,document,window:{addEventListener(){},dispatchEvent(){}},HTMLInputElement:Element,
    setTimeout,clearTimeout,CustomEvent:class{},shortcutActions,defaultShortcuts,shortcutLabel,shortcutFromEvent,shortcutConflict,
    animatePanel:async(element,opening)=>{animations.push(opening);if(!opening&&closeGate)await closeGate.promise;}});
  vm.runInContext(source,context);
  const settings=context.initializeSettings({native:true,call:async method=>{
    calls.push(method);
    if(method==='GetPreferences')return preferences;
    if(method==='GetAppInfo')return {version:'test',engines:[]};
    if(method==='GetShortcutStatus')return {};
    if(method==='EndShortcutRecording'&&endGate)await endGate.promise;
    if(method==='CheckForUpdates'){
      if(updateError)throw Error(updateError);
      return updateGate?await updateGate.promise:updateResult;
    }
  }});
  return {settings,dialog,trigger,calls,animations,document,close:()=>dialog.querySelector('.settings-close').onclick()};
}

test('opening settings moves browser autofocus from the close button to the non-tabbable heading',async()=>{
  const h=harness();await h.settings.show();
  assert.equal(h.document.activeElement===h.dialog.querySelector('#settings-title'),true);
  assert.equal(h.dialog.querySelector('.settings-close').focusCount,1,'the browser autofocus path must be exercised');
});

test('reopening settings while shortcut recovery is pending cancels stale dismissal',async()=>{
  const endGate=deferred(),h=harness({endGate});await h.settings.show();
  const closing=h.close();await h.settings.show('shortcuts');endGate.resolve();await closing;
  assert.equal(h.settings.open,true);
  assert.equal(h.dialog.closeCount,0);
  assert.equal(h.trigger.focusCount,0,'a stale close must not steal focus from the reopened settings');
});

test('reopening settings interrupts its closing animation and keeps the dialog visible',async()=>{
  const closeGate=deferred(),h=harness({closeGate});await h.settings.show();
  const closing=h.close();await settle();assert.deepEqual(h.animations,[true,false]);
  await h.settings.show('about');closeGate.resolve();await closing;
  assert.equal(h.settings.open,true);
  assert.deepEqual(h.animations,[true,false,true],'reopening should reverse the dismissal motion');
  assert.equal(h.trigger.focusCount,0);
});

test('repeated close requests share one shortcut recovery, dismissal and focus restoration',async()=>{
  const endGate=deferred(),h=harness({endGate});await h.settings.show();
  const first=h.close(),second=h.close();endGate.resolve();await Promise.all([first,second]);
  assert.equal(h.settings.open,false);
  assert.equal(h.calls.filter(method=>method==='EndShortcutRecording').length,1);
  assert.equal(h.dialog.closeCount,1);
  assert.equal(h.trigger.focusCount,1);
  assert.deepEqual(h.animations,[true,false]);
});

test('update checks show progress, prevent duplicates and expose an explicit download action',async()=>{
  const updateGate=deferred(),h=harness({updateGate});await h.settings.show('about');
  const check=h.dialog.querySelector('#check-updates'),download=h.dialog.querySelector('#update-download'),result=h.dialog.querySelector('#update-result');
  const pending=check.onclick();
  assert.equal(check.disabled,true);assert.match(result.textContent,/正在检查/);assert.equal(download.hidden,true);
  await check.onclick();assert.equal(h.calls.filter(name=>name==='CheckForUpdates').length,1);
  updateGate.resolve({status:'available',latestVersion:'0.11.0',message:'发现新版本 0.11.0'});await pending;
  assert.match(result.textContent,/0.11.0/);assert.equal(download.hidden,false);assert.equal(check.disabled,false);
  assert.equal(h.calls.includes('OpenUpdatePage'),false);
  await download.onclick();assert.equal(h.calls.at(-1),'OpenUpdatePage');
});

test('latest and failed checks never expose a misleading download action',async()=>{
  for(const options of [{updateResult:{status:'up_to_date',message:'已是最新正式版本'}},{updateError:'GitHub 请求受限'}]){
    const h=harness(options);await h.settings.show('about');await h.dialog.querySelector('#check-updates').onclick();
    assert.equal(h.dialog.querySelector('#update-download').hidden,true);
    assert.equal(h.dialog.querySelector('#check-updates').disabled,false);
    assert.match(h.dialog.querySelector('#update-result').textContent,options.updateError?/请求受限/:/最新正式版本/);
  }
});

test('a late update response cannot overwrite reopened settings',async()=>{
  const updateGate=deferred(),h=harness({updateGate});await h.settings.show('about');
  const pending=h.dialog.querySelector('#check-updates').onclick();await h.close();await h.settings.show('about');
  updateGate.resolve({status:'available',message:'过期结果'});await pending;
  assert.equal(h.dialog.querySelector('#update-download').hidden,true);
  assert.notEqual(h.dialog.querySelector('#update-result').textContent,'过期结果');
  assert.equal(h.settings.open,true);
});
