import type {CanvasContext, CanvasSurface, RedactAnnotation} from './types.ts';
interface BackgroundPreset {id: string; name: string; colors: string[]}
type Paint = (color: string) => string;
type ColorChannels = number[];
export const backgroundPresets: BackgroundPreset[] = [
  {id:'none', name:'无背景', colors:[]},
  {id:'blue', name:'美学流体', colors:['#0c245e','#245bc0','#8fd9e5','#e2f2e8']},
  {id:'warm', name:'曲线渐变', colors:['#743d53','#ce8d89','#eed3bc','#fff0d5']},
  {id:'chaos', name:'混沌波浪', colors:['#1635b1','#2096d5','#95e4e0','#f1e88b']},
  {id:'mesh', name:'模糊渐变', colors:['#a4b8df','#edb6b5','#bce0cf','#f5e5c0']},
  {id:'sunset', name:'环境光', colors:['#21152c','#6b3158','#da795d','#ffd1a1']},
  {id:'sage', name:'有机形状', colors:['#225c51','#82aaa0','#c4d3b5','#edf0cf']},
  {id:'vivid', name:'鲜艳抽象', colors:['#293cc5','#9d68dc','#fb5c42','#ffcf58']},
  {id:'paper', name:'淡彩抽象', colors:['#ced2ee','#edbfd0','#f3d8bd','#eef2df']},
  {id:'mono', name:'黑白抽象', colors:['#121416','#4e5357','#c4c8c9','#f4f4f0']},
  {id:'classic-mesh', name:'虹雾', colors:['#b7bbeb','#f4baa8','#8ccdbd','#efe2b4']},
  {id:'classic-warm', name:'杏色沙丘', colors:['#f5d4ad','#d88f79','#a95862','#f2bd8d']},
  {id:'classic-blue', name:'蓝色流体', colors:['#172f69','#315fb0','#68accb','#b6dfdf']},
  {id:'classic-sage', name:'青绿折光', colors:['#275858','#78a69a','#c1d0ab','#e2e6c7']},
  {id:'classic-sunset', name:'暮色光束', colors:['#665c98','#b77e9c','#ecaa96','#f7d397']},
  {id:'classic-paper', name:'暖纸褶影', colors:['#f4eee0','#e5d8c2','#cabb9f','#faf6ed']},
  {id:'white', name:'云白', colors:['#f2f3f0']},
  {id:'charcoal', name:'炭灰', colors:['#303735']},
];

// The variant belongs to the document, never to the render loop.
export function randomBackgroundVariant(previous?: number) {
  const values=new Uint32Array(1);
  if(typeof globalThis.crypto?.getRandomValues==='function')crypto.getRandomValues(values);
  else values[0]=Math.floor(Math.random()*4294967296);
  let value=values[0];
  if(typeof previous==='number'&&Number.isInteger(previous)&&previous>=0&&previous<=4294967295) {
    const difference=Math.abs(value%360-previous%360);
    if(Math.min(difference,360-difference)<45) {
      value=Math.floor(value/360)*360+(previous%360+180)%360;
      if(value>4294967295)value-=360;
    }
  }
  return value;
}

function hsl(hex: string) {
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
  const h=d===0?0:max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4;
  return [h*60,d===0?0:d/(1-Math.abs(2*l-1)),l];
}
function hexHSL(h: number,s: number,l: number) {
  const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h/60%2-1)),m=l-c/2;
  const channels=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return '#'+channels.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
}
function themePaint(preset: BackgroundPreset,variant?: number): Paint {
  if(typeof variant!=='number'||!Number.isInteger(variant)||variant<0||variant>4294967295||preset.colors.length<2)return (value: string)=>value;
  const chroma=(c: number[])=>c[1]*(1-Math.abs(2*c[2]-1));
  const anchor=preset.colors.map(hsl).reduce((best,c)=>chroma(c)>chroma(best)?c:best),hue=variant%360,shift=hue-anchor[0];
  const saturation=.88+((variant>>>9)%29)/100;
  return (value: string)=>{
    const [h,s,l]=hsl(value),nextHue=((s<.08?hue:h+shift)%360+360)%360;
    const nextS=preset.id==='mono'?Math.min(.45,.32+s*.5):Math.min(1,s*saturation);
    return hexHSL(nextHue,nextS,l)+value.slice(7);
  };
}

const clamp01=(value: number)=>Math.max(0,Math.min(1,value));
const smooth=(value: number)=>{const t=clamp01(value);return t*t*(3-2*t);};
const mix=(a: ColorChannels,b: ColorChannels,t: number,out: ColorChannels)=>{for(let i=0;i<3;i++)out[i]=a[i]+(b[i]-a[i])*t;return out;};
const highlightColors={pearl:'#eef9f2',ivory:'#fff8e4',paperWhite:'#f9f8ec',mint:'#dcefe5',white:'#fffffc',violet:'#aa92d0'};
const rgb=(hex: string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
function palette(colors: ColorChannels[], value: number, out: ColorChannels) {
  const t=clamp01(value)*(colors.length-1), index=Math.min(colors.length-2,Math.floor(t));
  return mix(colors[index],colors[index+1],smooth(t-index),out);
}
const meshSpots=[[.02,.1,.28,.23],[.14,.94,.24,.3],[.94,.8,.28,.24],[.86,.03,.25,.2]];
const hash=(a: number,b: number)=>{const n=Math.imul(a,374761393)+Math.imul(b,668265263);return ((Math.imul(n^(n>>>13),1274126177)>>>0)/4294967295);};
const light=(x: number,y: number,cx: number,cy: number,sx: number,sy: number)=>Math.exp(-((x-cx)**2/sx+(y-cy)**2/sy));
function noise(x: number,y: number) {
  const ix=Math.floor(x),iy=Math.floor(y),tx=smooth(x-ix),ty=smooth(y-iy);
  const a=hash(ix,iy),b=hash(ix+1,iy),c=hash(ix,iy+1),d=hash(ix+1,iy+1);
  return a+(b-a)*tx+(c-a)*ty+(a-b-c+d)*tx*ty;
}

// Each field has its own geometry: fluid folds, satin ridges, turbulence, light and cut-paper forms.
function fieldColor(id: string,x: number,y: number,colors: ColorChannels[],out: ColorChannels,highlights: Record<string,ColorChannels>) {
  if(id==='mesh') {
    let total=0,r=0,g=0,b=0;
    for(let i=0;i<meshSpots.length;i++){const p=meshSpots[i],w=light(x,y,p[0],p[1],p[2],p[3])+.015;total+=w;r+=colors[i][0]*w;g+=colors[i][1]*w;b+=colors[i][2]*w;}
    out[0]=r/total;out[1]=g/total;out[2]=b/total;return out;
  }
  if(id==='sunset') {
    let c=colors[0];
    c=mix(c,colors[1],light(x,y,.74,.12,.45,.24),out);
    c=mix(c,colors[2],light(x,y,.18,1.05,.22,.52)*.92,out);
    c=mix(c,colors[3],light(x,y,-.12,.88,.07,.25),out);
    return mix(c,highlights.violet,light(x,y,.88,-.1,.045,.12)*.6,out);
  }
  if(id==='chaos') {
    const qx=noise(x*3.6+.6,y*3.6+2),qy=noise(x*3.8+6,y*3.8+.7);
    const warp=noise(x*3.8+qx*3.1,y*3.8+qy*3.1);
    const detail=noise(x*8+qx*6,y*8+qy*6);
    const t=.5+.5*Math.sin(10.4*warp+detail*2.8+y*1.6);
    return palette(colors,t,out);
  }
  if(id==='blue') {
    const px=x+.22*Math.sin(5*y+1.2)+.09*Math.sin(10*y-4*x);
    const py=y+.18*Math.sin(4.1*x-.6);
    const fold=Math.sin(5.7*px+3.4*py+1.6*Math.sin(3.6*py-2*px));
    const t=.5+.5*fold;
    let c=palette(colors,t,out);
    return mix(c,highlights.pearl,Math.exp(-(((t-.79)/.047)**2))*.32,out);
  }
  if(id==='warm') {
    const bend=y-.21*Math.sin(4.2*x+.5)-.1*Math.sin(7*x+2*y);
    const fold=.5+.5*Math.sin(bend*9.2+x*.8);
    const c=palette(colors,fold*.88+.05,out);
    return mix(c,highlights.ivory,Math.exp(-(((fold-.86)/.03)**2))*.72,out);
  }
  if(id==='paper') {
    const a=x+.15*Math.sin(4.8*y)+.09*Math.sin(5*x+3*y);
    const b=y+.17*Math.sin(4.2*x-.6);
    const fold=.5+.5*Math.sin(4.3*a-4.7*b+1.2);
    let c=palette(colors,fold,out);
    c=mix(c,highlights.paperWhite,Math.exp(-(((fold-.72)/.05)**2))*.62,out);
    return mix(c,highlights.mint,light(x,y,.94,.9,.2,.18)*.55,out);
  }
  // A restrained monochrome ribbon keeps its dark silhouette and narrow reflected edge.
  const px=x+.23*Math.sin(4.8*y+.4),py=y+.15*Math.sin(5*x);
  const fold=.5+.5*Math.sin(4.6*px+5.5*py+Math.sin(3.2*px-4*py));
  let c=palette(colors,smooth((fold-.18)/.75),out);
  return mix(c,highlights.white,Math.exp(-(((fold-.65)/.023)**2))*.63,out);
}

function drawShapes(ctx: CanvasContext,id: string,width: number,height: number,colors: string[]) {
  const gradient=(from: number[],to: number[],stops: string[])=>{
    const paint=ctx.createLinearGradient(from[0]*width,from[1]*height,to[0]*width,to[1]*height);
    stops.forEach((color,i)=>paint.addColorStop(i/(stops.length-1),color));return paint;
  };
  const shape=(start: number[],curves: number[][],paint: CanvasGradient)=>{
    ctx.beginPath();ctx.moveTo(start[0]*width,start[1]*height);
    curves.forEach(c=>ctx.bezierCurveTo(c[0]*width,c[1]*height,c[2]*width,c[3]*height,c[4]*width,c[5]*height));
    ctx.closePath();ctx.fillStyle=paint;ctx.fill();
  };
  ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();
  if(id==='sage') {
    ctx.fillStyle=gradient([0,0],[1,1],[colors[3],colors[2]]);ctx.fillRect(0,0,width,height);
    shape([-.1,-.1],[[.08,-.2,.65,-.05,.59,.28],[.52,.56,.6,.82,.3,.78],[-.03,.83,-.2,.5,-.1,-.1]],gradient([.08,.1],[.64,.8],[colors[1],colors[0]]));
    shape([.6,1.12],[[.48,.86,.43,.65,.68,.49],[.97,.25,1.25,.36,1.12,.68],[1.05,1.06,.88,1.26,.6,1.12]],gradient([.53,.5],[1,1],[colors[0],colors[1]]));
    shape([-.1,-.1],[[.13,-.19,.35,-.1,.24,.1],[.13,.33,-.08,.43,-.15,.3],[-.2,.15,-.18,-.03,-.1,-.1]],gradient([0,0],[.25,.38],[colors[3],colors[2]]));
  } else {
    ctx.fillStyle=gradient([.75,0],[.35,1],[colors[3],colors[2]]);ctx.fillRect(0,0,width,height);
    shape([-.1,-.1],[[.21,-.25,.77,-.07,.58,.13],[.43,.26,.15,.25,.11,.58],[.08,.84,.44,1.18,.13,1.17],[-.24,1.18,-.2,.52,-.1,-.1]],gradient([.11,.2],[.48,1],[colors[0],colors[1]]));
    shape([1.1,.32],[[.85,.37,.58,.55,.69,.82],[.74,.98,1.04,1.11,1.11,.84],[1.16,.68,1.17,.42,1.1,.32]],gradient([.7,.9],[1,.3],[colors[0],colors[1]]));
  }
}


function linear(ctx: CanvasContext, width: number, height: number, from: number[], to: number[], colors: string[]) {
  const gradient=ctx.createLinearGradient(from[0]*width,from[1]*height,to[0]*width,to[1]*height);
  colors.forEach((color,i)=>gradient.addColorStop(i/(colors.length-1),color));
  return gradient;
}

function glow(ctx: CanvasContext, width: number, height: number, x: number, y: number, radius: number, color: string) {
  const gradient=ctx.createRadialGradient(x*width,y*height,0,x*width,y*height,Math.hypot(width,height)*radius);
  gradient.addColorStop(0,color); gradient.addColorStop(1,`${color.slice(0,7)}00`);
  ctx.fillStyle=gradient; ctx.fillRect(0,0,width,height);
}

// Normalized curves keep each preset's composition recognizable in thumbnails and tall exports.
function shape(ctx: CanvasContext, width: number, height: number, start: number[], curves: number[][], color: string | CanvasGradient) {
  ctx.fillStyle=color; ctx.beginPath(); ctx.moveTo(start[0]*width,start[1]*height);
  for(const [cx,cy,x,y] of curves)ctx.quadraticCurveTo(cx*width,cy*height,x*width,y*height);
  ctx.closePath(); ctx.fill();
}

function grain(ctx: CanvasContext, width: number, height: number, paper=false) {
  let seed=7193;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const count=Math.min(2400,Math.ceil(width*height/18));
  ctx.globalAlpha=paper ? .075 : .045;
  for(let i=0;i<count;i++) {
    ctx.fillStyle=i%2?'#ffffff':'#172331';
    ctx.fillRect(random()*width,random()*height,paper ? 1.1 : .8,paper ? .65 : .8);
  }
  ctx.globalAlpha=1;
}

function drawClassicBackground(ctx: CanvasContext, id: string, width: number, height: number, colors: string[], paint: Paint) {
  ctx.fillStyle=colors.length===1?colors[0]:linear(ctx,width,height,[0,0],[1,1],colors);
  ctx.fillRect(0,0,width,height);
  ctx.beginPath(); ctx.rect(0,0,width,height); ctx.clip();
  if(id==='mesh') {
    glow(ctx,width,height,.03,.08,.52,paint('#d3a7e7'));
    glow(ctx,width,height,.91,.02,.48,paint('#91b9d7'));
    glow(ctx,width,height,.72,.79,.48,paint('#7cc7b0'));
    glow(ctx,width,height,.12,.91,.44,paint('#f8b09c'));
    glow(ctx,width,height,.53,.12,.27,paint('#f4e3b6cc'));
    glow(ctx,width,height,.44,.63,.22,paint('#d3d7ef9c'));
  } else if(id==='warm') {
    glow(ctx,width,height,.83,.05,.48,paint('#fff0cb'));
    shape(ctx,width,height,[-.08,.58],[[.22,.08,.58,.43],[.88,.69,1.08,.21],[1.08,1.2,1.08,1.2],[-.08,1.2,-.08,1.2]],linear(ctx,width,height,[.28,.23],[.58,.9],[paint('#efc09e'),paint('#b96f70'),paint('#8d5264')]));
    shape(ctx,width,height,[-.08,.9],[[.13,.43,.48,.68],[.78,.91,1.08,.48],[1.08,1.2,1.08,1.2],[-.08,1.2,-.08,1.2]],linear(ctx,width,height,[.5,.46],[.55,1.1],[paint('#f4c294'),paint('#d68f73'),paint('#a96069')]));
    shape(ctx,width,height,[-.08,1.08],[[.35,.72,.64,.86],[.9,.99,1.08,.79],[1.08,1.2,1.08,1.2],[-.08,1.2,-.08,1.2]],linear(ctx,width,height,[.4,.8],[.65,1.2],[paint('#f7d4aa'),paint('#dca17e')]));
  } else if(id==='blue') {
    glow(ctx,width,height,.92,.03,.65,paint('#a3d7d7'));
    shape(ctx,width,height,[-.06,.12],[[.27,.64,.59,.38],[.9,.08,1.08,.33],[1.08,1.2,1.08,1.2],[-.08,1.2,-.08,1.2]],linear(ctx,width,height,[.19,.2],[.65,.97],[paint('#6fa9cf'),paint('#34629f'),paint('#173967')]));
    shape(ctx,width,height,[-.08,.3],[[.18,.83,.58,.55],[.93,.27,1.08,.52],[1.08,1.2,1.08,1.2],[-.08,1.2,-.08,1.2]],linear(ctx,width,height,[.42,.45],[.52,1],[paint('#badedc'),paint('#70b2c7'),paint('#2a639a'),paint('#183e78')]));
    shape(ctx,width,height,[-.08,.51],[[.22,1.02,.65,.74],[.91,.56,1.08,.67],[1.08,1.2,1.08,1.2],[-.08,1.2,-.08,1.2]],linear(ctx,width,height,[.25,.65],[.78,1.08],[paint('#508bae'),paint('#286097'),paint('#162e61')]));
    glow(ctx,width,height,.02,.91,.36,paint('#56b6c56b'));
  } else if(id==='sage') {
    for(let i=0;i<6;i++) {
      const x=-.5+i*.29;
      shape(ctx,width,height,[x,-.12],[[x+.2,.39,x+.6,1.12],[x+.78,1.12,x+.88,1.12],[x+.51,.38,x+.29,-.12]],linear(ctx,width,height,[x,.25],[x+.39,.12],[paint('#244e4c'),paint('#65998d'),paint('#bdcdaa'),paint('#e4e7c7')]));
    }
    glow(ctx,width,height,.89,.06,.47,paint('#ebebbfab'));
    glow(ctx,width,height,.06,.95,.45,paint('#173f4e77'));
  } else if(id==='sunset') {
    glow(ctx,width,height,.92,.02,.58,paint('#ffe6a9'));
    for(let i=0;i<5;i++) {
      const y=.06+i*.21;
      shape(ctx,width,height,[-.08,y],[[.3,y+.19,.67,y-.13],[.91,y-.32,1.08,y-.29],[1.08,y-.12,1.08,y-.08],[.64,y+.1,.2,y+.32],[-.06,y+.35,-.08,y+.26]],linear(ctx,width,height,[0,y+.3],[1,y-.15],[paint('#655e98'),paint('#b783a7'),paint('#e7a9a0'),paint('#f8cf9b')]));
    }
    glow(ctx,width,height,.85,.03,.4,paint('#ffe8b6a6'));
    glow(ctx,width,height,.04,.94,.45,paint('#66588b70'));
  } else if(id==='paper') {
    shape(ctx,width,height,[-.08,-.08],[[.29,.34,.45,1.08],[.58,1.08,.65,1.08],[.43,.31,.18,-.08]],linear(ctx,width,height,[.14,.4],[.51,.31],[paint('#f7f0e2'),paint('#e2d6c1'),paint('#f9f4e9')]));
    shape(ctx,width,height,[.53,-.08],[[.58,.39,1.08,.82],[1.08,.66,1.08,.52],[.86,.27,.78,-.08]],linear(ctx,width,height,[.58,.31],[.92,.22],[paint('#faf6ed'),paint('#d9ccb5'),paint('#f2e9d9')]));
    glow(ctx,width,height,.14,.03,.48,paint('#fffdf6a1'));
  }
  if(colors.length>1)grain(ctx,width,height,id==='paper');
}

export function drawBackground(ctx: CanvasContext, id: string, width: number, height: number, variant?: number) {
  const preset=backgroundPresets.find(p=>p.id===id);
  if(!preset||id==='none'||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return;
  const paint=themePaint(preset,variant),colorsHex=preset.colors.map(paint);
  ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  if(preset.colors.length===1) {
    ctx.fillStyle=preset.colors[0];ctx.fillRect(0,0,width,height);
  } else if(id.startsWith('classic-')) {
    drawClassicBackground(ctx,id.slice(8),width,height,colorsHex,paint);
  } else if(id==='sage'||id==='vivid') {
    drawShapes(ctx,id,width,height,colorsHex);
  } else {
    // Static fields are sampled once at a bounded resolution, then smoothly scaled for large PNGs.
    const scale=Math.min(1,960/Math.max(width,height));
    const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
    const surface=createSurface(w,h,ctx.canvas),local=surfaceContext(surface),pixels=local.createImageData(w,h);
    const colors=colorsHex.map(rgb),sample=[0,0,0],highlights=Object.fromEntries(Object.entries(highlightColors).map(([key,value])=>[key,rgb(paint(value))]));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const color=fieldColor(id,(x+.5)/w,(y+.5)/h,colors,sample,highlights),i=(y*w+x)*4;
      const grain=(((Math.imul(x+1,73856093)^Math.imul(y+1,19349663))>>>0)%127/126-.5)*1.35;
      pixels.data[i]=color[0]+grain;pixels.data[i+1]=color[1]+grain;pixels.data[i+2]=color[2]+grain;pixels.data[i+3]=255;
    }
    local.putImageData(pixels,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(surface,0,0,width,height);
  }
  ctx.restore();
}

export function createSurface(width: number, height: number, reference?: CanvasSurface): CanvasSurface {
  const owner = (reference && 'ownerDocument' in reference ? reference.ownerDocument : undefined) || (typeof document!=='undefined' ? document : undefined);
  const surface = owner ? owner.createElement('canvas') : new OffscreenCanvas(width,height);
  surface.width = width; surface.height = height;
  return surface;
}

export function gaussianBlurRGBA(pixels: ArrayLike<number>, width: number, height: number, sigma: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width*height*4 || !Number.isFinite(sigma) || sigma <= 0 || sigma > 40) throw new Error('模糊参数无效');
  const radius = Math.ceil(sigma*3), kernel = new Float32Array(radius*2+1);
  let total = 0;
  for (let i=-radius;i<=radius;i++) total += kernel[i+radius] = Math.exp(-i*i/(2*sigma*sigma));
  for (let i=0;i<kernel.length;i++) kernel[i] /= total;
  const horizontal = new Float32Array(pixels.length), output = new Uint8ClampedArray(pixels.length);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const out=(y*width+x)*4;
    for (let k=-radius;k<=radius;k++) {
      const input=(y*width+Math.min(width-1,Math.max(0,x+k)))*4, weight=kernel[k+radius], alpha=pixels[input+3]/255;
      horizontal[out] += pixels[input]*alpha*weight;
      horizontal[out+1] += pixels[input+1]*alpha*weight;
      horizontal[out+2] += pixels[input+2]*alpha*weight;
      horizontal[out+3] += pixels[input+3]*weight;
    }
  }
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    let red=0,green=0,blue=0,alpha=0;
    for (let k=-radius;k<=radius;k++) {
      const input=(Math.min(height-1,Math.max(0,y+k))*width+x)*4, weight=kernel[k+radius];
      red+=horizontal[input]*weight; green+=horizontal[input+1]*weight; blue+=horizontal[input+2]*weight; alpha+=horizontal[input+3]*weight;
    }
    const out=(y*width+x)*4, unpremultiply=alpha>0?255/alpha:0;
    output[out]=red*unpremultiply; output[out+1]=green*unpremultiply; output[out+2]=blue*unpremultiply; output[out+3]=alpha;
  }
  return output;
}

export function renderRedaction(ctx: CanvasContext, annotation: RedactAnnotation) {
  const transform = ctx.getTransform(), sx=transform.a??1,sy=transform.d??1;
  const intensity = (annotation.intensity ?? 12)*Math.sqrt(sx*sy);
  const x = Math.max(0,Math.floor(annotation.x*sx+transform.e)), y = Math.max(0,Math.floor(annotation.y*sy+transform.f));
  const right = Math.min(ctx.canvas.width,Math.ceil((annotation.x+annotation.w)*sx+transform.e));
  const bottom = Math.min(ctx.canvas.height,Math.ceil((annotation.y+annotation.h)*sy+transform.f));
  if (right<=x || bottom<=y) return;
  const margin = annotation.style==='blur' ? Math.ceil(intensity*3) : 0;
  const left = Math.max(0,x-margin), top = Math.max(0,y-margin);
  const width = Math.min(ctx.canvas.width,right+margin)-left, height = Math.min(ctx.canvas.height,bottom+margin)-top;
  const source = createSurface(width,height,ctx.canvas), sourceContext=surfaceContext(source);
  sourceContext.drawImage(ctx.canvas,left,top,width,height,0,0,width,height);
  const filtered = createSurface(width,height,ctx.canvas), filteredContext=surfaceContext(filtered);
  if (annotation.style==='pixelate') {
    const small = createSurface(Math.max(1,Math.ceil(width/intensity)),Math.max(1,Math.ceil(height/intensity)),ctx.canvas);
    surfaceContext(small).drawImage(source,0,0,small.width,small.height);
    filteredContext.imageSmoothingEnabled=false;
    filteredContext.drawImage(small,0,0,width,height);
  } else if (Reflect.has(filteredContext,'filter')) {
    filteredContext.filter=`blur(${intensity}px)`;
    filteredContext.drawImage(source,0,0);
    filteredContext.filter='none';
  } else {
    // Older WebKit has no canvas filters; use the same Gaussian on a bounded working image.
    const reduction=Math.max(1,intensity/6,Math.sqrt(width*height/750_000));
    const small=createSurface(Math.max(1,Math.ceil(width/reduction)),Math.max(1,Math.ceil(height/reduction)),ctx.canvas), smallContext=surfaceContext(small);
    smallContext.drawImage(source,0,0,small.width,small.height);
    const pixels=smallContext.getImageData(0,0,small.width,small.height);
    pixels.data.set(gaussianBlurRGBA(pixels.data,small.width,small.height,intensity/reduction));
    smallContext.putImageData(pixels,0,0);
    filteredContext.drawImage(small,0,0,width,height);
  }
  ctx.save();
  ctx.beginPath(); ctx.rect((x-transform.e)/sx,(y-transform.f)/sy,(right-x)/sx,(bottom-y)/sy); ctx.clip();
  ctx.globalCompositeOperation='copy';
  ctx.drawImage(filtered,0,0,width,height,(left-transform.e)/sx,(top-transform.f)/sy,width/sx,height/sy);
  ctx.restore();
}

export function surfaceContext(surface: CanvasSurface): CanvasContext {
  const context=surface.getContext('2d');
  if(!context)throw new Error('无法创建图片画布');
  // Both surface overloads return the 2D context for this literal selector.
  return context as CanvasContext;
}
