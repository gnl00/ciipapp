import test from 'node:test';
import assert from 'node:assert/strict';
import {fitQuickImage,quickCanvasRect} from '../src/quick-layout.ts';

test('compact layout reserves only the screenshot rim and a separate toolbar dock',()=>{
 const image={width:1280,height:720},viewport={width:664,height:500};
 const placement=fitQuickImage(image,viewport);
 assert.equal(placement.scale,.5);
 assert.deepEqual(placement.image,{x:12,y:28,width:640,height:360});
});

test('resizing a quick window scales the view without modifying source pixels',()=>{
 const image={width:1280,height:720};
 const small=fitQuickImage(image,{width:344,height:320});
 const large=fitQuickImage(image,{width:984,height:680});
 assert.equal(small.scale,.25);assert.equal(large.scale,.75);
 assert.deepEqual(image,{width:1280,height:720});
 assert.equal(small.image.width/small.image.height,large.image.width/large.image.height);
});

test('background and crop stay in the image area, clear of the toolbar',()=>{
 const image={width:6000,height:4000},viewport={width:664,height:500};
 const layout={crop:{x:2500,y:1500},offsetX:120,offsetY:120,width:1240,height:940};
 const placement=fitQuickImage(image,viewport,layout);
 const rect=quickCanvasRect(placement,image,layout,placement.scale);
 assert.ok(rect.x>=12&&rect.y>=28&&rect.x+rect.width<=652&&rect.y+rect.height<=388+1e-9);
 assert.ok(Math.abs(rect.height-360)<1e-9);
 assert.ok(Math.abs(placement.image.x+(layout.crop.x-layout.offsetX)*placement.scale-rect.x)<1e-9);
});

test('tiny and portrait windows keep a positive proportional canvas',()=>{
 for(const viewport of [{width:320,height:240},{width:400,height:800}]){
  const image={width:200,height:3000},fit=fitQuickImage(image,viewport);
  assert.ok(fit.scale>0&&fit.scale<=1);
  assert.ok(fit.image.x>=12&&fit.image.y>=28);
  assert.ok(fit.image.x+fit.image.width<=viewport.width-12+1e-9);
  assert.ok(fit.image.y+fit.image.height<=viewport.height-112+1e-9);
 }
});
