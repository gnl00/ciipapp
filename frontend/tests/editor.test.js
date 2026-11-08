import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument, cloneDocument, normalizeRect, clampRect, hitTest, translateAnnotation, annotationBounds, selectionBounds, selectionFrame, selectionHandles, resizeAnnotation, rotateAnnotation, flipAnnotation, annotationTransform, annotationPoint, arrowHead, curveControl, nextNumber, serializeDocument, parseDocument, outputSize, frameLayout, backgroundPresets, drawBackground, History, renderAnnotation, renderDocument} from '../src/editor.ts';
import {gaussianBlurRGBA} from '../src/effects.ts';

const base = 'data:image/png;base64,iVBORw0KGgo=';
const doc = () => createDocument(base, 800, 600, 'capture.png');
const arrow = {id: 'a', type: 'arrow', points: [{x: 20, y: 40}, {x: 120, y: 80}], width: 4, color: '#e85745'};

test('reverse-direction crop snaps outward but stays inside source', () => {
  assert.deepEqual(clampRect(normalizeRect({x: 900.5, y: 500.2}, {x: -20, y: 100.8}), 800, 600), {x: 0, y: 100, w: 800, h: 401});
  const d = doc();
  d.crop = {x: 100, y: 80, w: 220, h: 140};
  assert.deepEqual(outputSize(d), {width: 220, height: 140});
});

test('line hit testing follows the line, not its bounding rectangle', () => {
  assert.equal(hitTest(arrow, {x: 70, y: 60}), true);
  assert.equal(hitTest(arrow, {x: 20, y: 80}), false);
  assert.equal(hitTest({id: 'p', type: 'pen', width: 3, points: [{x: 10, y: 10}]}, {x: 12, y: 12}), true);
  assert.deepEqual(translateAnnotation(arrow, 5, -10).points, [{x: 25, y: 30}, {x: 125, y: 70}]);
  assert.deepEqual(arrow.points, [{x: 20, y: 40}, {x: 120, y: 80}]);
});

test('pinned document round trip preserves editable source, crop and strokes', () => {
  const d = doc();
  d.annotations = [arrow, {id: 'text', type: 'text', x: 90, y: 200, text: '可再次编辑\nciip', fontSize: 28, width: 3, color: '#141414'}];
  d.crop = {x: 10, y: 20, w: 700, h: 500};
  const restored = parseDocument(serializeDocument(d));
  assert.deepEqual(restored, d);
  restored.annotations[0].points[0].x = 900;
  assert.equal(d.annotations[0].points[0].x, 20);
});

test('untrusted documents reject active URLs, excessive sizes, invalid crop and coordinates', () => {
  for (const change of [
    {base: 'javascript:alert(1)'},
    {base: 'data:image/svg+xml;base64,PHN2Zz4='},
    {width: 100000},
    {crop: {x: 790, y: 0, w: 100, h: 20}},
    {annotations: [{...arrow, points: [{x: null, y: 0}, {x: 10, y: 10}]}]},
    {annotations: [{...arrow, color: 'url(https://example.com)'}]},
  ]) assert.throws(() => parseDocument(JSON.stringify({...doc(), ...change})));
});

test('undo/redo restores independent snapshots and edit after undo drops future', () => {
  const d = doc(), history = new History(d, 3);
  d.annotations.push(structuredClone(arrow));
  history.push(d);
  d.annotations[0].points[0].x = 300;
  history.push(d);
  const previous = history.undo();
  assert.equal(previous.annotations[0].points[0].x, 20);
  previous.annotations[0].points[0].x = 999;
  assert.equal(history.redo().annotations[0].points[0].x, 300);
  history.undo();
  history.push({...d, annotations: []});
  assert.equal(history.canRedo, false);
  assert.equal(history.undo().annotations[0].points[0].x, 20);
});

test('solid redaction exports the selected color opaquely and covers fractional edges', () => {
  const fills = [];
  const ctx = {save() {}, restore() {}, setLineDash() {}, fillRect(...rect) {fills.push({rect, color: this.fillStyle, alpha: this.globalAlpha, composite: this.globalCompositeOperation});}};
  for(const style of [undefined,'solid'])renderAnnotation(ctx, {type: 'redact', style, x: 10.8, y: 11.2, w: 20.5, h: 8.4, color: '#c94632', width: 3});
  assert.deepEqual(fills, ['#171717','#c94632'].map(color=>({rect: [10, 11, 22, 9], color, alpha: 1, composite: 'source-over'})));
});

const numbered = {id: 'n1', type: 'number', x: 100, y: 80, number: 7, radius: 18, style: 'filled', width: 4, color: '#df543a'};

test('number hit area is circular and moving it preserves its editable value and style', () => {
  assert.deepEqual(annotationBounds(numbered), {x: 82, y: 62, w: 36, h: 36});
  assert.equal(hitTest(numbered, {x: 116, y: 80}, 0), true);
  assert.equal(hitTest(numbered, {x: 116, y: 96}, 0), false);
  assert.deepEqual(translateAnnotation(numbered, 25, -10), {...numbered, x: 125, y: 70});
  assert.equal(numbered.x, 100);
});

test('number sequence follows current maximum across delete and undo without overflowing', () => {
  const d = doc(), history = new History(d);
  assert.equal(nextNumber(d.annotations), 1);
  d.annotations.push(numbered, {...numbered, id: 'n2', number: 3}, arrow);
  history.push(d);
  assert.equal(nextNumber(d.annotations), 8);
  d.annotations = d.annotations.filter(a => a.id !== 'n1');
  history.push(d);
  assert.equal(nextNumber(d.annotations), 4);
  assert.equal(nextNumber(history.undo().annotations), 8);
  assert.equal(nextNumber([{...numbered, number: 999}]), null);
});

test('pin round trip keeps number attributes, new pointer arrows and legacy line arrows', () => {
  const d = doc();
  d.annotations = [numbered, {...numbered, id: 'n2', style: 'outline', radius: 40, number: 999}, {...arrow, style: 'pointer'}, {...arrow, id: 'legacy'}];
  assert.deepEqual(parseDocument(serializeDocument(d)), d);
  for (const annotation of [
    {...numbered, number: 0}, {...numbered, number: 1000}, {...numbered, number: 1.5},
    {...numbered, radius: 0}, {...numbered, radius: 161}, {...numbered, style: 'unknown'},
    {...arrow, style: 'unknown'},
  ]) assert.throws(() => serializeDocument({...d, annotations: [annotation]}));
});

test('pointer geometry covers its full triangular head without a shaft extending beyond its tip', () => {
  const a = {...arrow, points: [{x: 0, y: 0}, {x: 100, y: 0}], style: 'pointer'};
  assert.deepEqual(arrowHead(a), {base: {x: 80, y: 0}, left: {x: 80, y: 9}, right: {x: 80, y: -9}});
  assert.deepEqual(annotationBounds(a), {x: 0, y: -9, w: 100, h: 18});
  assert.equal(hitTest(a, {x: 82, y: 7}, 0), true);
  assert.equal(hitTest(a, {x: 82, y: 16}, 0), false);
  assert.equal(hitTest({...a, points: [{x: 10, y: 10}, {x: 10, y: 10}]}, {x: 200, y: 200}, 0), false);
  const short = arrowHead({...a, points: [{x: 0, y: 0}, {x: 4, y: 0}]});
  assert.equal(short.base.x, 2);
});

function drawingContext() {
  let path = [];
  const calls = [];
  return {
    calls, get currentPath(){return path;}, save() {}, restore() {}, setLineDash() {},
    beginPath() {path = [];},
    moveTo(x,y) {path.push(['move',x,y]);},
    lineTo(x,y) {path.push(['line',x,y]);},
    quadraticCurveTo(...args) {path.push(['quadratic',...args]);},
    bezierCurveTo(...args) {path.push(['bezier',...args]);},
    closePath() {path.push(['close']);},
    arc(...args) {path.push(['arc',...args]);},
    ellipse(...args) {path.push(['ellipse',...args]);},
    strokeRect(...args) {calls.push({kind:'rectangle',args});},
    fillRect(...args) {calls.push({kind:'solid',args});},
    fill() {calls.push({kind:'fill',path:[...path],color:this.fillStyle});},
    stroke() {calls.push({kind:'stroke',path:[...path],color:this.strokeStyle,width:this.lineWidth});},
    measureText(text) {const size=Number(this.font.match(/[\d.]+(?=px)/)[0]);return {width:text.length*size*.6,actualBoundingBoxAscent:size*.7,actualBoundingBoxDescent:size*.05};},
    transform(...matrix) {calls.push({kind:'transform',matrix});},
    fillText(text,x,y,maxWidth) {calls.push({kind:'text',text,x,y,maxWidth,color:this.fillStyle,font:this.font,align:this.textAlign,baseline:this.textBaseline});},
  };
}

test('filled number has a colored disc while outlined number leaves source pixels visible', () => {
  const filled = drawingContext(), outline = drawingContext();
  renderAnnotation(filled, numbered);
  renderAnnotation(outline, {...numbered, number: 999, style: 'outline'});
  assert.equal(filled.calls.filter(c => c.kind === 'stroke').length, 1);
  assert.equal(filled.calls.find(c => c.kind === 'stroke').width, 1);
  assert.equal(filled.calls.find(c => c.kind === 'fill').color, numbered.color);
  assert.equal(outline.calls.filter(c => c.kind === 'fill').length, 0);
  assert.equal(outline.calls.find(c => c.kind === 'stroke').color, numbered.color);
  const text = outline.calls.find(c => c.kind === 'text');
  assert.equal(text.text, '999');
  assert.equal(text.color, numbered.color);
  assert.equal(text.x, numbered.x);
  assert.equal(text.align, 'center');
  assert.equal(text.baseline, 'alphabetic');
  assert.equal(text.maxWidth, 18 * 1.6);
  assert.match(text.font, /^600 /);
  assert.ok(outline.calls.find(c => c.kind === 'stroke').width <= 2.5);
});

test('pointer arrows fill a closed triangle while legacy arrows keep an open stroked head', () => {
  const pointer = drawingContext(), legacy = drawingContext();
  const a = {...arrow, points: [{x: 0, y: 0}, {x: 100, y: 0}]};
  renderAnnotation(pointer, {...a, style: 'pointer'});
  renderAnnotation(legacy, a);
  assert.deepEqual(pointer.calls[0].path, [['move',0,0],['line',80,0]]);
  assert.deepEqual(pointer.calls[1], {kind:'fill',path:[['move',80,9],['line',100,0],['line',80,-9],['close']],color:a.color});
  assert.deepEqual(legacy.calls.map(c => c.kind), ['stroke','stroke']);
  assert.equal(legacy.calls[1].path.some(command => command[0] === 'close'), false);
});

test('curved arrow default control bends perpendicular to the chord and bounds follow the curve', () => {
  const a = {...arrow, style:'curved', points:[{x:0,y:0},{x:100,y:0}]};
  assert.deepEqual(curveControl(a), {x:50,y:22});
  const bent = {...a, control:{x:50,y:50}};
  assert.deepEqual(annotationBounds(bent), {x:0,y:0,w:100,h:25});
  assert.equal(hitTest(bent,{x:50,y:25},0),true);
  assert.equal(hitTest(bent,{x:50,y:0},0),false);
  assert.equal(hitTest(bent,{x:50,y:8},0),false);
  const head=arrowHead(bent);
  assert.ok(head.base.y>0);
  assert.ok(Math.abs((100-head.base.x) - head.base.y)<1e-9);
  const ctx=drawingContext();
  renderAnnotation(ctx,bent);
  assert.deepEqual(ctx.calls[0].path,[['move',0,0],['quadratic',50,50,100,0]]);
});

test('explicit curve controls survive move, pin round trip and independent undo snapshots', () => {
  const a={...arrow,style:'curved',control:{x:35,y:-70}};
  const d={...doc(),annotations:[a]}, history=new History(d);
  const moved=translateAnnotation(a,40,-20);
  assert.deepEqual(moved.control,{x:75,y:-90});
  assert.deepEqual(moved.points,[{x:60,y:20},{x:160,y:60}]);
  assert.deepEqual(a.control,{x:35,y:-70});
  const duplicate=cloneDocument(d);
  duplicate.annotations[0].control.x=900;
  assert.equal(a.control.x,35);
  d.annotations=[moved];history.push(d);
  moved.control.y=700;
  assert.equal(history.undo().annotations[0].control.y,-70);
  assert.equal(history.redo().annotations[0].control.y,-90);
  const variants=['line','pointer','curved','tapered','direction'].map((style,i)=>({...a,id:String(i),style}));
  assert.deepEqual(parseDocument(serializeDocument({...doc(),annotations:variants})).annotations,variants);
  for(const control of [{x:null,y:0},{x:0,y:'4'},{x:1e7,y:0},'curve'])assert.throws(()=>serializeDocument({...doc(),annotations:[{...a,control}]}));
});

test('tapered and direction arrows select their filled silhouettes instead of their bounding boxes', () => {
  const base={...arrow,points:[{x:0,y:0},{x:100,y:0}]};
  const tapered={...base,style:'tapered'}, direction={...base,style:'direction'};
  assert.equal(hitTest(tapered,{x:10,y:2},0),false);
  assert.equal(hitTest(direction,{x:10,y:2},0),true);
  assert.equal(hitTest(tapered,{x:70,y:2},0),true);
  assert.equal(hitTest(direction,{x:20,y:8},0),false);
  assert.equal(hitTest(direction,{x:84,y:6},0),true);
  for(const a of [tapered,direction]){
    const ctx=drawingContext();renderAnnotation(ctx,a);
    assert.deepEqual(ctx.calls.map(c=>c.kind),['fill']);
    assert.equal(ctx.calls[0].path.at(-1)[0],'close');
    const bounds=annotationBounds(a);
    for(const command of ctx.calls[0].path.filter(c=>c.length===3)){
      assert.ok(command[1]>=bounds.x && command[1]<=bounds.x+bounds.w);
      assert.ok(command[2]>=bounds.y && command[2]<=bounds.y+bounds.h);
    }
  }
});

test('zero and subpixel arrows remain finite for every style and do not hit distant pixels', () => {
  for(const style of ['line','pointer','curved','tapered','direction'])for(const delta of [0,.001]){
    const a={...arrow,style,points:[{x:10,y:10},{x:10+delta,y:10+delta}]};
    assert.ok(Object.values(annotationBounds(a)).every(Number.isFinite));
    assert.ok(Object.values(arrowHead(a)).every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)));
    assert.equal(hitTest(a,{x:200,y:200},0),false);
    const ctx=drawingContext();renderAnnotation(ctx,a);
    for(const call of ctx.calls)assert.ok(call.path.flat().every(value=>typeof value!=='number'||Number.isFinite(value)));
  }
});

test('number typography uses medium weight, centered ink metrics, and white text on the default red', () => {
  const ctx=drawingContext();
  ctx.measureText=()=>({width:8,actualBoundingBoxAscent:12,actualBoundingBoxDescent:2,actualBoundingBoxLeft:3,actualBoundingBoxRight:5});
  renderAnnotation(ctx,{...numbered,number:1,radius:16,color:'#c94632'});
  const text=ctx.calls.find(c=>c.kind==='text');
  assert.equal(text.color,'#ffffff');
  assert.match(text.font,/^600 17\.6px /);
  assert.equal(text.x,numbered.x-1);
  assert.equal(text.y,numbered.y+5);
  assert.equal((text.x-3+text.x+5)/2,numbered.x);
  assert.equal((text.y-12+text.y+2)/2,numbered.y);
  const outline=drawingContext();renderAnnotation(outline,{...numbered,style:'outline',radius:16,width:12});
  assert.equal(outline.calls.find(c=>c.kind==='stroke').width,1.6);
  assert.equal(outline.calls.filter(c=>c.kind==='fill').length,0);
  const three=drawingContext();renderAnnotation(three,{...numbered,number:999,radius:16});
  const threeText=three.calls.find(c=>c.kind==='text');
  assert.ok(Number(threeText.font.match(/[\d.]+(?=px)/)[0])<16);
  assert.equal(threeText.maxWidth,25.6);
});

test('filled number text meets normal-size WCAG contrast across the annotation palette', () => {
  function light(hex){const linear=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;}
  for(const color of ['#c94632','#e6a32b','#4d9060','#347bc7','#9b66ad','#202322']){
    const ctx=drawingContext();renderAnnotation(ctx,{...numbered,color,radius:16});
    const foreground=light(ctx.calls.find(c=>c.kind==='text').color),background=light(color);
    assert.ok((Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)>=4.5,color);
  }
});

test('pen follows a smooth quadratic path and hit testing follows the rendered ink', () => {
  const pen={id:'pen',type:'pen',points:[{x:0,y:0},{x:50,y:100},{x:100,y:0}],color:'#c94632',width:4};
  const ctx=drawingContext();renderAnnotation(ctx,pen);
  assert.deepEqual(ctx.calls[0].path,[['move',0,0],['quadratic',50,100,75,50],['quadratic',100,0,100,0]]);
  assert.equal(hitTest(pen,{x:43.75,y:62.5},0),true);
  assert.equal(hitTest(pen,{x:50,y:100},0),false);
  assert.deepEqual(translateAnnotation(pen,10,-20).points,[{x:10,y:-20},{x:60,y:80},{x:110,y:-20}]);
});

test('self-crossing highlighter is one transparent composite, not overlapping segment strokes', () => {
  const highlighter={id:'highlight',type:'highlighter',points:[{x:0,y:0},{x:80,y:80},{x:0,y:80},{x:80,y:0}],color:'#e6a32b',width:24};
  const ctx=drawingContext(), alphas=[], original=ctx.stroke;
  ctx.stroke=function(){alphas.push(this.globalAlpha);original.call(this);};
  renderAnnotation(ctx,highlighter);
  assert.deepEqual(alphas,[.28]);
  assert.equal(ctx.calls.filter(c=>c.kind==='stroke').length,1);
  assert.equal(ctx.calls[0].path.filter(c=>c[0]==='quadratic').length,3);
  assert.deepEqual(parseDocument(serializeDocument({...doc(),annotations:[highlighter]})).annotations,[highlighter]);
});

test('background layout maps cropped source pixels into padded output and crop mode stays unframed', () => {
  const d={...doc(),crop:{x:100,y:80,w:220,h:140},appearance:{background:'mesh',padding:32,radius:24}};
  assert.deepEqual(frameLayout(d),{crop:{x:100,y:80,w:220,h:140},width:284,height:204,offsetX:32,offsetY:32,padding:32,radius:24,background:'mesh'});
  assert.deepEqual(outputSize(d),{width:284,height:204});
  assert.deepEqual(frameLayout(d,{fullImage:true}),{crop:{x:0,y:0,w:800,h:600},width:800,height:600,offsetX:0,offsetY:0,padding:0,radius:0,background:'none'});
  const transparent={...d,appearance:{...d.appearance,background:'none'}};
  assert.equal(frameLayout(transparent).padding,0);
  assert.equal(frameLayout(transparent).radius,24);
  assert.deepEqual(outputSize(transparent),{width:220,height:140});
});

test('appearance and all effect modes round trip, clone independently and undo without losing legacy solid', () => {
  const redaction={id:'r',type:'redact',x:10,y:20,w:100,h:80,color:'#171717',width:4};
  const d={...doc(),appearance:{background:'sage',padding:48,radius:24},annotations:[redaction,...['blur','pixelate','solid'].map((style,i)=>({...redaction,id:`r${i}`,style,intensity:20}))]};
  assert.deepEqual(parseDocument(serializeDocument(d)),d);
  const history=new History(d),copy=cloneDocument(d);
  copy.appearance.radius=40;
  assert.equal(d.appearance.radius,24);
  history.push(copy);copy.appearance.padding=100;
  assert.equal(history.undo().appearance.padding,48);
  assert.equal(history.redo().appearance.radius,40);
  for(const appearance of [{background:'unknown'},{background:'paper',padding:1.5},{radius:-1},{radius:161},{padding:241}])assert.throws(()=>serializeDocument({...doc(),appearance}));
  for(const change of [{style:'unknown'},{intensity:3},{intensity:41},{intensity:'12'}])assert.throws(()=>serializeDocument({...doc(),annotations:[{...redaction,...change}]}));
});

test('padding cannot push exports beyond the native pixel budget or canvas dimension limit', () => {
  const maximum={...doc(),width:10000,height:6000};
  assert.deepEqual(outputSize(maximum),{width:10000,height:6000});
  assert.throws(()=>outputSize({...maximum,appearance:{background:'white',padding:1,radius:0}}));
  assert.throws(()=>frameLayout({...doc(),width:32768,height:1,appearance:{background:'white',padding:1}}));
});

test('Gaussian fallback changes pixels symmetrically, preserves flat colors and ignores hidden transparent RGB', () => {
  const pixels=new Uint8ClampedArray(9*4);
  for(let x=0;x<9;x++)pixels[x*4+3]=255;
  pixels[4*4]=255;
  const blurred=gaussianBlurRGBA(pixels,9,1,1);
  assert.ok(blurred[16]>0&&blurred[16]<255);
  assert.ok(blurred[12]>blurred[8]&&blurred[8]>0);
  for(let x=0;x<9;x++){assert.equal(blurred[x*4],blurred[(8-x)*4]);assert.equal(blurred[x*4+3],255);}
  const flat=Uint8ClampedArray.from({length:7*5*4},(_,i)=>[50,110,170,255][i%4]);
  assert.deepEqual(gaussianBlurRGBA(flat,7,5,4),flat);
  const transparent=new Uint8ClampedArray([255,0,0,0,0,0,255,255,255,0,0,0]);
  const mixed=gaussianBlurRGBA(transparent,3,1,1);
  for(let x=0;x<3;x++){assert.equal(mixed[x*4],0);assert.equal(mixed[x*4+2],255);}
  assert.throws(()=>gaussianBlurRGBA(pixels,8,1,1));
});

function surfaceFactory() {
  const surfaces=[];
  const owner={createElement(){
    const canvas={width:0,height:0,ownerDocument:owner},ctx=drawingContext();
    let transform={e:0,f:0}, stack=[];
    ctx.canvas=canvas;ctx.filter='none';canvas.context=ctx;
    canvas.getContext=()=>ctx;
    ctx.save=()=>stack.push({...transform});ctx.restore=()=>{transform=stack.pop()||{e:0,f:0};};
    ctx.scale=(x,y)=>{transform.a=(transform.a??1)*x;transform.d=(transform.d??1)*y;};
    ctx.translate=(x,y)=>{transform.e+=x*(transform.a??1);transform.f+=y*(transform.d??1);};ctx.getTransform=()=>({...transform});
    ctx.clearRect=()=>ctx.calls.push({kind:'clear'});
    ctx.rect=(...args)=>ctx.calls.push({kind:'rect',args});ctx.clip=()=>ctx.calls.push({kind:'clip',path:[...ctx.currentPath]});
    ctx.strokeRect=(...args)=>ctx.calls.push({kind:'selection',args});
    ctx.fillRect=(...args)=>ctx.calls.push({kind:'fillRect',args,color:ctx.fillStyle});
    ctx.drawImage=(source,...args)=>ctx.calls.push({kind:'image',source,args,transform:{...transform},filter:ctx.filter,smoothing:ctx.imageSmoothingEnabled,composite:ctx.globalCompositeOperation,prior:source.context?.calls.slice()});
    ctx.createLinearGradient=ctx.createRadialGradient=()=>({addColorStop(){}});
    ctx.createImageData=(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)});
    ctx.putImageData=(pixels,x,y)=>ctx.calls.push({kind:'pixels',pixels,x,y});
    surfaces.push(canvas);return canvas;
  }};
  return {surfaces,create:()=>owner.createElement('canvas')};
}

test('preview caches the static background and source while preserving annotation order for redaction and export', () => {
  const factory=surfaceFactory(),canvas=factory.create();canvas.width=864;canvas.height=664;
  const image={},d={...doc(),appearance:{background:'warm',padding:32,radius:16},annotations:[{id:'txt',type:'text',x:60,y:60,text:'secret',fontSize:28,color:'#171717',width:4},{id:'blur',type:'redact',x:50,y:50,w:120,h:60,style:'blur',intensity:12,color:'#171717',width:4}]};
  renderDocument(canvas.context,d,image,{pixelRatio:1});
  const frame=factory.surfaces[1],baseFrame=factory.surfaces[2],sourceCopy=factory.surfaces.find(surface=>surface.context.calls[0]?.prior?.some(c=>c.kind==='text'&&c.text==='secret'));
  assert.ok(baseFrame.context.calls.findIndex(c=>c.kind==='fillRect'||c.kind==='image')<baseFrame.context.calls.findIndex(c=>c.kind==='clip'));
  assert.deepEqual(baseFrame.context.calls.find(c=>c.kind==='image'&&c.source===image).transform,{e:32,f:32});
  assert.ok(sourceCopy.context.calls[0].prior.some(c=>c.kind==='text'&&c.text==='secret'));
  assert.ok(factory.surfaces.some(surface=>surface.context.calls.some(c=>c.kind==='image'&&c.filter==='blur(12px)')));
  assert.equal(frame.context.calls.filter(c=>c.kind==='image').at(-1).composite,'copy');
  const drawCount=()=>baseFrame.context.calls.filter(c=>c.kind==='image'&&c.source===image).length;
  renderDocument(canvas.context,d,image,{pixelRatio:1,selection:'txt'});assert.equal(drawCount(),1);
  const exported=factory.create();exported.width=864;exported.height=664;renderDocument(exported.context,d,image);
  assert.ok(exported.context.calls.some(c=>c.kind==='image'&&c.source===image));
  assert.ok(exported.context.calls.some(c=>c.kind==='text'&&c.text==='secret'));
  d.annotations[1].style='pixelate';renderDocument(canvas.context,d,image,{pixelRatio:1});
  assert.equal(drawCount(),1,'changing an annotation must not regenerate the static base');
  assert.ok(factory.surfaces.some(surface=>surface.context.calls.some(c=>c.kind==='image'&&c.smoothing===false)));
});

test('background presets draw deterministic local canvas content and none stays transparent', () => {
  const factory=surfaceFactory();
  assert.equal(new Set(backgroundPresets.map(p=>p.id)).size,backgroundPresets.length);
  for(const preset of backgroundPresets){
    const canvas=factory.create();drawBackground(canvas.context,preset.id,120,80);
    const fills=canvas.context.calls.filter(c=>c.kind==='fillRect'||c.kind==='image'||c.kind==='fill');
    assert.equal(fills.length>0,preset.id!=='none');
    if(preset.id==='paper'){
      const other=factory.create();drawBackground(other.context,preset.id,120,80);
      const output=target=>target.context.calls.find(c=>c.kind==='image').source.context.calls.find(c=>c.kind==='pixels').pixels;
      assert.deepEqual(output(other),output(canvas));
    }
  }
});

test('shape resize handles expose edges and corners, keep the opposite side fixed and clamp crossing', () => {
  const rectangle={id:'box',type:'rectangle',x:10,y:20,w:100,h:60,width:4,color:'#c94632'};
  const handles=selectionHandles(rectangle);
  assert.deepEqual(handles.map(h=>h.id),['nw','n','ne','e','se','s','sw','w']);
  assert.deepEqual(handles.find(h=>h.id==='e'),{id:'e',x:110,y:50,cursor:'ew-resize'});
  assert.deepEqual(resizeAnnotation(rectangle,'nw',{x:35,y:35}),{...rectangle,x:35,y:35,w:75,h:45});
  assert.deepEqual(resizeAnnotation(rectangle,'e',{x:160,y:999}),{...rectangle,w:150});
  assert.deepEqual(resizeAnnotation(rectangle,'w',{x:200,y:0}),{...rectangle,x:108,w:2});
  assert.deepEqual(selectionBounds(rectangle),{x:10,y:20,w:100,h:60});
  for(const type of ['rectangle','ellipse','redact']){
    const shape={...rectangle,type,...(type==='redact'?{style:'blur',intensity:24}:{})};
    const changed=resizeAnnotation(shape,'se',{x:190,y:110});
    assert.equal(changed.w,180);assert.equal(changed.h,90);
    assert.deepEqual(parseDocument(serializeDocument({...doc(),annotations:[changed]})).annotations,[changed]);
    assert.equal(shape.w,100);
  }
});

test('arrow endpoint resizing retains the other endpoint and explicit curve control without mutation', () => {
  const curved={...arrow,style:'curved',control:{x:30,y:-50}};
  assert.deepEqual(selectionHandles(curved).map(h=>h.id),['start','end']);
  const next=resizeAnnotation(curved,'end',{x:210,y:150});
  assert.deepEqual(next.points,[{x:20,y:40},{x:210,y:150}]);
  assert.deepEqual(next.control,{x:30,y:-50});
  next.control.x=800;
  assert.equal(curved.control.x,30);
  assert.deepEqual(curved.points[1],{x:120,y:80});
  const automatic=resizeAnnotation({...arrow,style:'curved'},'start',{x:10,y:20});
  assert.equal('control' in automatic,false);
  assert.deepEqual(curveControl(automatic),{x:51.8,y:74.2});
});

test('number and text resize uniformly from the fixed opposite corner within editable size limits', () => {
  const number=resizeAnnotation(numbered,'se',{x:154,y:134});
  assert.equal(number.radius,36);
  assert.deepEqual(selectionBounds(number),{x:82,y:62,w:72,h:72});
  const large=resizeAnnotation(numbered,'se',{x:10000,y:10000});
  assert.equal(large.radius,160);
  const small=resizeAnnotation(numbered,'nw',{x:10000,y:10000});
  assert.equal(small.radius,12);
  assert.equal(selectionBounds(small).x+selectionBounds(small).w,118);
  const text={id:'label',type:'text',x:50,y:60,text:'note',fontSize:20,width:4,color:'#c94632'};
  const box=selectionBounds(text);
  const twice=resizeAnnotation(text,'se',{x:box.x+box.w*2,y:box.y+box.h*2});
  assert.equal(twice.fontSize,40);
  assert.deepEqual({x:twice.x,y:twice.y},{x:50,y:60});
  assert.equal(resizeAnnotation(text,'se',{x:1e6,y:1e6}).fontSize,512);
  assert.equal(resizeAnnotation(text,'se',{x:-1e6,y:-1e6}).fontSize,8);
  assert.deepEqual(selectionHandles(text).map(h=>h.id),['nw','ne','se','sw']);
  for(const changed of [number,large,small,twice])assert.doesNotThrow(()=>serializeDocument({...doc(),annotations:[changed]}));
});

test('ink scaling respects its visible box and handles horizontal, vertical and single-point strokes', () => {
  for(const type of ['pen','highlighter'])for(const points of [[{x:10,y:20},{x:110,y:20}],[{x:10,y:20},{x:10,y:100}],[{x:10,y:20}],[{x:10,y:20},{x:40,y:100},{x:110,y:60}]]){
    const ink={id:'ink',type,points,width:4,color:'#c94632'},box=selectionBounds(ink);
    const changed=resizeAnnotation(ink,'se',{x:box.x+box.w*2,y:box.y+box.h*2});
    assert.equal(changed.width,8);
    assert.deepEqual(selectionBounds(changed),{x:box.x,y:box.y,w:box.w*2,h:box.h*2});
    assert.deepEqual(ink.points,points);
    assert.doesNotThrow(()=>serializeDocument({...doc(),annotations:[changed]}));
  }
  const ink={id:'ink',type:'highlighter',points:[{x:10,y:20},{x:100,y:60}],width:20,color:'#e6a32b'},box=selectionBounds(ink);
  const stretched=resizeAnnotation(ink,'se',{x:box.x+box.w*3,y:box.y+box.h*1.5});
  const bounds=selectionBounds(stretched);
  for(const key of ['x','y','w','h'])assert.ok(Math.abs(bounds[key]-({x:box.x,y:box.y,w:box.w*3,h:box.h*1.5})[key])<1e-9);
});

test('resized objects remain independent history snapshots and reject invalid drag input', () => {
  const initial={...doc(),annotations:[{...arrow,style:'curved',control:{x:50,y:-20}}]},history=new History(initial);
  const next=cloneDocument(initial);
  next.annotations[0]=resizeAnnotation(next.annotations[0],'end',{x:300,y:150});
  history.push(next);
  next.annotations[0].points[1].x=900;
  assert.deepEqual(history.undo().annotations,initial.annotations);
  assert.deepEqual(history.redo().annotations[0].points[1],{x:300,y:150});
  assert.throws(()=>resizeAnnotation(arrow,'end',{x:NaN,y:0}));
  assert.throws(()=>resizeAnnotation(arrow,'se',{x:0,y:0}));
  const edge=resizeAnnotation(arrow,'end',{x:1e30,y:-1e30});
  assert.deepEqual(edge.points[1],{x:1e6,y:-1e6});
  assert.doesNotThrow(()=>serializeDocument({...doc(),annotations:[edge]}));
});

test('browser text bounds use actual glyph metrics and resizing preserves the visible ink anchor', async () => {
  const previous=globalThis.document;
  const context={measureText(line){const size=parseFloat(this.font.match(/[\d.]+(?=px)/)[0]),s=size/20;return {width:20*s,actualBoundingBoxLeft:line==='AB'?2*s:0,actualBoundingBoxRight:20*s,actualBoundingBoxAscent:-3*s,actualBoundingBoxDescent:17*s};}};
  globalThis.document={createElement:()=>({getContext:()=>context})};
  try {
    const measured=await import('../src/editor.ts?measured-resize');
    const text={id:'t',type:'text',x:100,y:200,text:'AB\n中',fontSize:20,width:4,color:'#171717'};
    assert.deepEqual(measured.selectionBounds(text),{x:98,y:203,w:22,h:40});
    const changed=measured.resizeAnnotation(text,'se',{x:142,y:283});
    assert.equal(changed.fontSize,40);
    assert.deepEqual(measured.selectionBounds(changed),{x:98,y:203,w:44,h:80});
    assert.deepEqual({x:changed.x,y:changed.y},{x:102,y:197});
    assert.equal(context.textBaseline,'top');
    assert.match(context.font,/^600 40px /);
  } finally {
    if(previous===undefined)delete globalThis.document;else globalThis.document=previous;
  }
});


test('filled arrow contours stay finite, forward-facing and inside exact bounds across scale and rotation', () => {
  for(const style of ['tapered','direction'])for(const length of [.001,4,40,4000])for(const width of [.5,4,200])for(const angle of [0,Math.PI/4,Math.PI/2,Math.PI*.73]) {
    const ux=Math.cos(angle),uy=Math.sin(angle),start={x:30,y:-20};
    const a={...arrow,style,width,points:[start,{x:start.x+ux*length,y:start.y+uy*length}]};
    const bounds=annotationBounds(a),ctx=drawingContext();renderAnnotation(ctx,a);
    let previous;
    const check=p=>{
      assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
      assert.ok(p.x>=bounds.x-1e-8&&p.x<=bounds.x+bounds.w+1e-8,style);
      assert.ok(p.y>=bounds.y-1e-8&&p.y<=bounds.y+bounds.h+1e-8,style);
      const along=(p.x-start.x)*ux+(p.y-start.y)*uy;
      assert.ok(along>=-1e-8&&along<=length+1e-8,'short or thick heads must not project behind their tail');
    };
    for(const command of ctx.calls[0].path) {
      if(command[0]==='close')continue;
      const end={x:command.at(-2),y:command.at(-1)};
      if(command[0]==='quadratic')for(let i=0;i<=30;i++){
        const t=i/30,u=1-t;
        check({x:u*u*previous.x+2*u*t*command[1]+t*t*end.x,y:u*u*previous.y+2*u*t*command[2]+t*t*end.y});
      } else check(end);
      previous=end;
    }
    assert.equal(hitTest(a,{x:start.x+ux*length*.5,y:start.y+uy*length*.5},0),true);
    assert.equal(hitTest(a,{x:start.x-ux,y:start.y-uy},0),false);
  }
});

test('taper gains width gradually while its rounded contour stays selectable after endpoint edits', () => {
  const a={...arrow,style:'tapered',points:[{x:0,y:0},{x:400,y:0}]};
  assert.equal(hitTest(a,{x:30,y:1.2},0),false);
  assert.equal(hitTest(a,{x:180,y:1.2},0),true);
  assert.equal(hitTest(a,{x:340,y:3.6},0),true);
  const moved=resizeAnnotation(a,'end',{x:0,y:-400});
  assert.equal(hitTest(moved,{x:1.2,y:-30},0),false);
  assert.equal(hitTest(moved,{x:1.2,y:-180},0),true);
  assert.equal(hitTest(moved,{x:3.6,y:-340},0),true);
  const history=new History({...doc(),annotations:[a]});
  history.push({...doc(),annotations:[moved]});
  assert.deepEqual(history.undo().annotations,[a]);
  assert.deepEqual(history.redo().annotations,[moved]);
  const ctx=drawingContext();renderAnnotation(ctx,a);
  assert.equal(ctx.calls.length,1);
  assert.equal(ctx.calls[0].kind,'fill');
  assert.ok(ctx.calls[0].path.filter(c=>c[0]==='quadratic').length>=4);
});


const almost=(actual,expected,message='')=>assert.ok(Math.abs(actual-expected)<1e-7,`${message}: ${actual} != ${expected}`);
const sameBox=(a,b)=>{for(const key of ['x','y','w','h'])almost(a[key],b[key],key);};
const label={id:'label',type:'text',x:140,y:180,text:'rotate me',fontSize:20,width:4,color:'#347bc7'};

test('quarter turns and reflections preserve point geometry, curve handedness and reversible shapes',()=>{
  for(const source of [arrow,{...arrow,style:'curved'}, {...arrow,type:'pen',points:[{x:20,y:30},{x:90,y:40},{x:65,y:110}]}, {...arrow,type:'highlighter'},
    {id:'box',type:'rectangle',x:20,y:40,w:100,h:60,width:4,color:'#c94632'}, {id:'ellipse',type:'ellipse',x:20,y:40,w:100,h:60,width:4,color:'#c94632'},
    {id:'blur',type:'redact',style:'blur',intensity:12,x:20,y:40,w:100,h:60,width:4,color:'#c94632'},label,numbered]) {
    const snapshot=structuredClone(source),box=selectionBounds(source);
    let rotated=source;
    for(let i=0;i<4;i++)rotated=rotateAnnotation(rotated);
    sameBox(selectionBounds(rotated),box);
    for(const axis of ['horizontal','vertical'])sameBox(selectionBounds(flipAnnotation(flipAnnotation(source,axis),axis)),box);
    assert.deepEqual(source,snapshot,'operations must not mutate undo snapshots');
    assert.doesNotThrow(()=>serializeDocument({...doc(),annotations:[rotated]}));
    const turned=rotateAnnotation(source);
    const next=selectionBounds(turned);
    almost(next.x+next.w/2,box.x+box.w/2);almost(next.y+next.h/2,box.y+box.h/2);
    almost(next.w,box.h);almost(next.h,box.w);
  }
  const curved={...arrow,style:'curved',points:[{x:0,y:0},{x:100,y:0}]};
  const flipped=flipAnnotation(curved,'vertical'),bounds=annotationBounds(curved),cy=bounds.y+bounds.h/2;
  almost(annotationPoint(flipped,curveControl(flipped)).y,2*cy-curveControl(curved).y);
  assert.equal(hitTest(flipped,{x:50,y:2*cy-11},0),true);
  assert.equal(hitTest(flipped,{x:50,y:2*cy+11},0),false);
  assert.equal(rotateAnnotation(label,45).rotation,45);assert.throws(()=>flipAnnotation(label,'diagonal'));
});

test('oriented text and numbers share visual transforms, hit regions and world-axis flips',()=>{
  for(const source of [label,numbered])for(const rotation of [0,90,180,270])for(const axis of ['horizontal','vertical']){
    const a=flipAnnotation(rotateAnnotation(source,rotation),axis),box=annotationBounds(source);
    const inside={x:box.x+box.w*.55,y:box.y+box.h*.45},shown=annotationPoint(a,inside),restored=annotationPoint(a,shown,true);
    almost(restored.x,inside.x);almost(restored.y,inside.y);assert.equal(hitTest(a,shown,0),true);
    assert.equal(hitTest(a,annotationPoint(a,{x:box.x-100,y:box.y-100}),0),false);
    const rotated=rotateAnnotation(source,rotation),prior=annotationPoint(rotated,inside),flipped=annotationPoint(a,inside),world=annotationBounds(rotated);
    almost(flipped.x,axis==='horizontal'?2*(world.x+world.w/2)-prior.x:prior.x);
    almost(flipped.y,axis==='vertical'?2*(world.y+world.h/2)-prior.y:prior.y);
    const ctx=drawingContext();renderAnnotation(ctx,a);
    if(a.rotation||a.flipX||a.flipY)assert.deepEqual(ctx.calls.find(c=>c.kind==='transform').matrix,Object.values(annotationTransform(a)));
    const moved=translateAnnotation(a,30,-20),after=annotationPoint(moved,{x:inside.x+30,y:inside.y-20});
    almost(after.x,shown.x+30);almost(after.y,shown.y-20);
  }
});

test('arbitrarily rotated and mirrored local resize handles keep the opposite world anchor fixed',()=>{
  const rectangle={id:'r',type:'rectangle',x:100,y:150,w:120,h:60,width:4,color:'#c94632'};
  const ink={id:'p',type:'pen',points:[{x:20,y:30},{x:90,y:40},{x:65,y:110}],width:4,color:'#c94632'};
  const sources=[label,numbered,rectangle,{...rectangle,type:'ellipse'},{...rectangle,type:'redact',style:'blur'},ink,{...ink,type:'highlighter'}];
  const opposite={nw:'se',n:'s',ne:'sw',e:'w',se:'nw',s:'n',sw:'ne',w:'e'};
  for(const source of sources)for(const rotation of [0,17.5,45,90,213,270])for(const axis of ['horizontal','vertical']) {
    const a=flipAnnotation(rotateAnnotation(source,rotation),axis),handles=selectionHandles(a);
    for(const handle of handles) {
      const anchor=handles.find(h=>h.id===opposite[handle.id]),target={x:anchor.x+(handle.x-anchor.x)*1.5,y:anchor.y+(handle.y-anchor.y)*1.5};
      const resized=resizeAnnotation(a,handle.id,target),next=selectionHandles(resized);
      const fixed=next.find(h=>h.id===anchor.id),dragged=next.find(h=>h.id===handle.id);
      almost(fixed.x,anchor.x,`${source.type} ${handle.id} fixed x`);almost(fixed.y,anchor.y,`${source.type} ${handle.id} fixed y`);
      almost(dragged.x,target.x,`${source.type} ${handle.id} target x`);almost(dragged.y,target.y,`${source.type} ${handle.id} target y`);
      assert.doesNotThrow(()=>serializeDocument({...doc(),annotations:[resized]}));
    }
  }
});

test('rotated redaction samples the new covered region without transforming source pixels',()=>{
  const source={id:'redact',type:'redact',x:40,y:60,w:120,h:40,width:4,color:'#c94632',style:'blur',intensity:12};
  const a=rotateAnnotation(source);
  assert.deepEqual(annotationBounds(a),{x:80,y:20,w:40,h:120});
  assert.equal(a.rotation,90);
  const factory=surfaceFactory(),canvas=factory.create();canvas.width=400;canvas.height=300;
  renderAnnotation(canvas.context,a);
  const copy=factory.surfaces[1].context.calls.find(c=>c.kind==='image');
  assert.deepEqual(copy.args,[44,0,112,176,0,0,112,176]);
  const solid={...a,style:'solid'},ctx=drawingContext();ctx.fillRect=(...args)=>ctx.calls.push({kind:'solid',args});renderAnnotation(ctx,solid);
  assert.deepEqual(ctx.calls,[{kind:'transform',matrix:Object.values(annotationTransform(a))},{kind:'solid',args:[40,60,120,40]}]);
});

test('background variants invalidate frame cache and persist with editable transforms',()=>{
  const d={...doc(),appearance:{background:'blue',padding:40,radius:12,variant:1},annotations:[flipAnnotation(rotateAnnotation(label),'horizontal')]};
  const history=new History(d),copy=cloneDocument(d);copy.appearance.variant=0xffffffff;history.push(copy);
  assert.equal(history.undo().appearance.variant,1);assert.equal(history.redo().appearance.variant,0xffffffff);
  assert.deepEqual(parseDocument(serializeDocument(copy)),copy);
  const factory=surfaceFactory(),canvas=factory.create(),image={};canvas.width=880;canvas.height=680;
  renderDocument(canvas.context,d,image,{pixelRatio:1});const frame=factory.surfaces[2],drawCount=()=>frame.context.calls.filter(c=>c.kind==='image'&&c.source===image).length;
  assert.equal(drawCount(),1);renderDocument(canvas.context,d,image,{pixelRatio:1});assert.equal(drawCount(),1);
  d.appearance.variant=2;renderDocument(canvas.context,d,image,{pixelRatio:1});assert.equal(drawCount(),2);
  for(const variant of [-1,0x100000000,1.5,'1',NaN])assert.throws(()=>serializeDocument({...d,appearance:{...d.appearance,variant}}));
  for(const change of [{rotation:NaN},{rotation:Infinity},{rotation:-1},{rotation:360},{rotation:'45'},{flipX:1},{flipY:'true'}])assert.throws(()=>serializeDocument({...d,annotations:[{...label,...change}]}));
  assert.doesNotThrow(()=>serializeDocument({...d,annotations:[{...arrow,rotation:31.25}]}));
});

test('free rotation preserves local geometry and a stable center across every annotation type',()=>{
  const rectangle={id:'r',type:'rectangle',x:100,y:150,w:120,h:60,width:4,color:'#c94632'};
  const pen={id:'p',type:'pen',points:[{x:20,y:30},{x:90,y:40},{x:65,y:110}],width:4,color:'#c94632'};
  const sources=[label,numbered,rectangle,{...rectangle,type:'ellipse'},{...rectangle,type:'redact',style:'solid'},pen,{...pen,type:'highlighter'},
    ...['line','pointer','curved','tapered','direction'].map(style=>({...arrow,style}))];
  for(const source of sources) {
    const snapshot=structuredClone(source),local=selectionFrame(source).bounds;
    const center={x:local.x+local.w/2,y:local.y+local.h/2};
    for(const angle of [17.5,45,89.9,213,359]) {
      const rotated=rotateAnnotation(source,angle),frame=selectionFrame(rotated),bounds=selectionBounds(rotated);
      assert.deepEqual(frame.bounds,local);
      almost(bounds.x+bounds.w/2,center.x);almost(bounds.y+bounds.h/2,center.y);
      assert.deepEqual(frame.matrix,annotationTransform(rotated));
      const inside=source.points?.[0]||{x:source.x+(source.w||0)/2,y:source.y+(source.h||0)/2};
      const shown=annotationPoint(rotated,inside),recovered=annotationPoint(rotated,shown,true);
      almost(recovered.x,inside.x);almost(recovered.y,inside.y);
      assert.equal(hitTest(rotated,shown,1),true,source.type);
      assert.equal(hitTest(rotated,annotationPoint(rotated,{x:local.x-100,y:local.y-100}),0),false,source.type);
      const context=drawingContext();renderAnnotation(context,rotated);
      assert.deepEqual(context.calls[0],{kind:'transform',matrix:Object.values(frame.matrix)});
      assert.deepEqual(rotateAnnotation(rotated,-angle),source);
      const moved=translateAnnotation(rotated,25,-19),after=annotationPoint(moved,{x:inside.x+25,y:inside.y-19});
      almost(after.x,shown.x+25);almost(after.y,shown.y-19);
    }
    let fullTurn=source;
    for(let i=0;i<100;i++)fullTurn=rotateAnnotation(fullTurn,3.6);
    assert.deepEqual(fullTurn,source);
    assert.deepEqual(source,snapshot);
  }
  for(const invalid of [NaN,Infinity,-Infinity,'30',null])assert.throws(()=>rotateAnnotation(label,invalid));
});

test('free-rotated arrow endpoints resize in world coordinates without shifting the other endpoint or curve',()=>{
  for(const angle of [31,90,217.25])for(const axis of ['horizontal','vertical'])for(const id of ['start','end']) {
    const original=flipAnnotation(rotateAnnotation({...arrow,style:'curved',control:{x:50,y:5}},angle),axis);
    const handles=selectionHandles(original),other=handles.find(h=>h.id!==id),handle=handles.find(h=>h.id===id);
    const target={x:handle.x+50,y:handle.y-20},control=annotationPoint(original,curveControl(original));
    const next=resizeAnnotation(original,id,target),updated=selectionHandles(next),newOther=updated.find(h=>h.id!==id),newHandle=updated.find(h=>h.id===id);
    almost(newOther.x,other.x);almost(newOther.y,other.y);almost(newHandle.x,target.x);almost(newHandle.y,target.y);
    const nextControl=annotationPoint(next,curveControl(next));almost(nextControl.x,control.x);almost(nextControl.y,control.y);
    assert.doesNotThrow(()=>serializeDocument({...doc(),annotations:[next]}));
  }
});

test('rotated blur and pixelation clip the world polygon and sample fresh unrotated source pixels with crop offsets',()=>{
  for(const style of ['blur','pixelate'])for(const angle of [33,90,223.5]) {
    const original={id:'cover',type:'redact',style,intensity:12,x:140,y:110,w:120,h:40,width:4,color:'#c94632'};
    const a=flipAnnotation(rotateAnnotation(original,angle),'horizontal');
    const factory=surfaceFactory(),canvas=factory.create(),ctx=canvas.context;canvas.width=400;canvas.height=300;
    ctx.translate(17,-23);ctx.calls.push({kind:'existing-annotation'});renderAnnotation(ctx,a);
    assert.equal(ctx.calls.some(c=>c.kind==='transform'),false,'only the mask rotates, not the pixel sample');
    const polygon=ctx.calls.find(c=>c.kind==='clip').path;
    const expected=[[a.x,a.y],[a.x+a.w,a.y],[a.x+a.w,a.y+a.h],[a.x,a.y+a.h]].map(([x,y])=>annotationPoint(a,{x,y}));
    assert.deepEqual(polygon,[...expected.map((p,i)=>[i?'line':'move',p.x,p.y]),['close']]);
    const bounds=annotationBounds(a),margin=style==='blur'?36:0;
    const left=Math.max(0,Math.floor(bounds.x+17)-margin),top=Math.max(0,Math.floor(bounds.y-23)-margin);
    const right=Math.min(400,Math.ceil(bounds.x+bounds.w+17)+margin),bottom=Math.min(300,Math.ceil(bounds.y+bounds.h-23)+margin);
    const copy=factory.surfaces[1].context.calls.find(c=>c.kind==='image');
    assert.equal(copy.source,canvas);assert.deepEqual(copy.args,[left,top,right-left,bottom-top,0,0,right-left,bottom-top]);
    assert.ok(copy.prior.some(c=>c.kind==='existing-annotation'));
    const result=ctx.calls.findLast(c=>c.kind==='image');
    assert.deepEqual(result.transform,{e:17,f:-23});assert.equal(result.composite,'copy');
  }
});

test('free-rotated state survives independent undo and pin round trips alongside legacy quarter-turn documents',()=>{
  const legacy={...doc(),annotations:[{...label,rotation:90,flipX:true},{id:'r',type:'redact',style:'blur',x:80,y:20,w:40,h:120,width:4,color:'#171717'},arrow]};
  assert.deepEqual(parseDocument(serializeDocument(legacy)),legacy);
  const history=new History(legacy),next=cloneDocument(legacy);
  next.annotations=next.annotations.map(a=>rotateAnnotation(a,37.125));history.push(next);
  const restored=parseDocument(serializeDocument(next));
  assert.deepEqual(restored,next);assert.deepEqual(history.undo(),legacy);assert.deepEqual(history.redo(),restored);
  next.annotations[2].points[0].x=999;
  assert.equal(restored.annotations[2].points[0].x,20);
  assert.deepEqual(history.undo(),legacy);
});

test('downscaled preview preserves logical source coordinates and cannot reduce exported resolution',()=>{
  const factory=surfaceFactory(),canvas=factory.create(),image={};canvas.width=432;canvas.height=332;
  const d={...doc(),appearance:{background:'white',padding:32,radius:16},annotations:[{id:'label',type:'text',x:80,y:40,text:'source precision',fontSize:28,color:'#171717',width:4}]};
  renderDocument(canvas.context,d,image,{pixelRatio:.5});
  const frame=factory.surfaces[1],baseFrame=factory.surfaces[2];
  assert.deepEqual([frame.width,frame.height,baseFrame.width,baseFrame.height],[432,332,432,332]);
  const sourceDraw=baseFrame.context.calls.find(c=>c.kind==='image'&&c.source===image);
  assert.deepEqual(sourceDraw.args,[0,0,800,600]);assert.deepEqual(sourceDraw.transform,{a:.5,d:.5,e:16,f:16});
  const label=frame.context.calls.find(c=>c.kind==='text');assert.deepEqual([label.x,label.y],[80,40]);assert.ok(label.font.includes('28px'));
  const exported=factory.create();exported.width=864;exported.height=664;renderDocument(exported.context,d,image);
  const fullDraw=exported.context.calls.find(c=>c.kind==='image'&&c.source===image);
  assert.deepEqual(fullDraw.args,[0,0,800,600]);assert.deepEqual(fullDraw.transform,{e:32,f:32});
  assert.deepEqual([exported.width,exported.height],[864,664]);
  const oldCalls=frame.context.calls.length;renderDocument(canvas.context,d,image,{pixelRatio:.5});
  assert.equal(frame.context.calls.length,oldCalls,'export must not invalidate or resize preview surfaces');
  assert.deepEqual([frame.width,frame.height],[432,332]);
});

test('downscaled blur samples physical pixels and composites into the matching logical area',()=>{
  const factory=surfaceFactory(),canvas=factory.create(),ctx=canvas.context;canvas.width=200;canvas.height=150;
  ctx.scale(.5,.5);ctx.translate(20,10);
  const annotation=rotateAnnotation({id:'cover',type:'redact',style:'blur',intensity:12,x:100,y:80,w:120,h:40,width:4,color:'#171717'},33);
  renderAnnotation(ctx,annotation);
  const bounds=annotationBounds(annotation),margin=18;
  const left=Math.max(0,Math.floor(bounds.x*.5+10)-margin),top=Math.max(0,Math.floor(bounds.y*.5+5)-margin);
  const right=Math.min(200,Math.ceil((bounds.x+bounds.w)*.5+10)+margin),bottom=Math.min(150,Math.ceil((bounds.y+bounds.h)*.5+5)+margin);
  const copy=factory.surfaces[1].context.calls.find(c=>c.kind==='image');
  assert.equal(copy.source,canvas);assert.deepEqual(copy.args,[left,top,right-left,bottom-top,0,0,right-left,bottom-top]);
  assert.ok(factory.surfaces.some(s=>s.context.calls.some(c=>c.filter==='blur(6px)')));
  const result=ctx.calls.findLast(c=>c.kind==='image');
  assert.deepEqual(result.args,[0,0,right-left,bottom-top,(left-10)*2,(top-5)*2,(right-left)*2,(bottom-top)*2]);
  assert.equal(result.composite,'copy');assert.deepEqual(result.transform,{a:.5,d:.5,e:10,f:5});
});
