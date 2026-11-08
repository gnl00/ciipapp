import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultShortcuts,shortcutFromEvent,shortcutLabel,shortcutConflict} from '../src/shortcuts.ts';

test('recorder keeps physical keys stable with Option symbols and keyboard layouts',()=>{
  assert.equal(shortcutFromEvent({key:'£',code:'Digit3',metaKey:true,altKey:true}),'CmdOrCtrl+Alt+3');
  assert.equal(shortcutFromEvent({key:'π',code:'KeyP',metaKey:true,altKey:true,shiftKey:true}),'CmdOrCtrl+Alt+Shift+P');
  assert.equal(shortcutFromEvent({key:'ArrowLeft',code:'ArrowLeft',ctrlKey:true}),'Ctrl+Left');
  assert.equal(shortcutFromEvent({key:'F20',code:'F20',metaKey:true}),'CmdOrCtrl+F20');
});
test('recorder ignores held modifiers and repeats, rejecting unsafe incomplete input',()=>{
  assert.equal(shortcutFromEvent({key:'Shift',code:'ShiftLeft',shiftKey:true}),null);
  assert.equal(shortcutFromEvent({key:'p',code:'KeyP',metaKey:true,repeat:true}),null);
  assert.throws(()=>shortcutFromEvent({key:'p',code:'KeyP'}),/同时按住/);
  assert.throws(()=>shortcutFromEvent({key:'?',code:'Unidentified',metaKey:true}),/不支持/);
  assert.throws(()=>shortcutFromEvent({key:'p',code:'KeyP',metaKey:true,isComposing:true}),/输入法/);
});
test('shortcut labels match macOS modifier order and distinguish disabled bindings',()=>{
  assert.equal(shortcutLabel(defaultShortcuts.area),'⇧⌘2');
  assert.equal(shortcutLabel(defaultShortcuts.window),'⌥⌘3');
  assert.equal(shortcutLabel('CmdOrCtrl+Ctrl+Alt+Shift+Left'),'⌃⌥⇧⌘←');
  assert.equal(shortcutLabel(''),'未设置');
});
test('duplicate assignments are blocked while clearing and keeping a key are allowed',()=>{
  assert.equal(shortcutConflict(defaultShortcuts,'window',defaultShortcuts.area),'区域截图');
  assert.equal(shortcutConflict(defaultShortcuts,'area',defaultShortcuts.area),null);
  assert.equal(shortcutConflict(defaultShortcuts,'area',''),null);
  assert.equal(new Set(Object.values(defaultShortcuts)).size,4);
  assert.notEqual(defaultShortcuts.window,'CmdOrCtrl+Shift+3');
  assert.notEqual(defaultShortcuts.screen,'CmdOrCtrl+Shift+4');
});
