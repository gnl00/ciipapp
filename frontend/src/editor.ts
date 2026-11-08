import type {Annotation, ArrowAnnotation, TextAnnotation, CiipDocument, Point, Rect, FrameLayout, FrameLayoutInput, CanvasContext, CanvasSurface, RenderOptions, SelectionHandle, Appearance} from './types.ts';
import {backgroundPresets, drawBackground, createSurface, surfaceContext, renderRedaction} from './effects.ts';
export {backgroundPresets, drawBackground} from './effects.ts';

type PathCommand = [method: 'moveTo' | 'lineTo' | 'quadraticCurveTo', ...values: number[]];

const MAX_PIXELS = 60_000_000;
const MAX_DIMENSION = 32_768;
const MAX_ANNOTATIONS = 1000;
const TYPES = new Set(['arrow', 'rectangle', 'ellipse', 'pen', 'highlighter', 'text', 'number', 'redact']);
const ARROW_STYLES = new Set(['line', 'pointer', 'curved', 'tapered', 'direction']);
const COLOR = /^#[\da-f]{3}(?:[\da-f]{3})?$/i;

export function createDocument(base: string, width: number, height: number, name = '截图') {
  return validateDocument({base, width, height, name, annotations: [], crop: null});
}

export function cloneDocument(doc: CiipDocument): CiipDocument {
  return {
    ...doc,
    crop: doc.crop ? {...doc.crop} : null,
    ...(doc.appearance ? {appearance:{...doc.appearance}} : {}),
    annotations: doc.annotations.map(a => ({...a, ...(a.points ? {points: a.points.map(p => ({...p}))} : {}), ...(a.control ? {control: {...a.control}} : {})} as Annotation)),
  };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y)};
}

export function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(width, Math.floor(rect.x)));
  const y = Math.max(0, Math.min(height, Math.floor(rect.y)));
  const right = Math.max(x, Math.min(width, Math.ceil(rect.x + rect.w)));
  const bottom = Math.max(y, Math.min(height, Math.ceil(rect.y + rect.h)));
  return {x, y, w: right - x, h: bottom - y};
}

export function outputSize(doc: CiipDocument) {
  const {width,height} = frameLayout(doc);
  return {width,height};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function appearanceValues(value: unknown): Appearance {
  if (value != null && !isRecord(value)) throw new Error('背景设置无效');
  const appearance = value ?? {};
  const background=appearance.background??'none', padding=appearance.padding??0, radius=appearance.radius??0;
  if (typeof background !== 'string' || !backgroundPresets.some(p=>p.id===background) || !finite(padding,0,240) || !Number.isInteger(padding) || !finite(radius,0,160)) throw new Error('背景设置无效');
  const variant=appearance.variant;
  if (variant != null && (!finite(variant,0,0xffffffff) || !Number.isInteger(variant))) throw new Error('背景配色无效');
  return {background,padding,radius,...(typeof variant==='number'?{variant}:{})};
}

export function frameLayout(doc: FrameLayoutInput, {fullImage=false}: {fullImage?: boolean}={}): FrameLayout {
  const crop = fullImage || !doc.crop ? {x:0,y:0,w:doc.width,h:doc.height} : {...doc.crop};
  const appearance: Appearance = fullImage ? {background:'none',padding:0,radius:0} : appearanceValues(doc.appearance);
  const padding=appearance.background==='none'?0:appearance.padding;
  const width=crop.w+padding*2,height=crop.h+padding*2;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || width>MAX_DIMENSION || height>MAX_DIMENSION || width*height>MAX_PIXELS) throw new Error('输出图片过大，请减少留白或先裁剪（最多 6000 万像素）');
  return {crop,width,height,offsetX:padding,offsetY:padding,padding,radius:Math.min(appearance.radius,crop.w/2,crop.h/2),background:appearance.background,...(appearance.variant!=null?{variant:appearance.variant}:{})};
}

export function nextNumber(annotations: Annotation[]) {
  const next = annotations.reduce((max, a) => a.type === 'number' ? Math.max(max, a.number) : max, 0) + 1;
  return next <= 999 ? next : null;
}

export function curveControl(a: ArrowAnnotation): Point {
  if (a.control) return {...a.control};
  const [start, end] = a.points;
  return {x: (start.x + end.x) / 2 - (end.y - start.y) * .22, y: (start.y + end.y) / 2 + (end.x - start.x) * .22};
}

function arrowFrame(a: ArrowAnnotation) {
  const [start, end] = a.points;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const origin = a.style === 'curved' ? curveControl(a) : start;
  let dx = end.x - origin.x, dy = end.y - origin.y;
  if (!dx && !dy) { dx = end.x - start.x; dy = end.y - start.y; }
  const tangentLength = Math.hypot(dx, dy);
  return {start, end, distance, ux: tangentLength ? dx / tangentLength : 0, uy: tangentLength ? dy / tangentLength : 0};
}

function blockArrowMetrics(a: ArrowAnnotation, distance: number) {
  const direction=a.style==='direction', width=a.width||3;
  const scale=direction?1:Math.min(1.45,Math.max(1,Math.sqrt(distance/120)));
  const bodyHalf=Math.min(distance*(direction ? .16 : .115),Math.max(direction?2.5:1.8,width*(direction ? .95 : .92))*scale);
  return {
    bodyHalf,
    tailHalf:direction?bodyHalf:Math.min(.55,bodyHalf*.1),
    headHalf:Math.min(distance*.28,bodyHalf*(direction?2:2.15)),
    depth:Math.min(distance*(direction ? .44 : .42),Math.max(direction?11:10,width*(direction?4.2:4.8))*scale),
  };
}

export function arrowHead(a: ArrowAnnotation) {
  const {end, distance, ux, uy} = arrowFrame(a);
  if (a.style === 'tapered' || a.style === 'direction') {
    const {depth, headHalf} = blockArrowMetrics(a, distance);
    const base = {x: end.x - ux * depth, y: end.y - uy * depth};
    const wing=a.style==='tapered'?depth*.12:0;
    return {base, left: {x: base.x-ux*wing-uy*headHalf, y: base.y-uy*wing+ux*headHalf}, right: {x: base.x-ux*wing+uy*headHalf, y: base.y-uy*wing-ux*headHalf}};
  }
  const pointer = a.style === 'pointer';
  const length = Math.min(distance * (pointer ? .5 : .42), Math.max(pointer ? 18 : 11, (a.width || 3) * (pointer ? 5 : 3.6)));
  const depth = pointer ? length : length * .9;
  const halfWidth = length * .45;
  const base = {x: end.x - ux * depth, y: end.y - uy * depth};
  return {base, left: {x: base.x - uy * halfWidth, y: base.y + ux * halfWidth}, right: {x: base.x + uy * halfWidth, y: base.y - ux * halfWidth}};
}

function corner(before: number[], point: number[], after: number[], radius: number) {
  const toward=(target: number[])=>{
    const dx=target[0]-point[0],dy=target[1]-point[1],length=Math.hypot(dx,dy);
    const t=length?Math.min(radius/length,.3):0;
    return [point[0]+dx*t,point[1]+dy*t];
  };
  return {point,in:toward(before),out:toward(after)};
}

// One contour drives rendering, bounds and selection, including the curved taper edges.
function arrowOutline(a: ArrowAnnotation): PathCommand[] {
  const {start,distance,ux,uy}=arrowFrame(a), {bodyHalf:b,tailHalf:t,headHalf:h,depth}=blockArrowMetrics(a,distance);
  const neck=distance-depth, width=a.width||3;
  let path: PathCommand[];
  if(a.style==='tapered') {
    const wing=neck-depth*.12,tip=[distance,0],tail=[t,t];
    const shoulder=[neck,b],edge=[wing,h],r=Math.min(width*.23,distance*.015);
    const s=corner(tail,shoulder,edge,r),e=corner(shoulder,edge,tip,r);
    path=[['moveTo',0,0],['quadraticCurveTo',0,t,...tail],
      ['quadraticCurveTo',neck*.58,t*.8,...s.in],['quadraticCurveTo',...s.point,...s.out],
      ['lineTo',...e.in],['quadraticCurveTo',...e.point,...e.out],['lineTo',...tip],
      ['lineTo',e.out[0],-e.out[1]],['quadraticCurveTo',e.point[0],-e.point[1],e.in[0],-e.in[1]],
      ['lineTo',s.out[0],-s.out[1]],['quadraticCurveTo',s.point[0],-s.point[1],s.in[0],-s.in[1]],
      ['quadraticCurveTo',neck*.58,-t*.8,t,-t],['quadraticCurveTo',0,-t,0,0]];
  } else {
    const vertices=[[0,b],[neck,b],[neck,h],[distance,0],[neck,-h],[neck,-b],[0,-b]];
    const corners=vertices.map((p,i)=>corner(vertices[(i+6)%7],p,vertices[(i+1)%7],i===3?0:Math.min(width*.22,distance*.02)));
    path=[['moveTo',...corners[0].in]];
    for(const c of corners)path.push(['lineTo',...c.in],['quadraticCurveTo',...c.point,...c.out]);
  }
  return path.map(([method,...values])=>[method,...values.map((value,i)=>i%2?start.y+values[i-1]*uy+value*ux:start.x+value*ux-values[i+1]*uy)]);
}

function outlinePoints(path: PathCommand[], flatness?: number): Point[] {
  const points: Point[]=[];
  for(const [method,...values] of path) {
    const end={x:values.at(-2)!,y:values.at(-1)!};
    if(method==='quadraticCurveTo') {
      const start=points.at(-1)!,control={x:values[0],y:values[1]};
      if(flatness!=null)flattenQuadratic(start,control,end,flatness,points);
      else {
        for(const axis of ['x','y'] as const) {
          const divisor=start[axis]-2*control[axis]+end[axis],t=divisor?(start[axis]-control[axis])/divisor:0;
          if(t>0&&t<1)points.push(quadraticPoint(start,control,end,t));
        }
        points.push(end);
      }
    } else points.push(end);
  }
  return points;
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const u = 1 - t;
  return {x: u * u * start.x + 2 * u * t * control.x + t * t * end.x, y: u * u * start.y + 2 * u * t * control.y + t * t * end.y};
}

function curveExtrema(a: ArrowAnnotation) {
  const [start, end] = a.points, control = curveControl(a), points = [start, end];
  for (const axis of ['x', 'y'] as const) {
    const denominator = start[axis] - 2 * control[axis] + end[axis];
    if (!denominator) continue;
    const t = (start[axis] - control[axis]) / denominator;
    if (t > 0 && t < 1) points.push(quadraticPoint(start, control, end, t));
  }
  return points;
}

function curveSegments(a: ArrowAnnotation, flatness: number) {
  const [start, end] = a.points, points = [start];
  flattenQuadratic(start,curveControl(a),end,flatness,points);
  return points;
}

function flattenQuadratic(start: Point, control: Point, end: Point, flatness: number, points: Point[]) {
  const midpoint = (p: Point, q: Point) => ({x: (p.x + q.x) / 2, y: (p.y + q.y) / 2});
  function split(p: Point, control: Point, q: Point, depth: number) {
    if (depth === 14 || segmentDistance(control, p, q) <= flatness) { points.push(q); return; }
    const left = midpoint(p, control), right = midpoint(control, q), center = midpoint(left, right);
    split(p, left, center, depth + 1);
    split(center, right, q, depth + 1);
  }
  split(start, control, end, 0);
}

function smoothStroke(points: Point[], draw: (control: Point | null, end: Point) => void) {
  if (points.length<2) return;
  if (points.length===2) { draw(null,points[1]); return; }
  for (let i=1;i<points.length;i++) {
    const current=points[i], next=points[i+1];
    draw(current,next?{x:(current.x+next.x)/2,y:(current.y+next.y)/2}:current);
  }
}

function strokeSegments(points: Point[], flatness: number) {
  const flattened=[points[0]];
  let start=points[0];
  smoothStroke(points,(control,end)=>{
    if(control)flattenQuadratic(start,control,end,flatness,flattened);else flattened.push(end);
    start=end;
  });
  return flattened;
}

function textWidth(text: string, fontSize: number) {
  // Used by non-browser consumers; the editor measures its actual system font below.
  return [...text].reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 1 : 0.62) * fontSize, 0);
}

let textMeasurer: CanvasContext | null | undefined;
function textBounds(a: TextAnnotation): Rect {
  const size=a.fontSize||28, lines=a.text.split('\n');
  if(!textMeasurer) {
    if(typeof document!=='undefined' && typeof document.createElement==='function')textMeasurer=document.createElement('canvas').getContext('2d');
    else if(typeof OffscreenCanvas==='function')textMeasurer=new OffscreenCanvas(1,1).getContext('2d');
  }
  if(!textMeasurer)return {x:a.x,y:a.y,w:Math.max(size*.5,...lines.map(line=>textWidth(line,size))),h:lines.length*size*1.3};
  const measurer=textMeasurer;
  measurer.font=`600 ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
  measurer.textAlign='left';measurer.textBaseline='top';
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  lines.forEach((line,i)=>{
    if(!line.trim())return;
    const m=measurer.measureText(line),y=i*size*1.3;
    const measured=[m.actualBoundingBoxLeft,m.actualBoundingBoxRight,m.actualBoundingBoxAscent,m.actualBoundingBoxDescent].every(Number.isFinite);
    left=Math.min(left,measured?-m.actualBoundingBoxLeft:0);
    right=Math.max(right,measured?m.actualBoundingBoxRight:m.width);
    top=Math.min(top,measured?y-m.actualBoundingBoxAscent:y);
    bottom=Math.max(bottom,measured?y+m.actualBoundingBoxDescent:y+size);
  });
  if(!Number.isFinite(left))return {x:a.x,y:a.y,w:size*.5,h:lines.length*size*1.3};
  return {x:a.x+left,y:a.y+top,w:Math.max(1,right-left),h:Math.max(1,bottom-top)};
}

function localAnnotationBounds(a: Annotation): Rect {
  if (a.type === 'number') {
    const r = a.radius ?? 18;
    return {x: a.x - r, y: a.y - r, w: r * 2, h: r * 2};
  }
  if (a.points) {
    const head = a.type === 'arrow' ? arrowHead(a) : null;
    const shaft = a.type === 'arrow' && a.style === 'curved' ? curveExtrema(a) : a.points;
    const points = a.type === 'arrow' && (a.style === 'tapered' || a.style === 'direction') ? outlinePoints(arrowOutline(a)) : head ? [...shaft, head.left, head.right] : shaft;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    return {x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys)};
  }
  if (a.type === 'text') {
    return textBounds(a);
  }
  return {x: a.x, y: a.y, w: a.w, h: a.h};
}


const oriented = (a: Annotation) => !!a.rotation||!!a.flipX||!!a.flipY;
const rotationAngle = (degrees: number) => {
  if (typeof degrees!=='number'||!Number.isFinite(degrees)) throw new Error('旋转角度无效');
  const value=((degrees%360)+360)%360;
  return value<1e-10||360-value<1e-10?0:value;
};

// Absolute source-coordinate matrix, also used by the inline text editor.
export function annotationTransform(a: Annotation) {
  if(!oriented(a))return {a:1,b:0,c:0,d:1,e:0,f:0};
  const box=localAnnotationBounds(a),x=box.x+box.w/2,y=box.y+box.h/2;
  const rotation=rotationAngle(a.rotation||0),radians=rotation*Math.PI/180;
  const cos=rotation%90===0?[1,0,-1,0][rotation/90]:Math.cos(radians),sin=rotation%90===0?[0,1,0,-1][rotation/90]:Math.sin(radians);
  const sx=a.flipX?-1:1,sy=a.flipY?-1:1;
  return {a:cos*sx,b:sin*sx,c:-sin*sy,d:cos*sy,e:x-cos*sx*x+sin*sy*y,f:y-sin*sx*x-cos*sy*y};
}

export function annotationPoint(a: Annotation,point: Point,inverse=false): Point {
  const m=annotationTransform(a);
  if(!inverse)return {x:m.a*point.x+m.c*point.y+m.e,y:m.b*point.x+m.d*point.y+m.f};
  const x=point.x-m.e,y=point.y-m.f,det=m.a*m.d-m.b*m.c;
  return {x:(m.d*x-m.c*y)/det,y:(m.a*y-m.b*x)/det};
}

export function annotationBounds(a: Annotation) {
  const box=localAnnotationBounds(a);
  return transformedBounds(a,box);
}

function transformedBounds(a: Annotation,box: Rect) {
  if(!oriented(a))return box;
  const points=[[box.x,box.y],[box.x+box.w,box.y],[box.x,box.y+box.h],[box.x+box.w,box.y+box.h]].map(([x,y])=>annotationPoint(a,{x,y}));
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
}

function orientation<T extends Annotation>(a: T,rotation: number,flipX=a.flipX,flipY=a.flipY): T {
  const result={...a};
  const nextRotation=rotationAngle(rotation);
  if(nextRotation)result.rotation=nextRotation;else delete result.rotation;
  if(flipX)result.flipX=true;else delete result.flipX;
  if(flipY)result.flipY=true;else delete result.flipY;
  return result;
}

export function rotateAnnotation<T extends Annotation>(a: T,degrees=90): T {
  return orientation(a,(a.rotation||0)+rotationAngle(degrees));
}

export function flipAnnotation<T extends Annotation>(a: T,axis='horizontal'): T {
  if(axis!=='horizontal'&&axis!=='vertical')throw new Error('翻转方向无效');
  const horizontal=axis==='horizontal';
  return orientation(a,-(a.rotation||0),horizontal?!a.flipX:a.flipX,horizontal?a.flipY:!a.flipY);
}

function localSelectionBounds(a: Annotation) {
  const box=localAnnotationBounds(a);
  if(a.type!=='pen'&&a.type!=='highlighter')return box;
  const padding=(a.width||3)/2;
  return {x:box.x-padding,y:box.y-padding,w:box.w+padding*2,h:box.h+padding*2};
}

export function selectionFrame(a: Annotation) {
  return {bounds:localSelectionBounds(a),matrix:annotationTransform(a)};
}

export function selectionBounds(a: Annotation) {
  return transformedBounds(a,localSelectionBounds(a));
}

const BOX_HANDLES: [string,number,number,string][]=[['nw',0,0,'nwse-resize'],['n',.5,0,'ns-resize'],['ne',1,0,'nesw-resize'],['e',1,.5,'ew-resize'],['se',1,1,'nwse-resize'],['s',.5,1,'ns-resize'],['sw',0,1,'nesw-resize'],['w',0,.5,'ew-resize']];

export function selectionHandles(a: Annotation): SelectionHandle[] {
  if(a.type==='arrow')return a.points.map((point,i)=>({id:i?'end':'start',...annotationPoint(a,point),cursor:'crosshair'}));
  const box=localSelectionBounds(a),edges=['rectangle','ellipse','redact'].includes(a.type),m=annotationTransform(a);
  return BOX_HANDLES.filter(([id])=>edges||id.length===2).map(([id,x,y,cursor])=>{
    if(oriented(a)) {
      const dx=x*2-1,dy=y*2-1,angle=Math.atan2(m.b*dx+m.d*dy,m.a*dx+m.c*dy);
      cursor=['ew-resize','nwse-resize','ns-resize','nesw-resize'][((Math.round(angle/(Math.PI/4))%4)+4)%4];
    }
    return {id,...annotationPoint(a,{x:box.x+box.w*x,y:box.y+box.h*y}),cursor};
  });
}

function resizedBox(box: Rect,handle: string,point: Point,minSize: number) {
  let left=box.x,top=box.y,right=box.x+box.w,bottom=box.y+box.h;
  if(handle.includes('w'))left=Math.max(-1_000_000,right-1_000_000,Math.min(point.x,right-minSize));
  if(handle.includes('e'))right=Math.min(left+1_000_000,Math.max(point.x,left+minSize));
  if(handle.includes('n'))top=Math.max(-1_000_000,bottom-1_000_000,Math.min(point.y,bottom-minSize));
  if(handle.includes('s'))bottom=Math.min(top+1_000_000,Math.max(point.y,top+minSize));
  return {x:left,y:top,w:right-left,h:bottom-top};
}

export function resizeAnnotation<T extends Annotation>(a: T,handleId: string,point: Point,{minSize=2}={}): T {
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new Error('缩放坐标无效');
  if(!selectionHandles(a).some(handle=>handle.id===handleId))throw new Error('缩放控制点无效');
  if(oriented(a)) {
    const plain={...a};delete plain.rotation;delete plain.flipX;delete plain.flipY;
    const opposite=(shape: Annotation): Point=>{
      if(shape.type==='arrow')return shape.points[handleId==='start'?1:0];
      const box=localSelectionBounds(shape),[,x,y]=BOX_HANDLES.find(([id])=>id===handleId)!;
      return {x:box.x+box.w*(1-x),y:box.y+box.h*(1-y)};
    };
    const anchor=annotationPoint(a,opposite(a));
    let result=resizeAnnotation(plain,handleId,annotationPoint(a,point,true),{minSize});
    result=orientation(result,a.rotation||0,a.flipX,a.flipY);
    const next=annotationPoint(result,opposite(result));
    return translateAnnotation(result,anchor.x-next.x,anchor.y-next.y);
  }
  const clamp=(value: number,min: number,max: number)=>Math.max(min,Math.min(max,value));
  const coordinate=(value: number)=>clamp(value,-1_000_000,1_000_000);
  const target={x:coordinate(point.x),y:coordinate(point.y)};
  const result={...a,...(a.points?{points:a.points.map(p=>({...p}))}:{}),...(a.control?{control:{...a.control}}:{})};
  if(a.type==='arrow') {
    if(!result.points)throw new Error('箭头控制点无效');
    result.points[handleId==='start'?0:1]=target;
    return result;
  }
  const box=selectionBounds(a);
  if(a.type==='number'||a.type==='text') {
    const west=handleId.includes('w'),north=handleId.includes('n');
    const anchor={x:box.x+(west?box.w:0),y:box.y+(north?box.h:0)},sx=west?-1:1,sy=north?-1:1;
    const scale=((target.x-anchor.x)*sx*box.w+(target.y-anchor.y)*sy*box.h)/(box.w*box.w+box.h*box.h);
    if(a.type==='number') {
      const radius=Math.round(clamp((a.radius??18)*scale,12,160)*100)/100;
      return {...result,radius,x:coordinate(anchor.x+sx*radius),y:coordinate(anchor.y+sy*radius)};
    }
    const fontSize=Math.round(clamp((a.fontSize||28)*scale,8,512)*100)/100;
    const measured=textBounds({...a,x:0,y:0,fontSize});
    return {...result,fontSize,x:coordinate(anchor.x-(west?measured.w:0)-measured.x),y:coordinate(anchor.y-(north?measured.h:0)-measured.y)};
  }
  const minimum=Number.isFinite(minSize)?clamp(minSize,.5,1_000_000):2;
  const next=resizedBox(box,handleId,target,minimum);
  if(a.type==='pen'||a.type==='highlighter') {
    const scaleX=next.w/box.w,scaleY=next.h/box.h;
    const ink=annotationBounds(a),west=handleId.includes('w'),north=handleId.includes('n');
    const anchor={x:box.x+(west?box.w:0),y:box.y+(north?box.h:0)};
    let width=(a.width||3)*Math.sqrt(scaleX*scaleY);
    if(!ink.w)width=next.w;
    if(!ink.h)width=ink.w?next.h:Math.min(next.w,next.h);
    result.width=clamp(Math.min(width,next.w*(ink.w ? .9 : 1),next.h*(ink.h ? .9 : 1)),.5,200);
    if(!ink.w){next.w=result.width;next.x=west?anchor.x-next.w:anchor.x;}
    if(!ink.h){next.h=result.width;next.y=north?anchor.y-next.h:anchor.y;}
    const pad=result.width/2;
    result.points=a.points.map(p=>({
      x:coordinate(next.x+pad+(ink.w?(p.x-ink.x)*(next.w-result.width)/ink.w:0)),
      y:coordinate(next.y+pad+(ink.h?(p.y-ink.y)*(next.h-result.width)/ink.h:0)),
    }));
    return result;
  }
  return {...result,...next};
}

function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function polygonHit(points: Point[], point: Point, tolerance: number) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (segmentDistance(point, a, b) <= tolerance) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function hitTest(a: Annotation, point: Point, tolerance = 6) {
  if(oriented(a))point=annotationPoint(a,point,true);
  const radius = tolerance + (a.width || 3) / 2;
  if (a.type === 'number') return Math.hypot(point.x - a.x, point.y - a.y) <= (a.radius ?? 18) + tolerance;
  if (a.points) {
    if (a.points.length === 1) return Math.hypot(point.x - a.points[0].x, point.y - a.points[0].y) <= radius;
    if (a.type === 'arrow') {
      const {left, right} = arrowHead(a), end = a.points[1];
      if (a.style === 'tapered' || a.style === 'direction') return polygonHit(outlinePoints(arrowOutline(a),.08), point, tolerance);
      if (a.style === 'pointer' && polygonHit([left, end, right], point, tolerance)) return true;
      if (segmentDistance(point, left, end) <= radius || segmentDistance(point, right, end) <= radius) return true;
      if (a.style === 'curved') {
        const points = curveSegments(a, Math.max(.1, radius / 4));
        return points.slice(1).some((p, i) => segmentDistance(point, points[i], p) <= radius);
      }
    }
    if (a.type==='pen' || a.type==='highlighter') {
      const points=strokeSegments(a.points,Math.max(.1,radius/4));
      return points.slice(1).some((p,i)=>segmentDistance(point,points[i],p)<=radius);
    }
    return a.points.slice(1).some((p, i) => segmentDistance(point, a.points[i], p) <= radius);
  }
  const r = localAnnotationBounds(a);
  if (a.type === 'ellipse') {
    if (!r.w || !r.h) return false;
    const nx = (point.x - r.x - r.w / 2) / (r.w / 2 + tolerance);
    const ny = (point.y - r.y - r.h / 2) / (r.h / 2 + tolerance);
    return nx * nx + ny * ny <= 1;
  }
  return point.x >= r.x - tolerance && point.x <= r.x + r.w + tolerance && point.y >= r.y - tolerance && point.y <= r.y + r.h + tolerance;
}

export function translateAnnotation<T extends Annotation>(a: T, dx: number, dy: number): T {
  const move = (p: Point) => ({x: p.x + dx, y: p.y + dy});
  return a.points ? {...a, points: a.points.map(move), ...(a.control ? {control: move(a.control)} : {})} : {...a, x: a.x + dx, y: a.y + dy};
}

function luminance(color: string) {
  const hex = color.slice(1), rgb = (hex.length === 3 ? [...hex].map(c => c + c).join('') : hex).match(/../g)!;
  const [r, g, b] = rgb.map(c => { const value = parseInt(c, 16) / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
}

function textOnColor(color: string) {
  const light = luminance(color);
  if (1.05 / (light + .05) >= 4.5) return '#ffffff';
  const ink = '#17221d';
  return (light + .05) / (luminance(ink) + .05) >= 4.5 ? ink : '#000000';
}

export function renderAnnotation(ctx: CanvasContext, a: Annotation) {
  ctx.save();
  const transformedEffect=oriented(a)&&a.type==='redact'&&(a.style==='blur'||a.style==='pixelate');
  if(oriented(a)&&!transformedEffect) { const m=annotationTransform(a);ctx.transform(m.a,m.b,m.c,m.d,m.e,m.f); }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = a.color || '#e85745';
  ctx.fillStyle = a.color || '#e85745';
  ctx.lineWidth = a.width || 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  if (a.type === 'number') {
    const radius = a.radius ?? 18, outline = a.style === 'outline';
    ctx.lineWidth = Math.max(1.5, Math.min(2.5, radius * .1));
    ctx.beginPath();
    ctx.arc(a.x, a.y, radius - (outline ? ctx.lineWidth / 2 : 0), 0, Math.PI * 2);
    if (outline) ctx.stroke();
    else {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1;
      ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(a.x, a.y, radius - .5, 0, Math.PI * 2);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.stroke();
    }
    ctx.fillStyle = outline ? (a.color || '#e85745') : textOnColor(a.color || '#e85745');
    const label = String(a.number), maxWidth = radius * 1.6;
    let fontSize = radius * (label.length > 2 ? .88 : 1.1);
    const setFont = () => { ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`; };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    setFont();
    let metrics = ctx.measureText(label);
    if (metrics.width > maxWidth) { fontSize *= maxWidth / metrics.width; setFont(); metrics = ctx.measureText(label); }
    const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : fontSize * .75;
    const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : fontSize * .05;
    const offsetX = Number.isFinite(metrics.actualBoundingBoxLeft) && Number.isFinite(metrics.actualBoundingBoxRight) ? (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2 : 0;
    ctx.fillText(label, a.x + offsetX, a.y + (ascent - descent) / 2, maxWidth);
  } else if (a.type === 'redact') {
    if (a.style==='blur' || a.style==='pixelate') {
      if(transformedEffect) {
        // Rotate the mask only: sample current world pixels, never a rotated copy of the covered image.
        const corners=[[a.x,a.y],[a.x+a.w,a.y],[a.x+a.w,a.y+a.h],[a.x,a.y+a.h]].map(([x,y])=>annotationPoint(a,{x,y}));
        ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);
        corners.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.closePath();ctx.clip();
        renderRedaction(ctx,{...a,...annotationBounds(a)});
      } else renderRedaction(ctx,a);
    }
    else {
      // Documents from before effect modes used opaque coverage.
      ctx.fillStyle = a.style==='solid' ? a.color || '#171717' : '#171717';
      ctx.fillRect(Math.floor(a.x), Math.floor(a.y), Math.ceil(a.x + a.w) - Math.floor(a.x), Math.ceil(a.y + a.h) - Math.floor(a.y));
    }
  } else if (a.type === 'rectangle') {
    ctx.strokeRect(a.x, a.y, a.w, a.h);
  } else if (a.type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, Math.abs(a.w / 2), Math.abs(a.h / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (a.type === 'text') {
    const size = a.fontSize || 28;
    ctx.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
    ctx.textBaseline = 'top';
    a.text.split('\n').forEach((line, i) => ctx.fillText(line, a.x, a.y + i * size * 1.3));
  } else if (a.type === 'arrow' && a.points.length > 1) {
    const [start, end] = a.points, {base, left, right} = arrowHead(a);
    if (a.style === 'tapered' || a.style === 'direction') {
      ctx.beginPath();
      for(const [method,...values] of arrowOutline(a)){
        if(method==='quadraticCurveTo')ctx.quadraticCurveTo(values[0],values[1],values[2],values[3]);
        else if(method==='lineTo')ctx.lineTo(values[0],values[1]);
        else ctx.moveTo(values[0],values[1]);
      }
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(start.x, start.y);
      if (a.style === 'curved') { const c = curveControl(a); ctx.quadraticCurveTo(c.x, c.y, end.x, end.y); }
      else { const shaftEnd = a.style === 'pointer' ? base : end; ctx.lineTo(shaftEnd.x, shaftEnd.y); }
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(left.x, left.y); ctx.lineTo(end.x, end.y); ctx.lineTo(right.x, right.y);
      if (a.style === 'pointer') { ctx.closePath(); ctx.fill(); }
      else ctx.stroke();
    }
  } else if (a.points) {
    if(a.type==='highlighter')ctx.globalAlpha=.28;
    ctx.beginPath();
    ctx.moveTo(a.points[0].x, a.points[0].y);
    smoothStroke(a.points,(control,end)=>{
      if(control)ctx.quadraticCurveTo(control.x,control.y,end.x,end.y);else ctx.lineTo(end.x,end.y);
    });
    if (a.points.length === 1) {
      ctx.arc(a.points[0].x, a.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Stroke once: canvas composites the path's union, so a highlighter does not darken at self-intersections.
      ctx.stroke();
    }
  }
  ctx.restore();
}

function clipFrame(ctx: CanvasContext, layout: FrameLayout) {
  const {offsetX:x,offsetY:y,crop:{w,h},radius:r}=layout;
  ctx.beginPath();
  if(!r)ctx.rect(x,y,w,h);
  else {
    ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
  }
  ctx.clip();
  ctx.translate(x-layout.crop.x,y-layout.crop.y);
}

interface DocumentFrame {surface: CanvasSurface; base: CanvasSurface; key?: string; baseKey?: string}
const documentFrames = new WeakMap<CanvasImageSource,DocumentFrame>();

export function renderDocument(ctx: CanvasContext, doc: CiipDocument, image: CanvasImageSource, options: RenderOptions = {}) {
  const layout=frameLayout(doc,options),ratio=options.pixelRatio??1;
  if(!Number.isFinite(ratio)||ratio<=0||ratio>1)throw new Error('预览比例无效');
  const width=Math.ceil(layout.width*ratio),height=Math.ceil(layout.height*ratio);
  // Exports draw directly at source precision and never resize or invalidate the preview cache.
  if(options.pixelRatio==null) {
    ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
    drawBackground(ctx,layout.background,layout.width,layout.height,layout.variant);
    ctx.save();clipFrame(ctx,layout);ctx.drawImage(image,0,0,doc.width,doc.height);
    for(const annotation of doc.annotations)renderAnnotation(ctx,annotation);
    ctx.restore();
  } else {
    const baseKey=JSON.stringify([doc.width,doc.height,layout,ratio]);
    const key=JSON.stringify([baseKey,doc.annotations]);
    let frame=documentFrames.get(image);
    if(!frame) {
      frame={surface:createSurface(width,height,ctx.canvas),base:createSurface(width,height,ctx.canvas)};
      documentFrames.set(image,frame);
    }
    if(frame.baseKey!==baseKey) {
      const base=frame.base;
      if(base.width!==width)base.width=width;
      if(base.height!==height)base.height=height;
      const layer=surfaceContext(base);layer.clearRect(0,0,width,height);
      layer.save();if(ratio!==1)layer.scale(ratio,ratio);
      drawBackground(layer,layout.background,layout.width,layout.height,layout.variant);
      clipFrame(layer,layout);layer.drawImage(image,0,0,doc.width,doc.height);layer.restore();
      frame.baseKey=baseKey;
    }
    if(frame.key!==key) {
      const surface=frame.surface;
      if(surface.width!==width)surface.width=width;
      if(surface.height!==height)surface.height=height;
      const layer=surfaceContext(surface);layer.clearRect(0,0,width,height);
      layer.drawImage(frame.base,0,0);
      layer.save();if(ratio!==1)layer.scale(ratio,ratio);clipFrame(layer,layout);
      // Keep annotation order: later redactions sample the already rendered layers below them.
      for(const annotation of doc.annotations)renderAnnotation(layer,annotation);
      layer.restore();frame.key=key;
    }
    ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
    ctx.drawImage(frame.surface,0,0);
  }
  ctx.save();if(ratio!==1)ctx.scale(ratio,ratio);
  if (options.preview) {
    ctx.save();clipFrame(ctx,layout);renderAnnotation(ctx,options.preview);ctx.restore();
  }
  ctx.translate(layout.offsetX-layout.crop.x,layout.offsetY-layout.crop.y);
  const selected = doc.annotations.find(a => a.id === options.selection);
  if (selected) {
    const {bounds:r,matrix:m}=selectionFrame(selected), pad = 5;
    if(oriented(selected))ctx.transform(m.a,m.b,m.c,m.d,m.e,m.f);
    ctx.strokeStyle = '#7c8b7f';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
  }
  ctx.restore();
}

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validRect(rect: unknown): rect is Rect {
  return isRecord(rect) && finite(rect.x,-1_000_000,1_000_000) && finite(rect.y,-1_000_000,1_000_000) && finite(rect.w,0,1_000_000) && finite(rect.h,0,1_000_000);
}

function validateDocument(input: unknown): CiipDocument {
  if (!isRecord(input) || typeof input.base !== 'string' || input.base.length > 96 * 1024 * 1024 || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.base)) throw new Error('图片数据无效');
  const doc=input;
  if (!finite(doc.width,1,MAX_DIMENSION) || !finite(doc.height,1,MAX_DIMENSION) || !Number.isInteger(doc.width) || !Number.isInteger(doc.height) || doc.width * doc.height > MAX_PIXELS) throw new Error('图片尺寸超出支持范围');
  if (typeof doc.name !== 'string' || doc.name.length > 1024 || !Array.isArray(doc.annotations) || doc.annotations.length > MAX_ANNOTATIONS) throw new Error('编辑文档无效');
  if (doc.crop != null && (!validRect(doc.crop) || !Number.isInteger(doc.crop.x) || !Number.isInteger(doc.crop.y) || !Number.isInteger(doc.crop.w) || !Number.isInteger(doc.crop.h) || doc.crop.x < 0 || doc.crop.y < 0 || doc.crop.w < 1 || doc.crop.h < 1 || doc.crop.x + doc.crop.w > doc.width || doc.crop.y + doc.crop.h > doc.height)) throw new Error('裁剪范围无效');
  frameLayout({width:doc.width,height:doc.height,crop:doc.crop as Rect | null | undefined,appearance:doc.appearance});
  let pointCount = 0;
  const ids = new Set<string>();
  for (const value of doc.annotations as unknown[]) {
    if (!isRecord(value) || typeof value.type !== 'string' || !TYPES.has(value.type) || typeof value.id !== 'string' || value.id.length > 128 || ids.has(value.id) || typeof value.color !== 'string' || !COLOR.test(value.color) || !finite(value.width,0.5,200)) throw new Error('标注数据无效');
    const a=value;
    ids.add(value.id);
    if ((a.rotation!=null && (!finite(a.rotation,0,360)||a.rotation===360)) ||
      ['flipX','flipY'].some(key=>a[key]!=null&&typeof a[key]!=='boolean')) throw new Error('标注变换参数无效');
    if (a.type === 'arrow' || a.type === 'pen' || a.type==='highlighter') {
      if (!Array.isArray(a.points) || !a.points.length || a.points.length > 20_000 || (a.type === 'arrow' && a.points.length !== 2)) throw new Error('笔画数据无效');
      if (a.type === 'arrow' && a.style != null && (typeof a.style !== 'string' || !ARROW_STYLES.has(a.style))) throw new Error('箭头样式无效');
      if (a.type === 'arrow' && a.control != null && (!isRecord(a.control) || !finite(a.control.x,-1_000_000,1_000_000) || !finite(a.control.y,-1_000_000,1_000_000))) throw new Error('箭头控制点无效');
      for (const p of a.points as unknown[]) if (!isRecord(p) || !finite(p.x,-1_000_000,1_000_000) || !finite(p.y,-1_000_000,1_000_000)) throw new Error('笔画坐标无效');
      pointCount += a.points.length;
    } else if (a.type === 'number') {
      if (!finite(a.x,-1_000_000,1_000_000) || !finite(a.y,-1_000_000,1_000_000) || !Number.isInteger(a.number) || !finite(a.number,1,999) || !finite(a.radius??18,12,160) || (a.style != null && a.style !== 'filled' && a.style !== 'outline')) throw new Error('编号标注无效');
    } else if (a.type === 'text') {
      if (!finite(a.x,-1_000_000,1_000_000) || !finite(a.y,-1_000_000,1_000_000) || typeof a.text !== 'string' || a.text.length > 10_000 || !finite(a.fontSize||28,8,512)) throw new Error('文字标注无效');
    } else {
      if (!validRect(a)) throw new Error('标注范围无效');
      if (a.type==='redact' && ((a.style!=null && (typeof a.style !== 'string' || !['blur','pixelate','solid'].includes(a.style))) || (a.intensity!=null && !finite(a.intensity,4,40)))) throw new Error('模糊效果参数无效');
    }
  }
  if (pointCount > 200_000) throw new Error('笔画数量过多');
  // Every document and variant field is validated above before entering the typed model.
  return cloneDocument({...doc,crop:doc.crop||null} as unknown as CiipDocument);
}

export function serializeDocument(doc: CiipDocument) {
  return JSON.stringify(validateDocument(doc));
}

export function parseDocument(json: string): CiipDocument {
  if (typeof json !== 'string' || json.length > 100 * 1024 * 1024) throw new Error('编辑文档过大或格式无效');
  return validateDocument(JSON.parse(json));
}

export class History {
  limit: number;
  entries: CiipDocument[]=[];
  index=0;
  constructor(doc: CiipDocument, limit = 50) {
    this.limit = Math.max(2, limit);
    this.reset(doc);
  }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  reset(doc: CiipDocument) {
    this.entries = [cloneDocument(doc)];
    this.index = 0;
  }
  push(doc: CiipDocument) {
    this.entries.splice(this.index + 1);
    this.entries.push(cloneDocument(doc));
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
  }
  undo() { return this.canUndo ? cloneDocument(this.entries[--this.index]) : null; }
  redo() { return this.canRedo ? cloneDocument(this.entries[++this.index]) : null; }
}
