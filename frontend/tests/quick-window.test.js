import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuickWindowGesture} from '../src/quick-window.ts';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){let key=0;const tasks=new Map();return {request:fn=>{tasks.set(++key,fn);return key;},cancel:id=>tasks.delete(id),frame(){const callbacks=[...tasks.values()];tasks.clear();callbacks.forEach(fn=>fn());}};}
const bounds={x:100,y:80,width:664,height:500};

test('quick window transforms coalesce global deltas and keep a single native call in flight',async()=>{
 const frames=clock(),calls=[],states=[];let release;
 const control=createQuickWindowGesture({getBounds:async()=>bounds,transform:async(...args)=>{calls.push(args);await new Promise(resolve=>{release=resolve;});},onState:value=>states.push(value),requestFrame:frames.request,cancelFrame:frames.cancel});
 assert.equal(control.begin('move',{x:200,y:100}),true);await tick();
 for(let x=201;x<=240;x++)control.update({x,y:120});
 frames.frame();assert.equal(calls.length,1);assert.deepEqual(calls[0],[bounds,'move',40,20]);
 control.update({x:300,y:180});control.end({x:320,y:190});frames.frame();assert.equal(calls.length,1);
 release();await tick();frames.frame();assert.equal(calls.length,2);assert.deepEqual(calls[1],[bounds,'move',120,90]);
 release();await tick();assert.equal(control.active,false);assert.deepEqual(states,[true,false]);
});

test('a resize ending before bounds arrive still commits the final endpoint',async()=>{
 const frames=clock(),calls=[];let resolveBounds;
 const control=createQuickWindowGesture({getBounds:()=>new Promise(resolve=>{resolveBounds=resolve;}),transform:async(...args)=>calls.push(args),requestFrame:frames.request,cancelFrame:frames.cancel});
 control.begin('se',{x:300,y:400});control.end({x:420,y:470});frames.frame();await tick();
 resolveBounds(bounds);await tick();frames.frame();await tick();
 assert.deepEqual(calls,[[bounds,'se',120,70]]);assert.equal(control.active,false);
});

test('cancelling drops pending input and late errors without moving a replacement window',async()=>{
 const frames=clock(),calls=[],errors=[];let reject;
 const control=createQuickWindowGesture({getBounds:async()=>bounds,transform:async(...args)=>{calls.push(args);await new Promise((resolve,fail)=>{reject=fail;});},onError:error=>errors.push(error),requestFrame:frames.request,cancelFrame:frames.cancel});
 control.begin('e',{x:100,y:100});await tick();control.update({x:150,y:100});frames.frame();
 control.update({x:190,y:100});control.cancel();reject(Error('window closed'));await tick();frames.frame();
 assert.equal(calls.length,1);assert.equal(errors.length,0);assert.equal(control.active,false);
});

test('clicking without movement does not transform the window and failures release the gesture',async()=>{
 const frames=clock(),calls=[],errors=[];
 const control=createQuickWindowGesture({getBounds:async()=>bounds,transform:async(...args)=>{calls.push(args);throw Error('resize failed');},onError:error=>errors.push(error),requestFrame:frames.request,cancelFrame:frames.cancel});
 control.begin('move',{x:100,y:100});control.end({x:100,y:100});await tick();frames.frame();assert.equal(calls.length,0);assert.equal(control.active,false);
 control.begin('nw',{x:100,y:100});control.end({x:90,y:90});await tick();frames.frame();await tick();assert.equal(errors.length,1);assert.equal(control.active,false);
});
