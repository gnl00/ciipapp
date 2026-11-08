// CPU / canvas-call benchmark only; this does not measure browser rasterization, compositor timing, or FPS.
import {performance} from 'node:perf_hooks';
const path=process.argv[2]||'../src/editor.ts';
const {createDocument,renderDocument,translateAnnotation}=await import(path);
const counts={renders:0,sourceDraws:0,backgroundPixels:0,clearPixels:0};
const owner={createElement(){return makeCanvas();}};
const image={};
function makeCanvas(){
 const canvas={width:0,height:0,ownerDocument:owner};let transform={a:1,b:0,c:0,d:1,e:0,f:0},stack=[];
 const ctx={canvas,filter:'none',save(){stack.push({...transform});},restore(){transform=stack.pop();},setTransform(a,b,c,d,e,f){transform={a,b,c,d,e,f};},scale(x,y){transform.a*=x;transform.d*=y;},translate(x,y){transform.e+=x*transform.a;transform.f+=y*transform.d;},getTransform(){return {...transform};},clearRect(x,y,w,h){counts.clearPixels+=w*h;},drawImage(source){if(source===image)counts.sourceDraws++;},createImageData(w,h){return{width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},putImageData(p){counts.backgroundPixels+=p.width*p.height;},createLinearGradient(){return{addColorStop(){}};},createRadialGradient(){return{addColorStop(){}};},setLineDash(){},beginPath(){},rect(){},clip(){},moveTo(){},lineTo(){},quadraticCurveTo(){},closePath(){},strokeRect(){},fillRect(){},fill(){},stroke(){}};
 canvas.getContext=()=>ctx;return canvas;
}
const doc=createDocument('data:image/png;base64,iVBORw0KGgo=',4000,2400,'benchmark');
doc.appearance={background:'blue',padding:64,radius:24};
doc.annotations=Array.from({length:40},(_,i)=>({id:String(i),type:'rectangle',x:i*40,y:i*20,w:120,h:60,width:4,color:'#c94632'}));
const canvas=makeCanvas(),pixelRatio=Number(process.argv[3]||.4),width=4128,height=2528;
canvas.width=Math.ceil(width*pixelRatio);canvas.height=Math.ceil(height*pixelRatio);
renderDocument(canvas.getContext('2d'),doc,image,{pixelRatio});
for(const key of Object.keys(counts))counts[key]=0;
const start=performance.now();
for(let i=0;i<12;i++) {doc.annotations[39]=translateAnnotation(doc.annotations[39],1,1);renderDocument(canvas.getContext('2d'),doc,image,{pixelRatio});counts.renders++;}
console.log(JSON.stringify({path,pixelRatio,elapsedMs:Math.round((performance.now()-start)*100)/100,...counts}));
