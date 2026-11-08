import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const mockSource = await fs.readFile(new URL('./mock.js', import.meta.url), 'utf8');
const pageSource = await fs.readFile(new URL('./index.html', import.meta.url), 'utf8');
const pageScript = pageSource.match(/<script>([\s\S]*?)<\/script>/)[1];
const origin = 'http://prototype.invalid';

function pngHeader(width, height) {
  const data = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12);
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return 'data:image/png;base64,' + data.toString('base64');
}
function createBridge(parent = {}) {
  const messages = [];
  parent.postMessage = data => messages.push(data);
  const window = {parent, addEventListener() {}};
  const context = {
    window, location:{origin}, innerWidth:1120, innerHeight:760, structuredClone, atob,
    document:{createElement() {return {getContext:() => ({fillRect() {}, fillText() {}}), toDataURL:() => pngHeader(1280, 720)};}},
  };
  vm.runInNewContext(mockSource, context);
  return {call:window.mygo.call, messages};
}

test('element capture has an unbound shortcut and does not simulate native selection', async () => {
  const {call} = createBridge();
  assert.equal((await call('CaptureService.GetPreferences')).shortcuts.element, '');
  await assert.rejects(call('CaptureService.Capture', 'element'), /原生应用/);
});

test('update preview identifies its simulation and keeps external navigation native-only', async () => {
  const {call} = createBridge();
  const result = await call('CaptureService.CheckForUpdates');
  assert.equal(result.status, 'up_to_date');
  assert.equal(result.currentVersion, result.latestVersion);
  assert.match(result.message, /原型模拟/);
  await assert.rejects(call('CaptureService.OpenUpdatePage'), /原生应用/);
});

test('copy and save receipts report PNG source dimensions rather than viewport dimensions', async () => {
  const {call, messages} = createBridge();
  await call('CaptureService.CopyImage', pngHeader(6000, 4000));
  assert.equal(messages[0].type, 'export-result');
  assert.equal(messages[0].result.action, '复制');
  assert.equal(messages[0].result.width, 6000);
  assert.equal(messages[0].result.height, 4000);
  assert.equal(await call('CaptureService.SaveImage', pngHeader(800, 500)), 'memory://ciip-preview.png');
  assert.equal(messages[1].result.width, 800);
});
test('pin receipts retain the editable annotation count and return distinct memory IDs', async () => {
  const {call, messages} = createBridge();
  const documentJSON = JSON.stringify({annotations:[{id:'one'}, {id:'two'}]});
  const first = await call('CaptureService.PinImage', pngHeader(1280, 720), documentJSON);
  const second = await call('CaptureService.PinImage', pngHeader(1280, 720), documentJSON);
  assert.notEqual(first, second);
  assert.equal(messages[0].result.layers, 2);
  await call('CaptureService.CloseQuick');
  assert.equal(messages.at(-1).type, 'quick-closed');
});
test('invalid output fails without emitting a simulated success', async () => {
  const {call, messages} = createBridge();
  await assert.rejects(call('CaptureService.CopyImage', 'data:,验证失败'), /PNG/);
  await assert.rejects(call('CaptureService.CopyImage', pngHeader(0, 200)), /尺寸/);
  assert.equal(messages.length, 0);
});
test('full-editor close reports dismissal after the pin receipt', async () => {
  const {call,messages}=createBridge();
  await call('CaptureService.PinImage',pngHeader(1280,720),JSON.stringify({annotations:[]}));
  await call('CaptureService.CloseEditor');
  assert.deepEqual(messages.map(message=>message.type),['export-result','editor-closed']);
});
test('closing quick preview reveals the desktop and starting again restores the editor', () => {
  const elements = new Map();
  for (const id of ['app', 'frame', 'desktop', 'note', 'export-report', 'quick', 'editor', 'compact', 'normal', 'settings']) {
    elements.set('#' + id, {style:{}, dataset:{}, hidden:false, focus() {}});
  }
  const app = elements.get('#app');
  app.width = 1120;
  app.height = 760;
  app.contentWindow = {};
  const listeners = {};
  const window = {addEventListener:(type, listener) => {listeners[type] = listener;}};
  vm.runInNewContext(pageScript, {window, location:{origin}, document:{body:{clientWidth:1080}, querySelector:selector => elements.get(selector)}});
  listeners.message({origin, source:app.contentWindow, data:{type:'quick-closed'}});
  assert.equal(app.hidden, true);
  assert.equal(elements.get('#desktop').hidden, false);
  elements.get('#quick').onclick();
  assert.equal(app.hidden, false);
  assert.equal(elements.get('#desktop').hidden, true);
  assert.equal(app.src, './preview.html?mode=quick');
});


test('settings survive a quick-to-full preview switch in the harness memory', async () => {
  const parent = {};
  const first = createBridge(parent);
  const preferences = await first.call('CaptureService.GetPreferences');
  preferences.shortcuts.window = 'CmdOrCtrl+Alt+W';
  preferences.captureMode = 'editor';
  await first.call('CaptureService.SetPreferences', preferences);
  const second = createBridge(parent);
  const restored = await second.call('CaptureService.GetPreferences');
  assert.equal(restored.shortcuts.window, 'CmdOrCtrl+Alt+W');
  assert.equal(restored.captureMode, 'editor');
});
