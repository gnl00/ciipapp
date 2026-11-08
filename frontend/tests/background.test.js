import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {backgroundPresets,drawBackground,randomBackgroundVariant} from '../src/effects.ts';

function context() {
  const calls=[],stack=[];
  const ownerDocument={createElement(){
    const canvas={width:0,height:0,getContext(){return{
      createImageData(w,h){return{width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},
      putImageData(pixels){canvas.pixels=pixels;},
    };}};return canvas;
  }};
  const state=['globalAlpha','globalCompositeOperation','fillStyle','imageSmoothingEnabled','imageSmoothingQuality'];
  const ctx={calls,canvas:{ownerDocument},globalAlpha:.4,globalCompositeOperation:'copy',fillStyle:'#123456',imageSmoothingEnabled:false,imageSmoothingQuality:'low',
    save(){stack.push(state.map(key=>this[key]));},
    restore(){const value=stack.pop();state.forEach((key,i)=>this[key]=value[i]);},
    createLinearGradient(...args){return{kind:'linear',args,stops:[],addColorStop(offset,color){this.stops.push([offset,color]);}};},
    createRadialGradient(...args){return{kind:'radial',args,stops:[],addColorStop(offset,color){this.stops.push([offset,color]);}};},
    drawImage(surface,...args){calls.push({kind:'drawImage',args,width:surface.width,height:surface.height,pixels:surface.pixels.data});},
  };
  for(const kind of ['beginPath','rect','clip','moveTo','quadraticCurveTo','bezierCurveTo','closePath','fill','fillRect'])ctx[kind]=(...args)=>calls.push({kind,args,color:typeof ctx.fillStyle==='string'?ctx.fillStyle:{kind:ctx.fillStyle.kind,args:ctx.fillStyle.args,stops:ctx.fillStyle.stops}});
  return ctx;
}
const hash=pixels=>createHash('sha256').update(pixels).digest('hex');

test('all legacy backgrounds remain selectable and invalid requests leave the canvas untouched',()=>{
  for(const id of ['none','mesh','warm','blue','sage','sunset','paper','white','charcoal'])assert.ok(backgroundPresets.some(p=>p.id===id));
  assert.equal(new Set(backgroundPresets.map(p=>p.id)).size,backgroundPresets.length);
  assert.equal(backgroundPresets.filter(p=>p.colors.length>1).length,15);
  const ctx=context();
  for(const [id,w,h] of [['none',120,72],['missing',120,72],['mesh',0,72],['mesh',120,Infinity],['mesh',NaN,72]])drawBackground(ctx,id,w,h);
  assert.deepEqual(ctx.calls,[]);
});

test('static textures repeat exactly, stay opaque and restore caller state across aspect ratios',()=>{
  for(const preset of backgroundPresets.filter(p=>p.colors.length>1))for(const [w,h] of [[120,72],[240,360],[600,180]]) {
    const a=context(),b=context();drawBackground(a,preset.id,w,h);drawBackground(b,preset.id,w,h);
    assert.deepEqual(a.calls,b.calls,preset.id);
    assert.deepEqual([a.globalAlpha,a.globalCompositeOperation,a.fillStyle,a.imageSmoothingEnabled,a.imageSmoothingQuality],[.4,'copy','#123456',false,'low']);
    const image=a.calls.find(c=>c.kind==='drawImage');
    if(image) {
      assert.deepEqual(image.args,[0,0,w,h]);
      for(let i=3;i<image.pixels.length;i+=4)assert.equal(image.pixels[i],255);
    }
    for(const call of a.calls)assert.ok(call.args.every(Number.isFinite));
  }
});

test('large exports bound texture work while shape boundaries remain vectors at full output size',()=>{
  for(const preset of backgroundPresets.filter(p=>p.colors.length>1)) {
    const ctx=context();drawBackground(ctx,preset.id,10000,6000);
    const image=ctx.calls.find(c=>c.kind==='drawImage');
    if(image) {
      assert.ok(image.width<=960 && image.height<=960);
      assert.equal(image.pixels.length,image.width*image.height*4);
      assert.deepEqual(image.args,[0,0,10000,6000]);
    } else {
      assert.ok(['sage','vivid'].includes(preset.id)||preset.id.startsWith('classic-'));
      assert.ok(ctx.calls.length<2500,'classic grain work stays bounded');
      const curves=ctx.calls.filter(c=>['quadraticCurveTo','bezierCurveTo'].includes(c.kind));
      if(preset.id!=='classic-mesh'){assert.ok(curves.length>=6);assert.ok(curves.some(c=>c.args.some(v=>v>6000)));}
    }
  }
});

test('artistic presets have distinct rendered compositions and neutral presets remain flat',()=>{
  const signatures=[];
  for(const preset of backgroundPresets.filter(p=>p.colors.length>1)) {
    const ctx=context();drawBackground(ctx,preset.id,120,72);
    const image=ctx.calls.find(c=>c.kind==='drawImage');
    signatures.push(image?hash(image.pixels):JSON.stringify(ctx.calls));
    if(image) {
      const pixels=image.pixels,values=new Set();
      for(let i=0;i<pixels.length;i+=4)values.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
      assert.ok(values.size>500,`${preset.id} needs a smooth tonal range`);
      if(preset.id==='mono') {
        let low=255,high=0;
        for(let i=0;i<pixels.length;i+=4){assert.ok(Math.max(...pixels.slice(i,i+3))-Math.min(...pixels.slice(i,i+3))<=10);low=Math.min(low,pixels[i]);high=Math.max(high,pixels[i]);}
        assert.ok(high-low>180,'monochrome must preserve light and dark areas');
      }
    }
  }
  assert.equal(new Set(signatures).size,15);
  for(const id of ['white','charcoal']) {
    const ctx=context();drawBackground(ctx,id,120,72);
    assert.deepEqual(ctx.calls.map(c=>c.kind),['fillRect']);
  }
});


test('seeded themes change every artistic palette while preserving repeatable composition and neutral choices',()=>{
  for(const preset of backgroundPresets.filter(p=>p.colors.length>1)) {
    const renders=[undefined,0,120,240].map(variant=>{const ctx=context();drawBackground(ctx,preset.id,120,72,variant);return ctx.calls;});
    const repeat=context();drawBackground(repeat,preset.id,120,72,120);
    assert.deepEqual(repeat.calls,renders[2],preset.id+' must retain its color on export and re-edit');
    assert.equal(new Set(renders.map(calls=>JSON.stringify(calls))).size,4,preset.id+' needs distinct red, green and blue themes');
    const geometry=calls=>calls.map(({kind,args})=>({kind,args}));
    for(const calls of renders.slice(1))assert.deepEqual(geometry(calls),geometry(renders[0]),'theme does not move shapes');
  }
  for(const id of ['none','white','charcoal']) {
    const a=context(),b=context();drawBackground(a,id,120,72);drawBackground(b,id,120,72,120);assert.deepEqual(a.calls,b.calls);
  }
});

test('random theme selection avoids repeating a nearby hue, even at the uint32 limit',()=>{
  for(const previous of [0,1,359,360,4294967295])for(let i=0;i<25;i++) {
    const variant=randomBackgroundVariant(previous),distance=Math.abs(variant%360-previous%360);
    assert.ok(Number.isInteger(variant)&&variant>=0&&variant<=4294967295);
    assert.ok(Math.min(distance,360-distance)>=45);
  }
});

test('six restored classic backgrounds retain their original names and base palettes',()=>{
  const originals=[['classic-mesh','虹雾','#b7bbeb'],['classic-warm','杏色沙丘','#f5d4ad'],['classic-blue','蓝色流体','#172f69'],['classic-sage','青绿折光','#275858'],['classic-sunset','暮色光束','#665c98'],['classic-paper','暖纸褶影','#f4eee0']];
  for(const [id,name,firstColor]of originals) {
    const preset=backgroundPresets.find(p=>p.id===id);assert.equal(preset.name,name);assert.equal(preset.colors[0],firstColor);
    const ctx=context();drawBackground(ctx,id,120,72);
    assert.equal(ctx.calls.find(c=>c.kind==='fillRect').color.stops[0][1],firstColor);
  }
});
