import {errorMessage} from './native.ts';
import type {NativeCall,NativeMethod,NativeResponses,CaptureImage,OCRResult,ShortcutStatus} from './native.ts';
import type {Point,Rect,CiipDocument,Annotation,AnnotationType,TextAnnotation,ArrowAnnotation,Appearance,FrameLayout,SelectionHandle,ArrowStyle,NumberStyle,RedactStyle} from './types.ts';

type Tool = AnnotationType|'select'|'crop'|'ocr';
interface EditorGesture {
 start:Point;moved:boolean;pointerId:number;captureTarget:HTMLElement;
 original?:CiipDocument;previousCrop?:Rect|null;moving?:boolean;resizing?:string;grab?:Point;
 rotating?:boolean;rotation?:ReturnType<typeof beginRotation>;rotationStarted?:boolean;lastPointer?:Point;
}
interface TextEdit {draft:TextAnnotation & {fontSize:number};original?:TextAnnotation;anchor:Point;composing:boolean}
interface PendingDocument {label:string;action:()=>Promise<unknown>;onCancel?:()=>unknown;signal?:AbortSignal}
interface Placement {area:DOMRect;view:DOMRect;width:number;height:number}
import {createDocument, cloneDocument, normalizeRect, clampRect, hitTest, translateAnnotation, renderDocument, outputSize, curveControl, nextNumber, serializeDocument, parseDocument, History, frameLayout, backgroundPresets, drawBackground, selectionHandles, resizeAnnotation, rotateAnnotation, annotationTransform, annotationPoint, selectionFrame} from './editor.ts';

import {createRenderScheduler, previewPixelRatio} from './render-scheduler.ts';
import {beginRotation, updateRotation} from './rotation.ts';
import {createQuickEditor, isQuickMode} from './quick.ts';
import {createPopover, animatePanel} from './popover.ts';
import {randomBackgroundVariant} from './effects.ts';
import {initializeSettings} from './settings.ts';

interface AppElements {
 'capture':HTMLButtonElement;
 'capture-menu-toggle':HTMLButtonElement;
 'capture-menu':HTMLElement;
 'open':HTMLButtonElement;
 'tools':HTMLElement;
 'undo':HTMLButtonElement;
 'redo':HTMLButtonElement;
 'pin':HTMLButtonElement;
 'pin-label':HTMLElement;
 'save':HTMLButtonElement;
 'copy':HTMLButtonElement;
 'tool-name':HTMLElement;
 'colors':HTMLElement;
 'stroke-label':HTMLElement;
 'stroke':HTMLInputElement;
 'stroke-value':HTMLOutputElement;
 'number-options':HTMLElement;
 'number-style':HTMLElement;
 'number-value':HTMLInputElement;
 'number-size':HTMLInputElement;
 'arrow-options':HTMLElement;
 'arrow-style':HTMLElement;
 'arrow-style-label':HTMLElement;
 'text-options':HTMLElement;
 'font-size':HTMLInputElement;
 'redact-options':HTMLElement;
 'redact-style':HTMLElement;
 'redact-style-label':HTMLElement;
 'redact-strength-label':HTMLElement;
 'redact-strength':HTMLInputElement;
 'redact-strength-value':HTMLOutputElement;
 'ocr-options':HTMLElement;
 'ocr-status':HTMLElement;
 'ocr-copy':HTMLButtonElement;
 'ocr-copy-label':HTMLElement;
 'delete':HTMLButtonElement;
 'tool-hint':HTMLElement;
 'workspace':HTMLElement;
 'empty':HTMLElement;
 'start-capture':HTMLButtonElement;
 'start-open':HTMLButtonElement;
 'canvas-scroll':HTMLElement;
 'canvas-wrap':HTMLElement;
 'canvas-stage':HTMLElement;
 'canvas':HTMLCanvasElement;
 'selection-layer':HTMLElement;
 'ocr-layer':HTMLElement;
 'text-editor':HTMLTextAreaElement;
 'selection-actions':HTMLElement;
 'crop-actions':HTMLElement;
 'apply-crop':HTMLButtonElement;
 'cancel-crop':HTMLButtonElement;
 'toast':HTMLElement;
 'busy':HTMLElement;
 'busy-label':HTMLElement;
 'appearance-toggle':HTMLButtonElement;
 'appearance-panel':HTMLElement;
 'appearance-reset':HTMLButtonElement;
 'background-presets':HTMLElement;
 'background-padding':HTMLInputElement;
 'padding-value':HTMLOutputElement;
 'image-radius':HTMLInputElement;
 'radius-value':HTMLOutputElement;
 'filename':HTMLElement;
 'status':HTMLElement;
 'dimensions':HTMLElement;
 'zoom-out':HTMLButtonElement;
 'zoom-value':HTMLButtonElement;
 'zoom-in':HTMLButtonElement;
 'fit':HTMLButtonElement;
 'replace-dialog':HTMLDialogElement;
 'replace-cancel':HTMLButtonElement;
 'replace-confirm':HTMLButtonElement;
}
function $<K extends keyof AppElements>(id:K):AppElements[K];
function $(id:string):HTMLElement;
function $(id:string):HTMLElement {return document.getElementById(id)!;}
const paths:Record<string,string> = {
  rotate:'M19 8a7.4 7.4 0 1 0 .3 7M19 3.5V8h-4.5',
  dismiss:'m8 8 8 8M16 8l-8 8',
  close:'m6 6 12 12M18 6 6 18',

  element:'M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M8 8h8v8H8z',
  window:'M3 5h18v15H3zM3 9h18M6 7h.1M9 7h.1',screen:'M3 4h18v13H3zM8 21h8M12 17v4',image:'M3 4h18v16H3zM3 16l6-6 5 5 3-3 4 4M16 8h.1',
  appearance:'M4 4h16v16H4zM8 8h8v8H8z',highlighter:'m4 16 8-8 5 5-8 8H4zm7-9 3-3 7 7-3 3M3 21h9',ocr:'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M8 8h8M12 8v9',blur:'M7 5h.1M12 4h.1M17 5h.1M5 10h.1M10 10h.1M15 10h.1M20 10h.1M5 15h.1M10 15h.1M15 15h.1M20 15h.1M8 20h.1M14 20h.1',solid:'M4 4h16v16H4zM7 7h10v10H7zM10 10h4v4h-4z',
  capture:'M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4M8 8h8v8H8z',
  chevron:'m8 10 4 4 4-4', select:'m5 3 14 10-7 1-3 7z', arrow:'M5 19 19 5M7 5h12v12',
  'arrow-line':'M4 19 20 5M12 5h8v8',
  'arrow-curved':'M4 19Q3 5 20 5M13 2l7 3-5 6',
  'arrow-tapered':'M3 21Q3.14 21.14 3.29 21Q9.22 15.01 14.66 12.13Q14.96 11.9 15.07 12.26L15.61 14.07Q15.71 14.44 15.87 14.09L21 3L9.91 8.13Q9.56 8.29 9.93 8.39L11.74 8.93Q12.1 9.04 11.87 9.34Q8.99 14.78 3 20.71Q2.86 20.86 3 21Z',
  'arrow-direction':'M4.43 22.43Q4.77 22.77 5.11 22.43L14.65 12.89Q14.99 12.55 15.33 12.89L16.42 13.97Q16.76 14.31 16.93 13.86L21 3L10.14 7.07Q9.69 7.24 10.03 7.58L11.11 8.67Q11.45 9.01 11.11 9.35L1.57 18.89Q1.23 19.23 1.57 19.57Z',
  rectangle:'M4 5h16v14H4z',ellipse:'M21 12a9 7 0 1 1-18 0 9 7 0 1 1 18 0',
  pen:'m14 4 6 6M4 20l2-7L17 2l5 5L11 18z',text:'M4 5h16M12 5v15M8 20h8',
  number:'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0M10 9l2-2v10M10 17h4',
  redact:'M4 5h16v14H4zM4 9h16M4 13h16M8 5v14M12 5v14M16 5v14',
  crop:'M6 2v16h16M2 6h16v16',undo:'m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14',redo:'m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14',
  pin:'m9 3 12 12M11 5l-5 6-3 1 9 9 1-3 6-5M8 16l-6 6',
  copy:'M9 8h11v13H9zM15 4V2H3v15h2',save:'M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8',
};
function icon(name:string='capture') { if(name==='blur')return `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><radialGradient id="ciip-blur-symbol"><stop stop-color="currentColor" stop-opacity=".8"/><stop offset=".5" stop-color="currentColor" stop-opacity=".42"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-opacity=".4" stroke-width="1.2"/><circle cx="12" cy="12" r="8" fill="url(#ciip-blur-symbol)"/></svg>`; return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.capture}"/></svg>`; }
document.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const toolList:[Tool,string,string,string][] = [
  ['select','选择','V','拖动标注以调整位置'],['arrow','箭头','A','拖动绘制箭头 · Shift 锁定方向'],
  ['rectangle','矩形','R','拖动绘制矩形 · Shift 绘制正方形'],['ellipse','椭圆','O','拖动绘制椭圆 · Shift 绘制正圆'],
  ['pen','涂鸦','P','按住拖动，自由手写'],['highlighter','高亮笔','H','拖动高亮，保留下方文字'],['text','文字','T','Enter 完成 · Shift Enter 换行 · Esc 取消'],['number','编号','N','点击放置编号 · 自动递增'],
  ['redact','遮盖','B','拖动框选模糊区域'],['crop','裁剪','C','拖动选区，按 Enter 应用裁剪'],['ocr','识别文字','L','拖动划选文字 · ⌘C 复制'],
];
$('tools').innerHTML = toolList.map(([type,label,key]) => `<button data-tool="${type}" aria-label="${label}" title="${label} (${key})" aria-pressed="${type==='select'}">${icon(type)}</button>`).join('');
const palette = ['#c94632','#e6a32b','#4d9060','#347bc7','#9b66ad','#202322'];
$('colors').innerHTML = palette.map(color => `<button aria-label="颜色 ${color}" style="--swatch:${color}" data-color="${color}" title="${color}"></button>`).join('');

let doc:CiipDocument|null = null, source:HTMLImageElement|null = null, history:History|null = null, selected:string|null = null, tool:Tool = 'select';
let color = palette[0], stroke = 4, scale = 1, autoFit = true, dirty = false, pinID = '';
let arrowStyle:ArrowStyle = 'line', numberStyle:NumberStyle = 'filled', numberRadius = 16, numberOverride:number|null = null;
let redactStyle:RedactStyle='blur', redactStrength=12, penStroke=4, highlightStroke=20;
let ocrResult:OCRResult|null=null, ocrKey='', ocrGeneration=0;
let appearanceGesture:CiipDocument|null=null;
let textEdit:TextEdit|null = null, textSize = 24;
const textInput = $('text-editor');
let preview:Annotation|null = null, gesture:EditorGesture|null = null, cropRect:Rect|null = null, busy = false, toastTimer:ReturnType<typeof setTimeout>|undefined, loadSequence = 0;
const pendingDocuments:PendingDocument[] = [];
const quickTransfers = new Map<string,AbortController>();
let replacingDocument = false;
const canvas = $('canvas'), ctx = canvas.getContext('2d')!;
const selectionLayer = $('selection-layer');
const native = !!window.mygo?.call;
let quickEditor:ReturnType<typeof createQuickEditor>=null;
const capturePopup=createPopover($('capture-menu-toggle'),$('capture-menu'));
const appearancePopup=createPopover($('appearance-toggle'),$('appearance-panel'));
const settings=initializeSettings({call,native,beforeOpen:()=>{finishText();finishGesture();void capturePopup.hide(false,true);void appearancePopup.hide(false,true);},onOCRChange:()=>{ocrKey='';ocrResult=null;$('ocr-layer').replaceChildren();if(tool==='ocr')setTool('select');}});
async function call<K extends NativeMethod>(method:K,...args:unknown[]):Promise<NativeResponses[K]> {
  if (!native) throw new Error('请在 ciip 桌面应用中使用此功能');
  return window.mygo!.call<NativeResponses[K]>(`CaptureService.${method}`,...args);
}
function notify(message:string, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error',error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; },error ? 7500 : 2800);
}
async function run<T>(label:string, action:()=>Promise<T>):Promise<T|undefined> {
  if (busy || $('replace-dialog').open) return;
  finishText();
  finishGesture();
  busy = true;
  $('busy-label').textContent = label;
  $('busy').hidden = false;
  updateUI();
  try { return await action(); }
  catch (error) { notify(errorMessage(error),true); }
  finally { busy = false; $('busy').hidden = true; updateUI(); queueMicrotask(flushDocuments); }
}
function queueDocument(label:string, action:()=>Promise<unknown>, onCancel?:()=>unknown, signal?:AbortSignal) {
  pendingDocuments.push({label, action, onCancel, signal});
  void flushDocuments();
}
async function flushDocuments() {
  if (busy || gesture || replacingDocument || $('replace-dialog').open || !pendingDocuments.length) return;
  replacingDocument = true;
  const next = pendingDocuments.shift()!;
  try {
    const accepted = !next.signal?.aborted && await confirmReplace(next.signal);
    if (accepted && !next.signal?.aborted) await run(next.label, next.action);
    else await next.onCancel?.();
  }
  finally { replacingDocument = false; queueMicrotask(flushDocuments); }
}
async function confirmReplace(signal?:AbortSignal):Promise<boolean> {
  if (signal?.aborted) return false;
  finishText();
  finishGesture();
  if (!dirty) return true;
  const dialog = $('replace-dialog');
  if (dialog.open) return false;
  dialog.showModal(); void animatePanel(dialog,true);
  return new Promise<boolean>(resolve => {
    let closing=false; $('replace-cancel').disabled=false;$('replace-confirm').disabled=false;
    const close = async (accepted:boolean) => {
      if (closing) return;
      closing = true;
      $('replace-cancel').disabled = true;
      $('replace-confirm').disabled = true;
      await animatePanel(dialog,false);
      dialog.close();
      signal?.removeEventListener('abort',abort);
      resolve(accepted && !signal?.aborted);
      queueMicrotask(flushDocuments);
    };
    const abort = () => { void close(false); };
    signal?.addEventListener('abort',abort,{once:true});
    $('replace-cancel').onclick = () => close(false);
    $('replace-confirm').onclick = () => close(true);
    dialog.oncancel = event => { event.preventDefault(); close(false); };
  });
}
function readImage(url:string):Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve,reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法读取图片，请选择 PNG 或 JPEG 图片'));
    img.src = url;
  });
}
async function setDocument(next:CiipDocument, nextPin = '', message = '图片已打开', signal?:AbortSignal) {
  signal?.throwIfAborted();
  const request = ++loadSequence;
  const image = await readImage(next.base);
  signal?.throwIfAborted();
  if (request !== loadSequence) return;
  if (image.naturalWidth !== next.width || image.naturalHeight !== next.height) throw new Error('图片尺寸与编辑数据不一致');
  if (native && pinID && pinID !== nextPin) await call('RestorePin',pinID);
  if (native && nextPin) await call('HidePin',nextPin);
  signal?.throwIfAborted();
  quickEditor?.replaceImage({dataURL:next.base,width:next.width,height:next.height,name:next.name});
  finishText(true);
  ocrGeneration++; ocrResult=null; ocrKey='';
  doc = next; source = image; history = new History(doc!); selected = null;
  pinID = nextPin; dirty = false; preview = null; gesture = null; cropRect = null; numberOverride = null;
  autoFit = true; tool = 'select';
  $('empty').hidden = true; $('canvas-scroll').hidden = false;
  $('filename').textContent = doc!.name;
  $('status').textContent = message;
  setTool('select'); fit();
}
async function loadCapture(data:CaptureImage|null, message = '已自动复制到剪贴板') {
  if (!data) return;
  await setDocument(createDocument(data.dataURL,data.width,data.height,data.name), '', message);
}
async function capture(mode = 'area') {
  if (busy) return;
  void capturePopup.hide();
  const preferences=native?await call('GetPreferences'):null;
  if (preferences?.captureMode!=='quick'&&!await confirmReplace()) return;
  await run('等待截图…', async () => {
    const data = await call('Capture',mode);
    if (data) { await loadCapture(data); notify('已复制到剪贴板'); }
  });
}
async function openImage() {
  if (busy) return;
  void capturePopup.hide();
  if (!await confirmReplace()) return;
  if (!native) {
    const input = document.createElement('input'); input.type='file'; input.accept='image/png,image/jpeg';
    input.onchange = () => run('打开图片…', async () => {
      const file = input.files?.[0]; if (!file) return;
      if (file.size > 64 * 1024 * 1024) throw new Error('图片超过 64 MB，请先缩小文件');
      const url = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result)); reader.onerror=()=>reject(new Error('读取文件失败')); reader.readAsDataURL(file); });
      const image = await readImage(url);
      await setDocument(createDocument(url,image.naturalWidth,image.naturalHeight,file.name));
    });
    input.click(); return;
  }
  await run('打开图片…',async () => { const data = await call('OpenImage'); if (data) await loadCapture(data,'图片已打开 · 标注后可复制或贴图'); });
}
function viewSize() { return tool === 'crop' ? {width:doc!.width,height:doc!.height} : outputSize(doc!); }
function fit() {
  if (!doc) return;
  finishGesture();
  const quickScale=quickEditor?.scale(frameLayout(doc!,{fullImage:tool==='crop'}));
  if(quickScale){scale=quickScale;autoFit=true;render();return;}
  const size = viewSize(), viewport = $('canvas-scroll');
  scale = Math.min(1,Math.max(.02,Math.min((viewport.clientWidth-96)/size.width,(viewport.clientHeight-96)/size.height)));
  autoFit = true; render();
}
function zoom(factor:number) { if (!doc) return; finishGesture(); scale=Math.max(.02,Math.min(8,scale*factor)); autoFit=false; render(); }
const gestureRender=createRenderScheduler(()=>render(true));
function render(interactive=false) {
  if(!interactive)gestureRender.cancel();
  if (!doc) { updateUI(); return; }
  const size = viewSize(),pixelRatio=previewPixelRatio(scale,window.devicePixelRatio||1);
  const backingWidth=Math.ceil(size.width*pixelRatio),backingHeight=Math.ceil(size.height*pixelRatio);
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
  const cssWidth=`${Math.round(size.width*scale)}px`,cssHeight=`${Math.round(size.height*scale)}px`;
  if(canvas.style.width!==cssWidth)canvas.style.width=cssWidth;
  if(canvas.style.height!==cssHeight)canvas.style.height=cssHeight;
  quickEditor?.position(frameLayout(doc!,{fullImage:tool==='crop'}),scale);
  quickEditor?.interacting(!!gesture);
  const visibleDoc=textEdit?.original ? {...doc,annotations:doc!.annotations.filter(a=>a.id!==textEdit!.draft.id)} : doc;
  renderDocument(ctx,visibleDoc,source!,{preview,fullImage:tool==='crop',pixelRatio});
  if(!interactive){layoutText();layoutOCR();}
  layoutSelection();
  if (tool === 'crop' && cropRect) {
    const r = cropRect;
    ctx.save();ctx.scale(pixelRatio,pixelRatio); ctx.fillStyle = '#16211388'; ctx.beginPath(); ctx.rect(0,0,doc!.width,doc!.height); ctx.rect(r.x,r.y,r.w,r.h); ctx.fill('evenodd');
    ctx.strokeStyle='#fff'; ctx.lineWidth=1.5/scale; ctx.setLineDash([6/scale,4/scale]); ctx.strokeRect(r.x,r.y,r.w,r.h); ctx.restore();
  }
  if(!interactive)updateUI();
  else if(gesture?.rotating)$('tool-hint').textContent=`${Math.round(((gesture.rotation!.angle%360)+360)%360)}° · Shift 吸附角度 · Esc 取消`;
  else if(tool==='crop')$('apply-crop').disabled=busy||!cropRect||cropRect.w<2||cropRect.h<2;
}
function updateUI() {
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => { const active = button.dataset.tool===tool; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); button.disabled=busy; });
  document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(button => { button.classList.toggle('selected',button.dataset.color===color); button.setAttribute('aria-pressed',String(button.dataset.color===color)); button.disabled=busy; });
  for (const id of (['copy','save','pin','zoom-in','zoom-out','zoom-value','fit'] as const)) $(id).disabled=!doc||busy||tool==='crop';
  $('capture').disabled=busy; $('start-capture').disabled=busy;
  for (const id of (['capture-menu-toggle','open','start-open','stroke','font-size','delete','cancel-crop','number-value','number-size'] as const)) $(id).disabled=busy;
  $('undo').disabled=!history?.canUndo||busy; $('redo').disabled=!history?.canRedo||busy;
  $('delete').hidden=!selected||tool==='ocr';
  const active = doc?.annotations.find(a=>a.id===selected);
  $('text-options').hidden=tool!=='text' && active?.type!=='text' && !textEdit;
  const kind=textEdit?'text':active?.type||tool;
  $('stroke-label').hidden=['text','number','redact','ocr','crop'].includes(kind);
  $('colors').hidden=['ocr','crop'].includes(kind)||(kind==='redact'&&(active?.style||redactStyle)!=='solid');
  $('redact-options').hidden=kind!=='redact';
  const cover=active?.type==='redact'?active.style||'solid':redactStyle;
  segmentValue('redact-style',cover);
  $('redact-style-label').textContent=({blur:'模糊',pixelate:'打码',solid:'实色'})[cover];
  $('redact-strength-label').hidden=cover==='solid';
  $('redact-strength').value=String(active?.type==='redact'?active.intensity||12:redactStrength);
  $('ocr-options').hidden=tool!=='ocr';
  $('ocr-copy').disabled=busy||!ocrResult?.lines?.length;
  $('appearance-toggle').disabled=!doc||busy||tool==='crop';
  const appearance={background:'none',padding:40,radius:0,...doc?.appearance};
  $('background-padding').value=String(appearance.padding); $('background-padding').disabled=busy||appearance.background==='none';
  $('image-radius').value=String(appearance.radius); $('image-radius').disabled=busy;
  document.querySelectorAll<HTMLButtonElement>('[data-background]').forEach(button=>{
    const isActive=button.dataset.background===appearance.background;button.setAttribute('aria-pressed',String(isActive));button.disabled=busy;
    const thumb=button.querySelector('canvas')!,variant=String(appearance.variant??'original');
    if(isActive&&appearance.background!=='none'&&thumb.dataset.variant!==variant){drawBackground(thumb.getContext('2d')!,appearance.background,120,72,appearance.variant);thumb.dataset.variant=variant;}
  });
  if(document.activeElement!==$('font-size'))$('font-size').value=String(textEdit?.draft.fontSize ?? (active?.type==='text'?active.fontSize??28:textSize));
  $('arrow-options').hidden=tool!=='arrow' && active?.type!=='arrow';
  $('number-options').hidden=tool!=='number' && active?.type!=='number';
  const arrowValue=active?.type==='arrow'?active.style||'line':arrowStyle;
  segmentValue('arrow-style',arrowValue==='pointer'?'line':arrowValue);
  segmentValue('number-style',active?.type==='number'?active.style||'filled':numberStyle);
  $('arrow-style-label').textContent=({line:'直线',pointer:'直线',curved:'弯曲',tapered:'渐粗',direction:'方向'})[arrowValue];
  $('number-size').value=String(active?.type==='number' ? active.radius ?? 18 : numberRadius);
  const numberValue=active?.type==='number' ? active.number : numberOverride ?? nextNumber(doc?.annotations || []);
  if(document.activeElement!==$('number-value'))$('number-value').value=String(numberValue ?? '');
  $('number-value').placeholder=numberValue===null?'已到 999':'';
  const activeStroke=active?.width??stroke;
  $('stroke').max=String(Math.max(32,Math.ceil(activeStroke)));$('stroke').value=String(activeStroke);
  $('crop-actions').hidden=tool!=='crop'||!doc;
  $('apply-crop').disabled=busy||!cropRect||cropRect.w<2||cropRect.h<2;
  $('pin-label').textContent = pinID ? '更新贴图' : '贴图';
  $('pin').setAttribute('aria-label',pinID?'更新贴图':'贴图');
  $('pin').title=pinID?'更新当前贴图 ⇧⌘P':'贴图 ⇧⌘P';
  const details=toolList.find(t=>t[0]===tool)!;
  $('tool-name').textContent=details[1]; $('tool-hint').textContent=details[3];
  if((tool==='arrow'&&arrowStyle==='curved')||(active?.type==='arrow'&&active.style==='curved'))$('tool-hint').textContent='拖动控制点调整弧度';
  if(kind==='redact')$('tool-hint').textContent=cover==='pixelate'?'拖动框选打码区域':cover==='solid'?'拖动框选实色覆盖区域':'拖动框选模糊区域';
  if(active&&tool==='select')$('tool-hint').textContent=active.type==='arrow'?'拖动端点调整箭头 · 拖动线条移动':active.type==='text'?'拖动角点缩放 · 双击编辑文字':'拖动边角调整大小 · 拖动元素移动';
  if(gesture?.rotating)$('tool-hint').textContent=`${Math.round(((gesture.rotation!.angle%360)+360)%360)}° · Shift 吸附角度 · Esc 取消`;
  canvas.className=tool==='select'?'selecting':tool==='text'||tool==='ocr'?'typing':'drawing';
  updateRanges();
  if (doc) { const size=outputSize(doc!); $('dimensions').textContent=`${size.width} × ${size.height} px`; $('zoom-value').textContent=`${Math.round(scale*100)}%`; }
}
function setTool(next:Tool) {
  if (busy) return;
  finishText();
  finishGesture();
  const previous=tool;
  if(tool==='pen')penStroke=stroke;if(tool==='highlighter')highlightStroke=stroke;
  if(next==='pen')stroke=penStroke;if(next==='highlighter'){stroke=highlightStroke;if(color===palette[0])color=palette[1];}
  tool=next; selected=null; preview=null; gesture=null;
  if (tool==='crop') cropRect=doc?.crop ? {...doc!.crop} : null;
  else cropRect=null;
  if ((previous==='crop'||tool==='crop') && doc) fit(); else render();
  if(next==='ocr'&&doc)void recognizeText();

}
function changed() { ocrKey=''; history!.push(doc!); dirty=true; $('status').textContent=pinID?'已编辑 · 贴图尚未更新':'已编辑 · ⌘C 复制当前结果'; render(); }
function undo(redo=false) {
  if (!history || busy) return;
  finishText();
  finishGesture(true);
  const next=redo?history!.redo():history!.undo();
  if (next) { ocrGeneration++;ocrResult=null;ocrKey='';if(tool==='ocr')tool='select';doc=next; selected=null; preview=null; gesture=null; if(tool==='crop')cropRect=doc!.crop?{...doc!.crop}:null; dirty=true; $('status').textContent=redo?'已重做':'已撤销'; if(autoFit)fit();else render(); }
}
function pointer(event:MouseEvent, outside=false):Point {
  const rect=canvas.getBoundingClientRect();
  const layout=frameLayout(doc!,{fullImage:tool==='crop'}),origin=layout.crop;
  let x=(event.clientX-rect.left)*layout.width/rect.width+origin.x-layout.offsetX;
  let y=(event.clientY-rect.top)*layout.height/rect.height+origin.y-layout.offsetY;
  if (!outside) { x=Math.max(origin.x,Math.min(origin.x+origin.w,x)); y=Math.max(origin.y,Math.min(origin.y+origin.h,y)); }
  return {x,y};
}
function newAnnotation(start:Point):Annotation {
  const common={id:crypto.randomUUID(),color,width:stroke};
  if (tool==='arrow') return {...common,type:'arrow',points:[start,start],style:arrowStyle};
  if (tool==='pen'||tool==='highlighter') return {...common,type:tool,points:[start,start]};
  if (tool==='redact')return {...common,type:'redact',x:start.x,y:start.y,w:0,h:0,style:redactStyle,intensity:redactStrength};
  return {...common,type:tool as 'rectangle'|'ellipse',x:start.x,y:start.y,w:0,h:0};
}
const handleNames:Record<string,string>={nw:'左上角缩放',n:'上边缩放',ne:'右上角缩放',e:'右边缩放',se:'右下角缩放',s:'下边缩放',sw:'左下角缩放',w:'左边缩放',start:'箭头起点',end:'箭头终点',curve:'箭头弯曲控制点'};
function activeHandles(annotation:Annotation):SelectionHandle[] {
  const handles=selectionHandles(annotation);
  if(annotation.type==='arrow'&&annotation.style==='curved')handles.push({id:'curve',...annotationPoint(annotation,curveHandle(annotation)),cursor:'move'});
  return handles;
}
function layoutSelection() {
  const active=doc?.annotations.find(a=>a.id===selected);
  selectionLayer.hidden=!active||!!textEdit||tool==='crop'||tool==='ocr';
  $('selection-actions').hidden=selectionLayer.hidden;
  if(selectionLayer.hidden||!active)return;
  const handles=activeHandles(active),layout=frameLayout(doc!),sx=canvas.clientWidth/layout.width,sy=canvas.clientHeight/layout.height;
  const workspace=$('workspace'),placement={area:workspace.getBoundingClientRect(),view:canvas.getBoundingClientRect(),width:workspace.clientWidth,height:workspace.clientHeight};
  const signature=active.id+':'+handles.map(h=>h.id).join(',');
  if(selectionLayer.dataset.signature!==signature) {
    selectionLayer.replaceChildren();
    const frame=document.createElement('div');frame.className='selection-frame';selectionLayer.append(frame);
    for(const handle of handles) {
      const button=document.createElement('button');button.type='button';button.className='selection-handle';button.dataset.handle=handle.id;
      button.setAttribute('aria-label',handleNames[handle.id]);button.title=`${handleNames[handle.id]} · 方向键微调`;selectionLayer.append(button);
    }
    selectionLayer.dataset.signature=signature;
  }
  const position=(p:Point)=>({left:`${(p.x-layout.crop.x+layout.offsetX)*sx}px`,top:`${(p.y-layout.crop.y+layout.offsetY)*sy}px`});
  const {bounds,matrix:m}=selectionFrame(active),frame=selectionLayer.querySelector<HTMLElement>('.selection-frame')!;
  frame.hidden=active.type==='arrow';
  Object.assign(frame.style,{...position(annotationPoint(active,bounds)),width:`${bounds.w*sx}px`,height:`${bounds.h*sy}px`,transformOrigin:'0 0',transform:`matrix(${m.a},${m.b*sy/sx},${m.c*sx/sy},${m.d},0,0)`});
  for(const handle of handles) {
    const button=selectionLayer.querySelector<HTMLButtonElement>(`[data-handle="${handle.id}"]`)!;
    Object.assign(button.style,{...position(handle),cursor:handle.cursor});button.disabled=busy||!!gesture?.rotating;
  }
  const actions=$('selection-actions');
  actions.querySelectorAll<HTMLButtonElement>('button').forEach(button=>{button.disabled=busy||(!!gesture&&!(gesture.rotating&&button.dataset.selectionAction==='rotate'));});
  actions.classList.toggle('is-transforming',!!gesture&&!gesture.rotating);
  actions.classList.toggle('is-rotating',!!gesture?.rotating);
  $('workspace').classList.toggle('is-rotating',!!gesture?.rotating);
  positionSelectionActions(active,bounds,layout,sx,sy,placement);
}
function positionSelectionActions(active:Annotation,bounds:Rect,layout:FrameLayout,sx:number,sy:number,placement:Placement) {
  const actions=$('selection-actions'),{area,view,width,height}=placement;
  const screen=(p:Point)=>{const q=annotationPoint(active,p);return {x:view.left-area.left+(q.x-layout.crop.x+layout.offsetX)*sx,y:view.top-area.top+(q.y-layout.crop.y+layout.offsetY)*sy};};
  const center=screen({x:bounds.x+bounds.w/2,y:bounds.y}),right=screen({x:bounds.x+bounds.w,y:bounds.y});
  const m=annotationTransform(active),normalLength=Math.hypot(m.c*sx,m.d*sy),tangentLength=Math.hypot(m.a*sx,m.b*sy);
  const nx=-m.c*sx/normalLength,ny=-m.d*sy/normalLength,tx=m.a*sx/tangentLength,ty=m.b*sy/tangentLength;
  const separation=Math.max(0,32-Math.hypot(right.x-center.x,right.y-center.y));
  const clamp=(p:Point)=>({x:Math.max(16,Math.min(width-16,p.x)),y:Math.max(16,Math.min(height-16,p.y))});
  const rotate=clamp({x:center.x+nx*28,y:center.y+ny*28}),dismiss=clamp({x:right.x+nx*28+tx*separation,y:right.y+ny*28+ty*separation});
  // Keep both hit areas reachable when their anchors meet a viewport edge.
  if(Math.hypot(dismiss.x-rotate.x,dismiss.y-rotate.y)<30)dismiss.x=rotate.x+(rotate.x>width/2?-32:32);
  for(const [name,p] of ([['rotate',rotate],['dismiss',dismiss]] as const))Object.assign(actions.querySelector<HTMLElement>(`[data-selection-action=${name}]`)!.style,{left:`${p.x}px`,top:`${p.y}px`});
}
const selectionActions=$('selection-actions');
selectionActions.addEventListener('click',event=>{
  if((event.target as Element).closest<HTMLButtonElement>('[data-selection-action]')?.dataset.selectionAction!=='dismiss'||busy||gesture)return;
  selected=null;render();canvas.focus();
});
selectionActions.addEventListener('pointerdown',event=>{
  const button=(event.target as Element).closest<HTMLButtonElement>('[data-selection-action=rotate]'),active=doc?.annotations.find(a=>a.id===selected);
  if(!button||!active||busy||gesture||event.button!==0)return;
  event.preventDefault();event.stopPropagation();canvas.focus({preventScroll:true});
  const start=pointer(event,true),{bounds}=selectionFrame(active),center=annotationPoint(active,{x:bounds.x+bounds.w/2,y:bounds.y+bounds.h/2});
  button.setPointerCapture(event.pointerId);
  gesture={start,original:cloneDocument(doc!),rotating:true,rotation:beginRotation(center,start,{initialAngle:active.rotation||0,minRadius:6/scale}),lastPointer:start,moved:false,pointerId:event.pointerId,captureTarget:button};
  layoutSelection();
});
selectionActions.addEventListener('keydown',event=>{
  if(!(event.target as Element).closest<HTMLButtonElement>('[data-selection-action=rotate]')||!selected||busy||gesture)return;
  const direction={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[event.key];
  if(!direction)return;
  event.preventDefault();event.stopPropagation();
  doc!.annotations=doc!.annotations.map(a=>a.id===selected?rotateAnnotation(a,direction*(event.shiftKey?15:1)):a);changed();
});
$('canvas-scroll').addEventListener('scroll',()=>{if(gesture?.rotating)finishGesture();if(selected)layoutSelection();},{passive:true});
function resizeSelected(original:Annotation,handle:string,point:Point):Annotation {
  if(handle==='curve'&&original.type==='arrow') {
    const [first,last]=original.points,local=annotationPoint(original,point,true);
    const next={...original,control:{x:2*local.x-(first.x+last.x)/2,y:2*local.y-(first.y+last.y)/2}};
    const anchor=annotationPoint(original,first),moved=annotationPoint(next,first);
    return translateAnnotation(next,anchor.x-moved.x,anchor.y-moved.y);
  }
  return resizeAnnotation(original,handle,point);
}
selectionLayer.addEventListener('pointerdown',event=>{
  const button=(event.target as Element).closest<HTMLButtonElement>('[data-handle]'),active=doc?.annotations.find(a=>a.id===selected);
  if(!button||!active||busy||gesture||event.button!==0)return;
  event.preventDefault();event.stopPropagation();canvas.focus();
  const start=pointer(event,true),handle=activeHandles(active).find(h=>h.id===button.dataset.handle)!;
  button.setPointerCapture(event.pointerId);
  gesture={start,original:cloneDocument(doc!),resizing:handle.id,grab:{x:start.x-handle.x,y:start.y-handle.y},moved:false,pointerId:event.pointerId,captureTarget:button};
});
selectionLayer.addEventListener('keydown',event=>{
  const button=(event.target as Element).closest<HTMLButtonElement>('[data-handle]'),active=doc?.annotations.find(a=>a.id===selected);
  const directions:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},direction=directions[event.key];
  if(!button||!active||!direction||busy||gesture)return;
  event.preventDefault();event.stopPropagation();
  const handle=activeHandles(active).find(h=>h.id===button.dataset.handle)!,step=event.shiftKey?10:1;
  doc!.annotations=doc!.annotations.map(a=>a.id===selected?resizeSelected(a,handle.id,{x:handle.x+direction[0]*step,y:handle.y+direction[1]*step}):a);changed();
});
canvas.addEventListener('pointerdown',event=>{
  quickEditor?.resetMove();
  if(!doc||busy||gesture||event.button!==0||tool==='ocr') return;
  finishText(); canvas.focus({preventScroll:true});
  const raw=pointer(event,true), area=frameLayout(doc!,{fullImage:tool==='crop'}).crop;
  if(raw.x<area.x||raw.y<area.y||raw.x>area.x+area.w||raw.y>area.y+area.h)return;
  const start=pointer(event);
  const match=tool==='select'?[...doc!.annotations].reverse().find(a=>hitTest(a,start,6/scale)):null;
  if(tool==='select'&&!match&&quickEditor?.moveCanvas(event)){selected=null;layoutSelection();requestAnimationFrame(updateUI);return;}
  event.preventDefault();
  if(tool==='text') {
    const existing=[...doc!.annotations].reverse().find((a):a is TextAnnotation=>a.type==='text'&&hitTest(a,start,3/scale));
    beginText(start,existing);return;
  }
  canvas.setPointerCapture(event.pointerId);
  if(tool==='select') {
    selected=match?.id||null;
    if(match) {
      color=match.color; stroke=match.width;
      if(match.type==='text')textSize=match.fontSize??28;
      if(match.type==='redact'){redactStyle=match.style||'solid';redactStrength=match.intensity||12;}
      if(match.type==='arrow')arrowStyle=match.style==='pointer'?'line':match.style||'line';
      if(match.type==='number'){numberStyle=match.style||'filled';numberRadius=match.radius??18;}
      gesture={start,original:cloneDocument(doc!),moving:true,moved:false,pointerId:event.pointerId,captureTarget:canvas};
    }
  } else if(tool==='number') {
    const number=numberOverride ?? nextNumber(doc!.annotations);
    if(number===null){notify('编号已到 999，请输入新的起始编号');$('number-value').focus();return;}
    doc!.annotations.push({id:crypto.randomUUID(),type:'number',x:start.x,y:start.y,number,radius:numberRadius,style:numberStyle,color,width:stroke});
    numberOverride=null; changed();
  } else {
    gesture={start,moved:false,pointerId:event.pointerId,captureTarget:canvas,previousCrop:cropRect};
    if(tool==='crop')cropRect=null;else preview=newAnnotation(start);
  }
  render();
});
canvas.addEventListener('dblclick',event=>{
  if(!doc||busy||tool!=='select')return;
  const start=pointer(event),match=[...doc!.annotations].reverse().find((a):a is TextAnnotation=>a.type==='text'&&hitTest(a,start,3/scale));
  if(match){event.preventDefault();beginText(start,match);}
});
function moveGesture(event:PointerEvent) {
  if(!gesture||!doc||busy||event.pointerId!==gesture.pointerId)return;
  let end=pointer(event,!!gesture.resizing||!!gesture.rotating);
  const {start}=gesture; let dx=end.x-start.x,dy=end.y-start.y;
  if(Math.hypot(dx,dy)>1/scale)gesture.moved=true;
  if(gesture.rotating) {
    rotateGesture(end,event.shiftKey);return;
  } else if(gesture.resizing) {
    const point={x:end.x-gesture.grab!.x,y:end.y-gesture.grab!.y};
    doc!.annotations=gesture.original!.annotations.map(a=>a.id===selected?resizeSelected(a,gesture!.resizing!,point):a);
  } else if(gesture.moving) {
    doc!.annotations=gesture.original!.annotations.map(a=>a.id===selected?translateAnnotation(a,dx,dy):a);
  } else if(tool==='crop')cropRect=clampRect(normalizeRect(start,end),doc!.width,doc!.height);
  else if(preview) {
    if(event.shiftKey && tool==='arrow') { const angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4,length=Math.hypot(dx,dy); end={x:start.x+Math.cos(angle)*length,y:start.y+Math.sin(angle)*length}; }
    if(event.shiftKey && (tool==='rectangle'||tool==='ellipse')) { const side=Math.min(Math.abs(dx),Math.abs(dy)); end={x:start.x+Math.sign(dx)*side,y:start.y+Math.sign(dy)*side}; }
    if(tool==='pen'||tool==='highlighter') { for(const sample of (event.getCoalescedEvents?.().length?event.getCoalescedEvents():[event])) {if(preview.points!.length<20000)preview.points!.push(pointer(sample));} }
    else if(tool==='arrow')preview.points=[start,end];
    else Object.assign(preview,normalizeRect(start,end));
  }
  gestureRender.request();
}
function rotateGesture(point:Point,snap:boolean) {
  if(!gesture?.rotating||!doc)return;
  const current=gesture;
  current.lastPointer=point;
  current.rotationStarted ||= Math.hypot(point.x-current.start.x,point.y-current.start.y)>1/scale;
  if(!current.rotationStarted)return;
  current.rotation=updateRotation(current.rotation!,point,{snap});
  const delta=current.rotation!.delta;
  current.moved=Math.abs(((delta+180)%360+360)%360-180)>.01;
  doc!.annotations=current.original!.annotations.map(a=>a.id===selected&&current.moved?rotateAnnotation(a,delta):a);
  gestureRender.request();
}
for(const target of [canvas,selectionLayer,selectionActions])target.addEventListener('pointermove',moveGesture);
for(const type of ['keydown','keyup'] as const)document.addEventListener(type,event=>{
  if(event.key==='Shift'&&gesture?.rotating)rotateGesture(gesture.lastPointer!,event.type==='keydown');
});
function finishGesture(cancelled=false) {
  if(!gesture)return;
  gestureRender.cancel();
  const current=gesture; gesture=null;
  if(current.captureTarget?.hasPointerCapture(current.pointerId))current.captureTarget.releasePointerCapture(current.pointerId);
  $('workspace').classList.remove('is-rotating');
  if(cancelled) { if(current.original)doc=current.original; if(tool==='crop')cropRect=current.previousCrop||null; preview=null; render(); queueMicrotask(flushDocuments); return; }
  let committed=false;
  if(current.moving||current.resizing||current.rotating) {
    if(current.moved) {
      const active=doc!.annotations.find(a=>a.id===selected);
      if(current.resizing&&active){stroke=active.width;if(active.type==='text')textSize=active.fontSize??28;if(active.type==='number')numberRadius=active.radius??18;}
      changed();committed=true;
    } else doc=current.original!;
  }
  else if(tool!=='crop'&&preview) {
    if(current.moved || tool==='pen'||tool==='highlighter') { doc!.annotations.push(preview); if(preview.type==='arrow'&&preview.style==='curved')selected=preview.id; preview=null; changed();committed=true; }
    else preview=null;
  }
  if(!committed)render();
  queueMicrotask(flushDocuments);
}
for(const target of [canvas,selectionLayer,selectionActions]) {
  target.addEventListener('pointerup',event=>{if(event.pointerId===gesture?.pointerId){moveGesture(event);finishGesture();}});
  target.addEventListener('pointercancel',event=>{if(event.pointerId===gesture?.pointerId)finishGesture(true);});
  target.addEventListener('lostpointercapture',event=>{if(event.pointerId===gesture?.pointerId)finishGesture(true);});
}
window.addEventListener('blur',()=>finishGesture(true));
document.addEventListener('visibilitychange',()=>{if(document.hidden)finishGesture(true);});
function applyCrop() { if(busy||!doc||!cropRect||cropRect.w<2||cropRect.h<2)return; doc!.crop={...cropRect}; changed(); setTool('select'); fit(); }
function removeSelected() { if(busy||!selected||!doc)return; finishGesture(); doc!.annotations=doc!.annotations.filter(a=>a.id!==selected); selected=null; changed(); }
function updateSelectedStyle(changeSize = false) {
  if(busy)return;
  finishGesture();
  if(selected) { const a=doc!.annotations.find(a=>a.id===selected); if(a){ if(changeSize)a.width=stroke;else {a.color=color;if(a.type==='redact'&&!a.style)a.style='solid';} changed(); } }
  else updateUI();
}
function updateAnnotationOption(type:AnnotationType, values:Partial<Annotation>) {
  if(busy)return;
  finishGesture();
  const active=doc?.annotations.find(a=>a.id===selected);
  if(active?.type===type){Object.assign(active,values);changed();}
  else updateUI();
}
function exportPNG() {
  if(!doc)throw new Error('请先截图或打开图片');
  const size=outputSize(doc!), output=document.createElement('canvas'); output.width=size.width; output.height=size.height;
  renderDocument(output.getContext('2d')!,doc!,source!);
  const data=output.toDataURL('image/png');
  if(data==='data:,')throw new Error('图片过大，无法导出，请先裁剪');
  return data;
}
async function copyImage() { if(!doc||tool==='crop')return; await run('复制图片…',async()=>{ await call('CopyImage',exportPNG()); dirty=false; $('status').textContent='已复制当前图片'; notify('已复制到剪贴板'); await quickEditor?.finish(); }); }
async function saveImage() { if(!doc||tool==='crop')return; await run('保存图片…',async()=>{ const path=await call('SaveImage',exportPNG()); if(path){dirty=false;$('status').textContent='已保存 PNG';notify(`已保存：${path.split('/').pop()}`);await quickEditor?.finish();} }); }
async function pinImage() { if(!doc){if(native)await call('ShowEditor');notify('先截图或打开图片，再贴图',true);return;}if(tool==='crop')return; await run(pinID?'更新贴图…':'创建贴图…',async()=>{
  const dataURL=exportPNG(), json=serializeDocument(doc!);
  if(pinID) await call('UpdatePin',pinID,dataURL,json); else {const rect=canvas.getBoundingClientRect();pinID=await call('PinImage',dataURL,json,{x:rect.left,y:rect.top,width:rect.width,height:rect.height});}
  dirty=false; $('status').textContent='贴图已更新 · 双击贴图关闭'; notify('贴图已就绪 · 滚轮缩放，双击关闭');
  if(quickEditor)await quickEditor.finish();else await call('CloseEditor');
}); }

function segmentValue(id:string,value:string) {
  $(id).querySelectorAll<HTMLButtonElement>('button').forEach(button=>{const active=button.dataset.value===value;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.tabIndex=active?0:-1;button.disabled=busy;});
}
function bindSegments<T extends string>(id:string,onChange:(value:T)=>void) {
  const group=$(id), buttons=[...group.querySelectorAll<HTMLButtonElement>('button')];
  group.onclick=event=>{const button=(event.target as Element).closest<HTMLButtonElement>('button');if(!busy&&button&&group.contains(button))onChange(button.dataset.value as T);};
  group.onkeydown=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||busy)return;
    event.preventDefault();event.stopPropagation();
    const index=buttons.indexOf(document.activeElement as HTMLButtonElement), step=event.key==='ArrowLeft'?-1:1;
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+step+buttons.length)%buttons.length;
    buttons[next].focus();onChange(buttons[next].dataset.value as T);
  };
}
function curveHandle(a:ArrowAnnotation) {
  const [first,last]=a.points,control=curveControl(a);
  return {x:(first.x+2*control.x+last.x)/4,y:(first.y+2*control.y+last.y)/4};
}
function beginText(point:Point,original?:TextAnnotation) {
  finishGesture();
  const draft:TextAnnotation & {fontSize:number}=original?{...structuredClone(original),fontSize:original.fontSize??28}:{id:crypto.randomUUID(),type:'text',x:point.x,y:point.y,text:'',fontSize:textSize,color,width:stroke};
  if(original){color=draft.color;stroke=draft.width;textSize=draft.fontSize;}
  textEdit={draft,original,anchor:annotationPoint(draft,{x:draft.x,y:draft.y}),composing:false};selected=original?.id||null;
  textInput.value=draft.text;textInput.hidden=false;
  render();textInput.focus();textInput.setSelectionRange(textInput.value.length,textInput.value.length);
}
function layoutText() {
  if(!textEdit||!doc)return;
  let a={...textEdit.draft,text:textInput.value};
  const originPoint=annotationPoint(a,{x:a.x,y:a.y});
  a=translateAnnotation(a,textEdit.anchor.x-originPoint.x,textEdit.anchor.y-originPoint.y);
  textEdit.draft=a;
  const layout=frameLayout(doc!),origin=layout.crop,fontSize=a.fontSize*scale;
  ctx.save();ctx.font=`600 ${a.fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
  const lines=textInput.value.split('\n'),width=Math.max(...lines.map(line=>ctx.measureText(line||'输入文字').width));ctx.restore();
  const left=(a.x-origin.x+layout.offsetX)*scale,top=(a.y-origin.y+layout.offsetY)*scale;
  const m=annotationTransform(a);
  textInput.style.transformOrigin='0 0';
  textInput.style.transform=`matrix(${m.a},${m.b},${m.c},${m.d},${(m.a*a.x+m.c*a.y+m.e-a.x)*scale},${(m.b*a.x+m.d*a.y+m.f-a.y)*scale})`;
  Object.assign(textInput.style,{left:`${left}px`,top:`${top}px`,fontSize:`${fontSize}px`,color:a.color,width:`${Math.max(70,Math.min(Math.max(70,canvas.clientWidth-left),width*scale+12))}px`,height:`${Math.max(fontSize*1.3,Math.min(280,lines.length*fontSize*1.3+2))}px`});
}
function finishText(cancelled=false) {
  if(!textEdit)return;
  const {draft,original}=textEdit,value=textInput.value.replace(/\r\n/g,'\n');
  textEdit=null;textInput.hidden=true;selected=original?.id||null;
  if(cancelled){render();queueMicrotask(flushDocuments);return;}
  if(value.trim()) {
    draft.text=value;selected=draft.id;
    if(original&&original.text===value){render();queueMicrotask(flushDocuments);return;}
    if(original)doc!.annotations=doc!.annotations.map(a=>a.id===draft.id?draft:a);else doc!.annotations.push(draft);
    changed();
  } else if(original) {doc!.annotations=doc!.annotations.filter(a=>a.id!==original.id);selected=null;changed();}
  else render();
  queueMicrotask(flushDocuments);
}
textInput.addEventListener('input',layoutText);
textInput.addEventListener('compositionstart',()=>{if(textEdit)textEdit.composing=true;});
textInput.addEventListener('compositionend',()=>{if(textEdit)textEdit.composing=false;layoutText();});
textInput.addEventListener('blur',()=>{const edit=textEdit;queueMicrotask(()=>{if(textEdit===edit)finishText();});});
textInput.addEventListener('keydown',event=>{
  if(event.isComposing||textEdit?.composing||event.keyCode===229)return;
  if(event.key==='Escape'||(event.key==='Enter'&&!event.shiftKey)) {event.preventDefault();event.stopPropagation();finishText(event.key==='Escape');canvas.focus();}
  else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();finishText();void saveImage();}
});

$('capture').onclick=()=>capture(); $('start-capture').onclick=()=>capture();
document.querySelectorAll<HTMLButtonElement>('[data-capture]').forEach(button=>button.onclick=()=>capture(button.dataset.capture));
$('open').onclick=openImage; $('start-open').onclick=openImage;
$('tools').onclick=event=>{ const button=(event.target as Element).closest<HTMLButtonElement>('[data-tool]'); if(button)setTool(button.dataset.tool as Tool); };
$('colors').onclick=event=>{ const button=(event.target as Element).closest<HTMLButtonElement>('[data-color]'); if(button){color=button.dataset.color!;updateSelectedStyle();} };
$('stroke').oninput=()=>{updateRanges();};
$('stroke').onchange=()=>{stroke=Number($('stroke').value);updateSelectedStyle(true);};
bindSegments<RedactStyle>('redact-style',value=>{redactStyle=value;updateAnnotationOption('redact',{style:value});});
$('redact-strength').oninput=updateRanges;
$('redact-strength').onchange=()=>{redactStrength=Number($('redact-strength').value);updateAnnotationOption('redact',{intensity:redactStrength});};
bindSegments<ArrowStyle>('arrow-style',value=>{arrowStyle=value;updateAnnotationOption('arrow',{style:value});});
bindSegments<NumberStyle>('number-style',value=>{numberStyle=value;updateAnnotationOption('number',{style:value});});
$('number-size').onchange=()=>{
  if(busy)return;
  const radius=Number($('number-size').value);
  if(!Number.isFinite(radius)||radius<12||radius>160)return;
  numberRadius=radius;updateAnnotationOption('number',{radius});
};
$('number-value').onchange=()=>{
  if(busy)return;
  const number=Number($('number-value').value);
  if(!Number.isInteger(number)||number<1||number>999){notify('编号需为 1–999 的整数');$('number-value').value='';return;}
  const active=doc?.annotations.find(a=>a.id===selected);
  if(active?.type==='number')updateAnnotationOption('number',{number});
  else{numberOverride=number;updateUI();}
};
$('font-size').onchange=()=>{
  const value=Number($('font-size').value);
  if(busy||!Number.isFinite(value)||value<8||value>512){updateUI();return;}
  textSize=value;updateAnnotationOption('text',{fontSize:value});
};
$('copy').onclick=copyImage; $('save').onclick=saveImage; $('pin').onclick=pinImage;
$('undo').onclick=()=>undo(); $('redo').onclick=()=>undo(true); $('delete').onclick=removeSelected;
$('apply-crop').onclick=applyCrop; $('cancel-crop').onclick=()=>setTool('select');
$('fit').onclick=fit; $('zoom-value').onclick=fit; $('zoom-in').onclick=()=>zoom(1.25); $('zoom-out').onclick=()=>zoom(.8);
new ResizeObserver(()=>{finishGesture();if(quickEditor||autoFit)fit();else if(selected)layoutSelection();}).observe($('workspace'));
$('canvas-scroll').addEventListener('wheel',event=>{if(gesture?.rotating){event.preventDefault();return;}if(event.metaKey||event.ctrlKey){event.preventDefault();zoom(event.deltaY<0?1.1:1/1.1);}}, {passive:false});
document.addEventListener('keydown',event=>{
  const editing=event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target as HTMLElement).isContentEditable;
  if(editing || $('replace-dialog').open || settings.open || busy)return;
  const key=event.key.toLowerCase(), mod=event.metaKey||event.ctrlKey;
  if(mod) {
    const actions:Record<string,()=>unknown>={c:()=>tool==='ocr'?copyRecognizedText():copyImage(),s:saveImage,o:openImage,z:()=>undo(event.shiftKey),'1':fit,'0':()=>{finishGesture();scale=1;autoFit=false;render();},'=':()=>zoom(1.25),'+':()=>zoom(1.25),'-':()=>zoom(.8)};
    if(key==='a'&&tool==='ocr'&&ocrResult){event.preventDefault();const range=document.createRange();range.selectNodeContents($('ocr-layer'));const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);return;}
    if(!native&&key==='p'&&event.shiftKey){event.preventDefault();pinImage();return;}
    if(actions[key]){event.preventDefault();actions[key]();} return;
  }
  if(event.key==='Escape'){const rotating=gesture?.rotating;finishGesture(true);if(rotating){event.preventDefault();return;}if(quickEditor&&!selected&&tool==='select'){event.preventDefault();void quickEditor.finish();return;}selected=null;setTool('select');return;}
  if(event.key==='Enter'&&tool==='crop'){event.preventDefault();applyCrop();return;}
  if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();removeSelected();return;}
  const next=toolList.find(t=>t[2].toLowerCase()===key);if(next){event.preventDefault();setTool(next[0]);}
});
window.addEventListener('ciip:image',event=>queueDocument('打开截图…',()=>loadCapture(event.detail)));
window.addEventListener('ciip:document',event=>queueDocument('打开贴图…',()=>setDocument(parseDocument(event.detail.documentJSON),event.detail.pinID,'正在编辑贴图 · 完成后点击更新贴图')));
function quickTransfer(token:string) {
  let controller = quickTransfers.get(token);
  if (!controller) {
    controller = new AbortController();
    quickTransfers.set(token,controller);
  }
  return controller;
}
window.addEventListener('ciip:quick-transfer-abort',event=>{
  quickTransfer(event.detail.token).abort();
});
window.addEventListener('ciip:quick-document',event=>{
  const {documentJSON,token} = event.detail;
  const {signal} = quickTransfer(token);
  if (signal.aborted) return;
  const acknowledge = (accepted:boolean) => call('FinishQuickTransfer',token,accepted);
  queueDocument('在完整编辑器中打开…',async()=>{
    try {
      await setDocument(parseDocument(documentJSON),'','继续编辑截图',signal);
      if (!signal.aborted) await acknowledge(true);
    } catch (error) {
      if (!signal.aborted) {
        await acknowledge(false);
        throw error;
      }
    }
  },()=>signal.aborted ? undefined : acknowledge(false),signal);
});
window.addEventListener('ciip:pin',pinImage);
window.addEventListener('ciip:pin-closed',event=>{ if(event.detail?.pinID===pinID){pinID='';$('status').textContent='贴图已关闭 · 当前画布仍保留';updateUI();} });
window.addEventListener('ciip:error',event=>notify(typeof event.detail==='string'?event.detail:event.detail?.message||'操作失败',true));
window.addEventListener('ciip:open',openImage);
window.addEventListener('ciip:copy',()=>tool==='ocr'?copyRecognizedText():copyImage());
window.addEventListener('ciip:save',saveImage);
window.addEventListener('ciip:undo',()=>undo());
window.addEventListener('ciip:redo',()=>undo(true));
initializeAppearance();
updateUI();
function updateShortcutLabels(status:ShortcutStatus) {
 for(const [action,label]of ([['area','区域截图'],['window','窗口截图'],['element','元素截图'],['screen','全屏截图']] as const)){
  const button=document.querySelector<HTMLButtonElement>(`[data-capture=${action}]`);if(!button)continue;
  let key=button.querySelector('kbd')!;if(!key){key=document.createElement('kbd');button.append(key);}const display=status?.[action]?.display;key.textContent=display==='未设置'?'':display||'';
  button.title=[label,key.textContent].filter(Boolean).join(' ');
 }
 const area=status?.area?.display||'',pin=status?.pin?.display||'';
 $('capture').title=`区域截图 ${area}`.trim();$('start-capture').querySelector('kbd')!.textContent=area;
 $('pin').title=`贴图 ${pin}`.trim();
}
quickEditor=createQuickEditor({call,loadCapture,finishEditing:()=>{finishText();finishGesture();},serialize:()=>serializeDocument(doc!),notify,
 canCloseCanvas:event=>!!doc&&tool==='select'&&!textEdit&&!gesture&&![...doc!.annotations].reverse().some(a=>hitTest(a,pointer(event),6/scale))});
if(native) call('GetStatus').then(async status=>{
 updateShortcutLabels(status.shortcuts);
 const unavailable=Object.entries(status.shortcuts||{}).filter(([,value])=>value.error).map(([name])=>({area:'区域截图',window:'窗口截图',element:'元素截图',screen:'全屏截图',pin:'贴图'})[name]);
 if(unavailable.length)notify(`${unavailable.join('、')}快捷键注册失败，可在设置中更换`,true);
 if(isQuickMode)await quickEditor!.start();
}).catch(error=>notify(errorMessage(error),true));
window.addEventListener('ciip:shortcuts-changed',()=>{if(native)void call('GetShortcutStatus').then(updateShortcutLabels).catch(error=>notify(errorMessage(error),true));});


function updateRanges() {
  document.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(input=>{
    const percent=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100;
    input.style.setProperty('--range-progress',`${percent}%`);
  });
  for(const [input,output] of ([['stroke','stroke-value'],['redact-strength','redact-strength-value'],['background-padding','padding-value'],['image-radius','radius-value']] as const))$(output).value=$(input).value;
}
function initializeAppearance() {
  for(const preset of backgroundPresets) {
    if(['blue','classic-mesh','white'].includes(preset.id)){const heading=document.createElement('span');heading.className='background-group-label';heading.textContent=({'blue':'艺术背景','classic-mesh':'经典背景','white':'基础'} as Record<string,string>)[preset.id];$('background-presets').append(heading);}
    const button=document.createElement('button'); button.dataset.background=preset.id;
    button.setAttribute('aria-label',`背景：${preset.name}`);button.title=preset.colors.length>1?`${preset.name} · 点击换一组配色`:preset.name;
    const thumb=document.createElement('canvas');thumb.width=120;thumb.height=72;thumb.setAttribute('aria-hidden','true');
    if(preset.id!=='none')drawBackground(thumb.getContext('2d')!,preset.id,120,72);
    else thumb.className='transparent-preview';
    const label=document.createElement('span');label.textContent=preset.name;button.append(thumb,label);
    button.onclick=()=>{
      if(!doc||busy)return; finishText(); finishGesture();
      const appearance={...doc!.appearance,background:preset.id,padding:doc!.appearance?.padding??40,radius:doc!.appearance?.radius||0};
      if(preset.colors.length>1)appearance.variant=randomBackgroundVariant(doc!.appearance?.variant);else delete appearance.variant;
      changeAppearance(appearance,true);

    };
    $('background-presets').append(button);
  }
  for(const [id,key] of ([['background-padding','padding'],['image-radius','radius']] as const)) {
    $(id).oninput=()=>{
      if(!doc||busy)return;
      if(!appearanceGesture)appearanceGesture=cloneDocument(doc!);
      changeAppearance({...doc!.appearance,background:doc!.appearance?.background||'none',padding:doc!.appearance?.padding??40,radius:doc!.appearance?.radius||0,[key]:Number($(id).value)},false);
    };
    $(id).onchange=()=>{if(appearanceGesture){appearanceGesture=null;changed();}};
    $(id).addEventListener('pointercancel',()=>{if(appearanceGesture){doc=appearanceGesture;appearanceGesture=null;if(autoFit)fit();else render();}});
  }
  $('appearance-reset').onclick=()=>changeAppearance({background:'none',padding:40,radius:0},true);
}
function changeAppearance(next:Appearance,commit:boolean) {
  if(!doc||busy)return;
  try{outputSize({...doc,appearance:next});}catch(error){notify(errorMessage(error),true);updateUI();return;}
  doc!.appearance=next;ocrKey='';
  if(commit)changed();else render();
  if(autoFit)fit();
  if(tool==='ocr'){setTool('select');}
}
function selectedRecognizedText() {
  const selection=window.getSelection(),layer=$('ocr-layer');
  return selection?.rangeCount&&layer.contains(selection.anchorNode)&&layer.contains(selection.focusNode)?selection.toString().trim():'';
}
async function recognizeText() {
  if(!doc||busy)return;
  const key=serializeDocument(doc!);
  if(ocrKey===key&&ocrResult){layoutOCR();return;}
  const generation=++ocrGeneration;
  ocrResult=null; $('ocr-layer').replaceChildren();$('ocr-status').textContent='正在识别…';
  await run('识别图片文字…',async()=>{
    const size=outputSize(doc!), full=document.createElement('canvas');full.width=size.width;full.height=size.height;
    renderDocument(full.getContext('2d')!,doc!,source!);
    const ratio=Math.min(1,4096/Math.max(size.width,size.height));
    let input=full;
    if(ratio<1){input=document.createElement('canvas');input.width=Math.max(1,Math.round(size.width*ratio));input.height=Math.max(1,Math.round(size.height*ratio));input.getContext('2d')!.drawImage(full,0,0,input.width,input.height);}
    const result=await call('RecognizeText',input.toDataURL('image/png'));
    if(generation!==ocrGeneration)return;
    const sx=size.width/result.width,sy=size.height/result.height;
    ocrResult={...result,lines:result.lines.map(line=>({...line,x:line.x*sx,y:line.y*sy,w:line.w*sx,h:line.h*sy}))};
    ocrKey=key;
    $('ocr-status').textContent=result.lines.length?`已识别 ${result.lines.length} 行`:'未发现可识别的文字';
    $('ocr-layer').replaceChildren();
    for(const line of ocrResult.lines){const span=document.createElement('span');span.className='ocr-line';span.textContent=line.text;span.title='拖动选择文字';$('ocr-layer').append(span,document.createTextNode('\n'));}
    layoutOCR();updateUI();
  });
  if(!ocrResult)$('ocr-status').textContent='识别未完成，重新选择识别工具可重试';
}
function layoutOCR() {
  const layer=$('ocr-layer');layer.hidden=tool!=='ocr'||!ocrResult;
  if(layer.hidden||!ocrResult)return;
  const size=outputSize(doc!),sx=canvas.clientWidth/size.width,sy=canvas.clientHeight/size.height;
  const spans=layer.querySelectorAll<HTMLElement>('.ocr-line');
  ocrResult.lines.forEach((line,i)=>{
    const fontSize=Math.max(1,line.h*sy),span=spans[i];if(!span)return;
    ctx.save();ctx.font=`${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
    const width=Math.max(1,ctx.measureText(line.text).width);ctx.restore();
    Object.assign(span.style,{left:`${line.x*sx}px`,top:`${line.y*sy}px`,fontSize:`${fontSize}px`,width:`${width}px`,height:`${line.h*sy}px`,transform:`scaleX(${line.w*sx/width})`});
  });
}
async function copyRecognizedText() {
  const text=selectedRecognizedText()||ocrResult?.text;if(!text)return;
  try{await call('CopyText',text);notify('文字已复制');}catch(error){notify(errorMessage(error),true);}
}
$('ocr-copy').onpointerdown=event=>event.preventDefault();
$('ocr-copy').onclick=copyRecognizedText;
document.addEventListener('selectionchange',()=>{$('ocr-copy-label').textContent=selectedRecognizedText()?'复制选中文字':'复制全部';});
document.addEventListener('copy',event=>{if(tool==='ocr'&&selectedRecognizedText()){event.clipboardData!.setData('text/plain',selectedRecognizedText());event.preventDefault();}});
