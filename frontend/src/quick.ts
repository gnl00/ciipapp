import {errorMessage} from './native.ts';
import type {NativeCall,QuickCapture} from './native.ts';
import type {CaptureImage,ScreenRect,FrameLayout} from './types.ts';
import {quickCanvasRect,fitQuickImage} from './quick-layout.ts';
import {createQuickWindowGesture} from './quick-window.ts';
export const isQuickMode=new URLSearchParams(location.search).get('mode')==='quick';
const glyph=(path:string)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
function createQuickToolScroll(tools:HTMLElement) {
 const frame=document.createElement('div');frame.className='quick-tools';tools.before(frame);
 const buttons=[-1,1].map(direction=>{
  const button=document.createElement('button'),label=`向${direction<0?'左':'右'}查看更多工具`;
  button.type='button';button.className='quick-tool-scroll';button.hidden=true;button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-controls','tools');
  button.innerHTML=glyph(direction<0?'m14 7-5 5 5 5':'m10 7 5 5-5 5');
  button.onclick=event=>tools.scrollBy({left:direction*Math.max(36,tools.clientWidth*.75),behavior:event.detail&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'auto'});
  return button;
 });
 frame.append(buttons[0],tools,buttons[1]);
 function update(){
  const overflowing=tools.scrollWidth>frame.clientWidth+1;
  for(const button of buttons)button.hidden=!overflowing;
  if(!overflowing&&tools.scrollLeft)tools.scrollLeft=0;
  const end=Math.max(0,tools.scrollWidth-tools.clientWidth);
  buttons[0].disabled=tools.scrollLeft<=1;buttons[1].disabled=tools.scrollLeft>=end-1;
 }
 function reveal(button:HTMLElement|null){
  if(!button)return;
  const viewport=tools.getBoundingClientRect(),target=button.getBoundingClientRect();
  const delta=target.left<viewport.left+2?target.left-viewport.left-2:target.right>viewport.right-2?target.right-viewport.right+2:0;
  if(delta)tools.scrollBy({left:delta,behavior:'auto'});
 }
 let active=tools.querySelector<HTMLElement>('[aria-pressed="true"]');
 const resized=new ResizeObserver(()=>{update();reveal(active);});resized.observe(frame);
 const selected=new MutationObserver(()=>{
  const next=tools.querySelector<HTMLElement>('[aria-pressed="true"]');
  if(next!==active){active=next;reveal(active);}
 });
 selected.observe(tools,{subtree:true,attributes:true,attributeFilter:['aria-pressed']});
 const focus=(event:FocusEvent)=>reveal((event.target as Element).closest<HTMLElement>('[data-tool]'));
 tools.addEventListener('scroll',update,{passive:true});tools.addEventListener('focusin',focus);update();
 return {destroy(){resized.disconnect();selected.disconnect();tools.removeEventListener('scroll',update);tools.removeEventListener('focusin',focus);}};
}
export function createQuickEditor({call,loadCapture,finishEditing,serialize,notify,canCloseCanvas}:{call:NativeCall;loadCapture:(image:CaptureImage,message?:string)=>Promise<void>;finishEditing:()=>void|Promise<void>;serialize:()=>string;notify:(message:string,error?:boolean)=>void;canCloseCanvas?:(event:MouseEvent)=>boolean}) {
 if(!isQuickMode)return null;
 document.body.classList.add('quick-mode');
 const toolbar=document.querySelector<HTMLElement>('.toolbar')!,properties=document.querySelector<HTMLElement>('.properties')!,canvas=document.querySelector<HTMLCanvasElement>('#canvas')!;
 const panel=document.createElement('section');panel.className='quick-toolbar';panel.setAttribute('aria-label','快捷编辑工具栏');
 toolbar.before(panel);panel.append(toolbar,properties);
 const toolScroll=createQuickToolScroll(document.querySelector<HTMLElement>('#tools')!);
 const grip=document.createElement('div');grip.className='quick-window-grip';grip.title='拖动移动截图窗口 · 拖动窗口边缘缩放';grip.setAttribute('aria-label','移动截图窗口');document.body.append(grip);
 const full=document.createElement('button');full.className='quick-full';full.title='在完整编辑器中继续';full.setAttribute('aria-label','完整编辑器');full.innerHTML=glyph('M9 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5M13 3h8v8M21 3 11 13');toolbar.append(full);
 const close=document.createElement('button');close.className='quick-close';close.title='结束快捷编辑 Esc · 双击图片空白处也可关闭';close.setAttribute('aria-label','结束快捷编辑');close.innerHTML='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8"/></svg>';document.body.append(close);
 const copy=document.querySelector<HTMLButtonElement>('#copy')!;copy.title='复制当前编辑并完成 ⌘C';copy.querySelector('span:last-child')?.remove();
 const resizeFrame=document.createElement('div');resizeFrame.className='quick-resize-frame';resizeFrame.setAttribute('aria-label','截图窗口边框');
 const edges={n:'上边',e:'右边',s:'下边',w:'左边',nw:'左上角',ne:'右上角',se:'右下角',sw:'左下角'};
 for(const [edge,label]of Object.entries(edges)){const handle=document.createElement('button');handle.dataset.edge=edge;handle.setAttribute('aria-label',`拖动${label}缩放截图窗口`);handle.title=`拖动${label}缩放窗口 · 方向键微调`;resizeFrame.append(handle);}document.body.append(resizeFrame);
 let capture:QuickCapture|null=null,canvasRect:ScreenRect|null=null,ending=false,lastPress:{time:number;x:number;y:number}|null=null,windowPointer:{id:number;target:HTMLElement;ended?:boolean}|null=null,annotationGesture=false;
 const windowGesture=createQuickWindowGesture({getBounds:()=>call('GetQuickBounds'),transform:(initial:ScreenRect,edge:string,dx:number,dy:number)=>call('TransformQuickWindow',initial,edge,dx,dy),onError:(error:unknown)=>notify(errorMessage(error),true),onState:(active:boolean)=>{
  panel.classList.toggle('is-editing',active||annotationGesture);close.disabled=active||annotationGesture;
  if(!active&&windowPointer){const current=windowPointer;windowPointer=null;if(current.target.hasPointerCapture(current.id))current.target.releasePointerCapture(current.id);}
 }});
 const viewport=()=>({width:innerWidth,height:innerHeight});
 const blocked=()=>ending||document.querySelector('dialog[open]')||!document.querySelector<HTMLElement>('#busy')!.hidden;
 const resetMove=()=>{canvas.style.setProperty('--app-region','no-drag');canvas.classList.remove('is-window-moving');};
 function beginWindowGesture(event:PointerEvent,edge:string){
  if(!windowGesture.begin(edge,{x:event.screenX,y:event.screenY}))return false;
  event.preventDefault();event.stopPropagation();
  windowPointer={id:event.pointerId,target:event.currentTarget as HTMLElement};(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);return true;
 }
 function positionControls(){
  if(!canvasRect)return;
  panel.style.transform=`translate(12px,${Math.max(28,innerHeight-104)}px)`;
  const {x,y,width,height}=canvasRect,size=26,inset=8,gap=12,right=x+width;
  const inside=Math.min(width,height)>=size+8&&Math.max(width,height)>=size+inset*2;
  let left=right-size-Math.min(inset,(width-size)/2),top=y+Math.min(inset,(height-size)/2);
  // Keep the full-size control clear of the resize handles when a tiny capture cannot contain both.
  if(!inside){
   if(right+gap+size<=innerWidth-inset){left=right+gap;top=y;}
   else if(x-gap-size>=inset){left=x-gap-size;top=y;}
   else{left=right-size-inset;top=y>=size+inset*2?y-size-inset:y+height+inset;}
  }
  close.style.left=`${Math.max(inset,Math.min(innerWidth-size-inset,left))}px`;
  close.style.top=`${Math.max(inset,Math.min(innerHeight-size-inset,top))}px`;
  Object.assign(resizeFrame.style,{left:`${canvasRect.x}px`,top:`${canvasRect.y}px`,width:`${canvasRect.width}px`,height:`${canvasRect.height}px`});
 }
 async function finish(){if(ending)return;ending=true;windowGesture.cancel();try{await finishEditing();await call('CloseQuick');}catch(error){ending=false;notify(errorMessage(error),true);}}
 full.onclick=async()=>{if(blocked()||windowGesture.active)return;ending=true;try{await finishEditing();await call('OpenQuickInEditor',serialize());}catch(error){ending=false;notify(errorMessage(error),true);}};
 window.addEventListener('ciip:quick-open-editor',()=>full.click());
 close.onclick=()=>{if(blocked())return;void finish();};
 window.addEventListener('ciip:quick-transfer-cancelled',()=>{ending=false;});
 window.addEventListener('blur',()=>{lastPress=null;resetMove();windowGesture.cancel();});
 window.addEventListener('pointermove',event=>{if(event.pointerId===windowPointer?.id)windowGesture.update({x:event.screenX,y:event.screenY});});
 window.addEventListener('pointerup',event=>{if(event.pointerId===windowPointer?.id){windowPointer.ended=true;windowGesture.end({x:event.screenX,y:event.screenY});}resetMove();});
 window.addEventListener('pointercancel',()=>{lastPress=null;resetMove();windowGesture.cancel();});
 window.addEventListener('pagehide',()=>{windowGesture.cancel();toolScroll.destroy();});
 for(const target of [canvas,resizeFrame])target.addEventListener('lostpointercapture',event=>{if(windowPointer&&(event as PointerEvent).pointerId===windowPointer.id&&!windowPointer.ended)windowGesture.cancel();});
 resizeFrame.addEventListener('pointerdown',event=>{const edge=(event.target as Element).closest<HTMLElement>('[data-edge]')?.dataset.edge;if(!blocked()&&edge&&event.button===0)beginWindowGesture(event,edge);});
 resizeFrame.addEventListener('keydown',event=>{
  const edge=(event.target as Element).closest<HTMLElement>('[data-edge]')?.dataset.edge,direction=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,[number,number]>)[event.key];
  if(blocked()||!edge||!direction||!windowGesture.begin(edge,{x:0,y:0}))return;
  event.preventDefault();event.stopPropagation();const step=event.shiftKey?10:1;windowGesture.end({x:direction[0]*step,y:direction[1]*step});
 });
 window.addEventListener('resize',positionControls);
 canvas.addEventListener('dblclick',event=>{if(!blocked()&&canCloseCanvas?.(event)){event.preventDefault();void finish();}});
 return {
  async start(){
   capture=await call('GetQuickCapture');await loadCapture(capture.image,'快捷编辑 · 原图已自动复制');canvas.focus({preventScroll:true});
   // Let WebKit commit the populated canvas before the native window fades in.
   // Hidden WebViews may pause animation frames, so readiness has a short bound.
   await new Promise<void>(resolve=>{const deadline=setTimeout(resolve,50);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(deadline);resolve();}));});
   await call('QuickReady');canvas.focus({preventScroll:true});
  },
  replaceImage(image:CaptureImage){if(capture&&(capture.image.dataURL!==image.dataURL||capture.image.width!==image.width||capture.image.height!==image.height))capture={...capture,image,placement:null};},
  scale(layout:FrameLayout){
   if(!capture)return;
   const initial=capture.placement,base=layout.crop.x===0&&layout.crop.y===0&&layout.width===capture.image.width&&layout.height===capture.image.height&&!layout.offsetX&&!layout.offsetY;
   if(initial&&base&&initial.panel.width===innerWidth&&initial.panel.height===innerHeight)return initial.scale;
   return fitQuickImage(capture.image,viewport(),layout).scale;
  },
  position(layout:FrameLayout,scale:number){
   if(!capture)return;
   const initial=capture.placement,base=layout.crop.x===0&&layout.crop.y===0&&layout.width===capture.image.width&&layout.height===capture.image.height&&!layout.offsetX&&!layout.offsetY;
   const placement=initial&&base&&initial.panel.width===innerWidth&&initial.panel.height===innerHeight?initial:fitQuickImage(capture.image,viewport(),layout);
   canvasRect=quickCanvasRect(placement,capture.image,layout,scale);
   const wrap=document.querySelector<HTMLElement>('#canvas-wrap')!;wrap.style.left=`${canvasRect.x}px`;wrap.style.top=`${canvasRect.y}px`;positionControls();
  },
  resetMove,
  moveCanvas(event:PointerEvent){
   if(blocked()||event.button!==0)return false;
   const press={time:event.timeStamp,x:event.screenX,y:event.screenY},previous=lastPress;lastPress=press;
   // Close before a second press can start another window gesture.
   if(previous&&press.time>=previous.time&&press.time-previous.time<(capture?.doubleClickMS||500)&&Math.hypot(press.x-previous.x,press.y-previous.y)<=4){event.preventDefault();lastPress=null;void finish();return true;}
   const started=beginWindowGesture(event,'move');if(started)canvas.classList.add('is-window-moving');return started;
  },
  interacting(value:boolean){annotationGesture=value;panel.classList.toggle('is-editing',value||windowGesture.active);close.disabled=value||windowGesture.active;},
  finish,
 };
}
