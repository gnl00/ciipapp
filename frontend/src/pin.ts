import {errorMessage} from './native.ts';
import type {PinInitial,NativeMethod,NativeResponses} from './native.ts';
import {createPinZoomController, pinImageLayout} from './pin-zoom.ts';

export function startPin(initial:PinInitial) {
 const image=document.getElementById('image') as HTMLImageElement;
const surface=document.getElementById('surface')!,scaleLabel=document.getElementById('scale')!,controls=document.querySelector<HTMLElement>('.controls')!;
let shadowClosed=false,shadowGeneration=0;
let toolbarMode:'close'|'icons'|'full'|null=null,toolbarAnimation:Animation|null=null;
let toolbarSnapshots:{element:HTMLElement;animation:Animation}[]=[];
function clearToolbarMotion(){toolbarAnimation?.cancel();toolbarAnimation=null;for(const snapshot of toolbarSnapshots){snapshot.animation.cancel();snapshot.element.remove();}toolbarSnapshots=[];}
const focusImage=()=>image.focus({preventScroll:true});
image.addEventListener('pointerdown',focusImage);
window.addEventListener('focus',focusImage);
window.addEventListener('ciip:pin-focus',focusImage);
controls.addEventListener('mousedown',event=>{if(event.button===0){event.preventDefault();focusImage();}});
window.addEventListener('mouseout',event=>{if(!event.relatedTarget)clearToolbarMotion();});
function layoutImage(){
  const layout=pinImageLayout(innerWidth,innerHeight,image.naturalWidth,image.naturalHeight);
  if(!layout)return;
  Object.assign(surface.style,{left:layout.left+'px',top:layout.top+'px',width:layout.width+'px',height:layout.height+'px'});
  scaleLabel.textContent=layout.percentage;
  scaleLabel.setAttribute('aria-label','缩放 '+layout.percentage);
  const mode=layout.width<250||layout.height<54?'close':layout.width<430?'icons':'full';
  if(mode!==toolbarMode){
    const previous=toolbarMode,current=getComputedStyle(controls),from={opacity:current.opacity,transform:current.transform};
    const outgoing=previous===null?null:controls.cloneNode(true) as HTMLElement;
    toolbarAnimation?.cancel();toolbarAnimation=null;
    const before=controls.getBoundingClientRect();
    surface.classList.toggle('compact',mode!=='full');
    surface.classList.toggle('narrow',mode==='close');
    toolbarMode=mode;
    if(previous!==null&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      const style=getComputedStyle(controls),opacity=style.opacity;
      const token=style.getPropertyValue?.('--motion-pin-toolbar').trim()||'';
      const time=/^(\d+(?:\.\d+)?|\.\d+)(ms|s)?$/.exec(token);
      const duration=time&&(time[2]||+time[1]===0)?+time[1]*(time[2]==='s'?1000:1):140;
      const easing=style.getPropertyValue?.('--ease-pin-toolbar').trim()||'cubic-bezier(.2,.8,.2,1)';
      if(opacity!=='0'&&duration){
        // Keep the outgoing contents until the incoming mode is visible. Hiding
        // its groups immediately otherwise makes the toolbar pop into an X.
        if(outgoing){
          const snapshot=document.createElement('div');snapshot.className=`pin-toolbar-previous${previous!=='full'?' compact':''}${previous==='close'?' narrow':''}`;snapshot.setAttribute('aria-hidden','true');snapshot.inert=true;
          for(const node of outgoing.querySelectorAll<HTMLElement>('[id]')){node.dataset.pinControl=node.id;node.removeAttribute('id');}
          for(const button of outgoing.querySelectorAll<HTMLButtonElement>('button')){button.disabled=true;button.tabIndex=-1;}
          Object.assign(outgoing.style,{position:'fixed',left:`${before.left}px`,top:`${before.top}px`,right:'auto',width:`${before.width}px`,height:`${before.height}px`,maxWidth:'none',opacity:from.opacity,transform:from.transform});
          snapshot.append(outgoing);document.body.append(snapshot);
          const animation=outgoing.animate([from,{opacity:0,transform:'translateY(-2px) scale(.96)'}],{duration,easing,fill:'forwards'});
          const remove=()=>{snapshot.remove();toolbarSnapshots=toolbarSnapshots.filter(entry=>entry.element!==snapshot);};
          animation.onfinish=remove;animation.oncancel=remove;toolbarSnapshots.push({element:snapshot,animation});
        }
        toolbarAnimation=controls.animate([{opacity:0,transform:'translateY(-2px) scale(.96)'},{opacity,transform:'none'}],{duration,easing});
      }
    }
  }
}
image.addEventListener('load',()=>{
  layoutImage();focusImage();
  const generation=++shadowGeneration;
  // Transparent window shadows must be recalculated after WebKit paints the image.
  requestAnimationFrame(()=>{
    if(shadowClosed||generation!==shadowGeneration)return;
    requestAnimationFrame(()=>{
      if(!shadowClosed&&generation===shadowGeneration)call('RefreshPinShadow',initial.id).catch(report);
    });
  });
});
window.addEventListener('resize',layoutImage);
image.src=initial.dataURL;
focusImage();
const call=<K extends NativeMethod>(method:K,...args:unknown[]):Promise<NativeResponses[K]>=>window.mygo!.call('CaptureService.'+method,...args);
const report=(error:unknown)=>{const message=document.getElementById('message')!;message.textContent=errorMessage(error);message.style.display='block';setTimeout(()=>message.style.display='none',2400)};
const zoom=createPinZoomController({resize:factor=>call('ResizePin',initial.id,factor),onError:report,lineHeight:parseFloat(getComputedStyle(document.body).lineHeight)||16,pageHeight:()=>innerHeight});
const close=()=>{shadowClosed=true;clearToolbarMotion();zoom.destroy();return call('ClosePin',initial.id).catch(report)};
document.getElementById('minus')!.onclick=()=>zoom.step(1/1.15);document.getElementById('plus')!.onclick=()=>zoom.step(1.15);
document.getElementById('edit')!.onclick=()=>call('EditPin',initial.id).catch(report);
document.getElementById('copy')!.onclick=()=>call('CopyImage',image.src).then(()=>report('已复制')).catch(report);
document.getElementById('close')!.onclick=close;
// Only the image gesture closes a pin; toolbar text and controls are protected too.
window.addEventListener('mousedown',e=>{if(e.button===0&&e.detail===2&&e.target===image){e.preventDefault();close()}},true);
window.addEventListener('dblclick',e=>{if(e.target===image){e.preventDefault();close()}});
window.addEventListener('wheel',zoom.wheel,{passive:false});
const preventGesture=(event:Event)=>event.preventDefault();
window.addEventListener('gesturestart',initial.nativePinch?preventGesture:zoom.gestureStart,{passive:false});
window.addEventListener('gesturechange',initial.nativePinch?preventGesture:zoom.gestureChange,{passive:false});
window.addEventListener('gestureend',initial.nativePinch?preventGesture:zoom.gestureEnd,{passive:false});
window.addEventListener('blur',zoom.gestureCancel);
window.addEventListener('pagehide',()=>{shadowClosed=true;clearToolbarMotion();zoom.destroy();},{once:true});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}else if(e.key==='Enter'&&!(e.target as Element|null)?.closest?.('button')){e.preventDefault();call('EditPin',initial.id).catch(report)}else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='c'){e.preventDefault();call('CopyImage',image.src).then(()=>report('已复制')).catch(report)}});

}
