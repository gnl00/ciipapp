import test from 'node:test';
import assert from 'node:assert/strict';

import {createPinZoomController} from '../src/pin-zoom.ts';
const scope={createPinZoomController};
function rig(){
 const frames=new Map(),timers=new Map(),calls=[],delays=[];let next=0;
 const zoom=scope.createPinZoomController({resize:async factor=>calls.push(factor),
  requestFrame:fn=>{frames.set(++next,fn);return next;},cancelFrame:id=>frames.delete(id),
  setTimer:(fn,delay)=>{delays.push(delay);timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)});
 const run=async tasks=>{const pending=[...tasks.values()];tasks.clear();pending.forEach(fn=>fn());await Promise.resolve();await Promise.resolve();};
 return {zoom,calls,frames,timers,delays,frame:()=>run(frames),deadline:()=>run(timers)};
}
const event=scale=>({scale,preventDefault(){}});
const total=calls=>calls.reduce((result,factor)=>result*factor,1);

test('native pinch uses cumulative gesture scale as incremental window zoom',async()=>{
 const r=rig();r.zoom.gestureStart(event(1));r.zoom.gestureChange(event(1.2));await r.frame();
 r.zoom.gestureChange(event(1.4));r.zoom.gestureEnd(event(1.4));await r.frame();
 assert.ok(Math.abs(total(r.calls)-1.4)<1e-12);
 r.zoom.gestureStart(event(1));r.zoom.gestureChange(event(.8));r.zoom.gestureEnd(event(.8));await r.frame();
 assert.ok(Math.abs(total(r.calls)-1.12)<1e-12);
});

test('pinch state belongs to its pin and zero or malformed scales never resize',async()=>{
 const first=rig(),second=rig();
 first.zoom.gestureStart(event(1));first.zoom.gestureChange(event(1.3));
 second.zoom.gestureStart(event(1));second.zoom.gestureChange(event(.7));
 for(const scale of [NaN,Infinity,0,-1])first.zoom.gestureChange(event(scale));
 await first.frame();await second.frame();
 assert.ok(Math.abs(total(first.calls)-1.3)<1e-12);assert.ok(Math.abs(total(second.calls)-.7)<1e-12);
 first.zoom.destroy();first.zoom.gestureChange(event(2));await first.frame();
 assert.equal(first.calls.length,1);
});

test('a suspended animation frame cannot strand wheel input in a pin',async()=>{
 const r=rig();r.zoom.wheel({deltaY:20,deltaMode:0,preventDefault(){}});
 assert.equal(r.frames.size,1);
 assert.ok(r.delays.length===1&&r.delays[0]>0&&r.delays[0]<=64);
 await r.deadline();
 assert.equal(r.calls.length,1);assert.ok(r.calls[0]<1);
 await r.frame();assert.equal(r.calls.length,1,'a resumed frame must not replay the same input');
 r.zoom.destroy();assert.equal(r.frames.size,0);assert.equal(r.timers.size,0);
});

test('late frames cannot flush a newer input twice after the deadline won',async()=>{
 const r=rig();r.zoom.wheel({deltaY:20,deltaMode:0,preventDefault(){}});
 const staleFrame=[...r.frames.values()][0];await r.deadline();
 r.zoom.wheel({deltaY:-10,deltaMode:0,preventDefault(){}});staleFrame();
 assert.equal(r.calls.length,1);await r.frame();assert.equal(r.calls.length,2);
 assert.ok(Math.abs(total(r.calls)-Math.exp(-10*.0015))<1e-12);
});

test('a pinch is not counted again as wheel input and wheel zoom resumes at gesture end',async()=>{
 const r=rig();r.zoom.gestureStart(event(1));
 r.zoom.wheel({deltaY:-100,deltaMode:0,ctrlKey:true,preventDefault(){}});
 r.zoom.gestureChange(event(1.2));r.zoom.gestureEnd(event(1.2));await r.frame();
 assert.ok(Math.abs(total(r.calls)-1.2)<1e-12);
 r.zoom.wheel({deltaY:10,deltaMode:0,preventDefault(){}});await r.frame();
 assert.ok(Math.abs(total(r.calls)-1.2*Math.exp(-.015))<1e-12);
});

test('losing the pinch session releases wheel input without discarding completed zoom',async()=>{
 const r=rig();r.zoom.gestureStart(event(1));r.zoom.gestureChange(event(1.2));await r.frame();
 r.zoom.gestureCancel();r.zoom.wheel({deltaY:-10,deltaMode:0,ctrlKey:true,preventDefault(){}});await r.frame();
 assert.ok(Math.abs(total(r.calls)-1.2*Math.exp(.015))<1e-12);
});
