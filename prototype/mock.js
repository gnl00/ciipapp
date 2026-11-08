const fixture = document.createElement('canvas');
fixture.width = 1280;
fixture.height = 720;
const context = fixture.getContext('2d');
context.fillStyle = '#f8f9f5';
context.fillRect(0, 0, 1280, 720);
context.fillStyle = '#293b30';
context.font = '600 44px system-ui';
context.fillText('ciip · keep an idea close.', 80, 100);
context.font = '25px system-ui';
context.fillStyle = '#7c8b7f';
context.fillText('Capture, edit here, then get back to your work.', 80, 148);
for (const [color, x, y, width, height] of [
  ['#e5ebe5', 80, 190, 1120, 1],
  ['#dce5db', 80, 240, 490, 350],
  ['#e9ded1', 610, 240, 590, 150],
  ['#d7e1e8', 610, 430, 280, 160],
  ['#e5dce7', 930, 430, 270, 160],
]) {
  context.fillStyle = color;
  context.fillRect(x, y, width, height);
}
const qaImage = {dataURL:fixture.toDataURL(), width:1280, height:720, name:'ciip-quick-preview.png'};
let qaPreferences = structuredClone(window.parent.ciipPrototypePreferences || {
  openAtLogin:false, showEditorOnLaunch:true, menuBarVisible:true,
  menuBarStyle:'icon', menuBarIcon:'capture', ocrEngine:'vision', ocrMode:'accurate', captureMode:'quick',
  shortcuts:{area:'CmdOrCtrl+Shift+2', window:'CmdOrCtrl+Alt+3', screen:'CmdOrCtrl+Alt+4', pin:'CmdOrCtrl+Shift+P'},
});
let nextPinID = 0;

function shortcutStatus() {
  const symbols = {Ctrl:'⌃', Alt:'⌥', Shift:'⇧', CmdOrCtrl:'⌘'};
  return Object.fromEntries(Object.entries(qaPreferences.shortcuts).map(([action, accelerator]) => {
    const parts = accelerator ? accelerator.split('+') : [];
    const key = parts.pop() || '';
    const display = Object.keys(symbols).filter(modifier => parts.includes(modifier)).map(modifier => symbols[modifier]).join('') + key;
    return [action, {accelerator, display, registered:!!accelerator}];
  }));
}
function recordExport(action, dataURL, documentJSON) {
  const prefix = 'data:image/png;base64,';
  if (typeof dataURL !== 'string' || !dataURL.startsWith(prefix)) throw Error('原型未收到 PNG 输出');
  const binary = atob(dataURL.slice(prefix.length));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (binary.length < 24 || signature.some((byte, index) => binary.charCodeAt(index) !== byte) || binary.slice(12, 16) !== 'IHDR') {
    throw Error('原型收到的 PNG 头无效');
  }
  const header = Uint8Array.from(binary.slice(16, 24), character => character.charCodeAt(0));
  const view = new DataView(header.buffer);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  if (!width || !height) throw Error('PNG 输出尺寸无效');
  const result = {action, width, height, bytes:binary.length};
  if (documentJSON != null) result.layers = JSON.parse(documentJSON).annotations.length;
  window.parent.postMessage({type:'export-result', result}, location.origin);
}

window.mygo = {call:async (method, ...args) => {
  const name = method.split('.').pop();
  if (name === 'GetStatus') return {version:'0.10.0', shortcuts:shortcutStatus(), captureMode:qaPreferences.captureMode};
  if (name === 'GetShortcutStatus') return shortcutStatus();
  if (name === 'GetPreferences') return structuredClone(qaPreferences);
  if (name === 'SetPreferences') {
    qaPreferences = structuredClone(args[0]);
    window.parent.ciipPrototypePreferences = structuredClone(qaPreferences);
    return structuredClone(qaPreferences);
  }
  if (name === 'BeginShortcutRecording' || name === 'EndShortcutRecording') return shortcutStatus();
  if (name === 'GetQuickCapture') {
    const scale=Math.min(.5,(innerWidth-24)/1280,(innerHeight-140)/720);
    return {image:qaImage,doubleClickMS:500,placement:{panel:{x:0,y:0,width:innerWidth,height:innerHeight},image:{x:(innerWidth-1280*scale)/2,y:28+(innerHeight-140-720*scale)/2,width:1280*scale,height:720*scale},scale,original:true}};
  }
  if(name==='GetQuickBounds')return {x:0,y:0,width:innerWidth,height:innerHeight};
  if(name==='TransformQuickWindow')throw Error('窗口移动和边框缩放请在 ciip 原生应用中验证');
  if (name === 'QuickReady') return null;
  if (name === 'GetAppInfo') return {
    name:'ciip', version:'0.10.0', platform:'darwin', architecture:'arm64', screenPermission:false,
    engines:[{id:'vision', name:'Apple Vision', available:true, detail:'系统离线识别'}, {id:'tesseract', name:'Tesseract', available:false, detail:'未安装'}],
  };
  if (name === 'CheckForUpdates') return {status:'not_configured', message:'更新功能已预留，尚未接入发布服务'};
  if (name === 'CopyImage') {
    recordExport('复制', args[0]);
    return null;
  }
  if (name === 'SaveImage') {
    recordExport('保存', args[0]);
    return 'memory://ciip-preview.png';
  }
  if (name === 'PinImage') {
    recordExport('贴图', args[0], args[1]);
    return `preview-pin-${++nextPinID}`;
  }
  if (name === 'UpdatePin') {
    recordExport('更新贴图', args[1], args[2]);
    return null;
  }
  if (name === 'OpenQuickInEditor') {
    window.parent.postMessage({type:'quick-transfer', documentJSON:args[0]}, location.origin);
    return null;
  }
  if (name === 'FinishQuickTransfer') return null;
  if (name === 'CloseQuick') {
    window.parent.postMessage({type:'quick-closed'}, location.origin);
    return null;
  }
  if (name === 'CloseEditor') {
    window.parent.postMessage({type:'editor-closed'}, location.origin);
    return null;
  }
  throw Error('仅界面预览，此操作未提供内存模拟');
}};
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'fixture') return;
  import('../frontend/src/editor.ts').then(({createDocument, serializeDocument}) => {
    const document = createDocument(qaImage.dataURL, 1280, 720, qaImage.name);
    document.annotations = [
      {id:'label', type:'text', text:'拖动、旋转、缩放', x:360, y:280, fontSize:40, color:'#cc582e', width:4},
      {id:'rect', type:'rectangle', x:700, y:460, w:240, h:120, color:'#347bc7', width:5},
    ];
    window.dispatchEvent(new CustomEvent('ciip:document', {detail:{documentJSON:serializeDocument(document), pinID:''}}));
  });
});
