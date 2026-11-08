import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderScheduler,previewPixelRatio} from '../src/render-scheduler.ts';

function clock() {
  let id=0;const callbacks=new Map();
  return {request:fn=>{callbacks.set(++id,fn);return id;},cancel:key=>callbacks.delete(key),frame:()=>{const batch=[...callbacks.values()];callbacks.clear();batch.forEach(fn=>fn());},get pending(){return callbacks.size;}};
}

test('240 pointer updates draw 60 display frames while retaining every ink sample and final position',()=>{
  const frames=clock(),samples=[],painted=[];let position=0;
  const scheduler=createRenderScheduler(()=>painted.push({position,samples:[...samples]}),frames.request,frames.cancel);
  for(let i=1;i<=240;i++) {
    position=i;samples.push(i);scheduler.request();
    if(i%4===0)frames.frame();
  }
  assert.equal(painted.length,60);
  assert.equal(painted.at(-1).position,240);
  assert.deepEqual(painted.at(-1).samples,Array.from({length:240},(_,i)=>i+1));
  assert.equal(frames.pending,0);
});

test('ending before the next frame keeps the newest state for the commit and cancels the stale callback',()=>{
  const frames=clock(),drawn=[];let position=1;
  const scheduler=createRenderScheduler(()=>drawn.push(position),frames.request,frames.cancel);
  scheduler.request();position=9;scheduler.request();scheduler.cancel();drawn.push(position);
  assert.deepEqual(drawn,[9]);assert.equal(scheduler.pending,false);
  frames.frame();assert.deepEqual(drawn,[9]);
  position=12;scheduler.request();frames.frame();assert.deepEqual(drawn,[9,12]);
});

test('cancelled gestures cannot draw stale previews over the restored document or the next gesture',()=>{
  const frames=clock(),drawn=[];let position=5;
  const scheduler=createRenderScheduler(()=>drawn.push(position),frames.request,frames.cancel);
  scheduler.request();scheduler.cancel();position=0;frames.frame();assert.deepEqual(drawn,[]);
  position=8;scheduler.request();frames.frame();assert.deepEqual(drawn,[8]);
  scheduler.cancel();assert.equal(scheduler.pending,false);
});

test('preview pixels follow displayed size and Retina density without exceeding source resolution',()=>{
  assert.equal(previewPixelRatio(.2,2),.4);
  assert.equal(previewPixelRatio(.25,1),.25);
  assert.equal(previewPixelRatio(.5,4),1);
  assert.equal(previewPixelRatio(8,2),1);
  for(const args of [[0,1],[-1,2],[NaN,1],[1,0],[1,Infinity]])assert.throws(()=>previewPixelRatio(...args));
});
