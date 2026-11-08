import test from 'node:test';
import assert from 'node:assert/strict';
import {beginRotation,updateRotation} from '../src/rotation.ts';

const center={x:140,y:85};
const at=(degrees,r=100)=>({x:center.x+Math.cos(degrees*Math.PI/180)*r,y:center.y+Math.sin(degrees*Math.PI/180)*r});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} ≠ ${expected}`);

test('rotation follows arbitrary screen-clockwise angles without changing its inputs',()=>{
  const origin=Object.freeze({...center}),pointer=Object.freeze(at(-90));
  const start=Object.freeze(beginRotation(origin,pointer));Object.freeze(start.center);
  const turned=updateRotation(start,at(-45));
  close(turned.delta,45);close(turned.angle,45);
  const precise=updateRotation(turned,at(-12.375));
  close(precise.delta,77.625);close(precise.rawDelta,77.625);
  assert.equal(start.delta,0);assert.equal(start.lastAngle,-90);
  assert.notEqual(turned,start);assert.notEqual(start.center,origin);
});

test('crossing the ±180 boundary accumulates full turns in either direction',()=>{
  let clockwise=beginRotation(center,at(170));
  for(const angle of [179,-179,-130,-40,50,140,170])clockwise=updateRotation(clockwise,at(angle));
  close(clockwise.delta,360);
  for(const angle of [-100,-10,80,170])clockwise=updateRotation(clockwise,at(angle));
  close(clockwise.delta,720);
  let counter=beginRotation(center,at(-170));
  for(const angle of [-179,179,130,40,-50,-140,-170])counter=updateRotation(counter,at(angle));
  close(counter.delta,-360);
});

test('stationary pointers and central dead-zone crossings cannot jump the angle',()=>{
  const start=beginRotation(center,at(0),{initialAngle:23});
  const still=updateRotation(start,at(0));
  close(still.delta,0);close(still.angle,23);
  const moved=updateRotation(still,at(40));
  const inside=updateRotation(moved,at(-135,2));
  close(inside.delta,40);assert.equal(inside.lastAngle,null);
  const boundary=updateRotation(inside,{x:center.x+6,y:center.y});
  close(boundary.delta,40);assert.equal(boundary.lastAngle,null);
  const outside=updateRotation(boundary,at(-140));
  close(outside.delta,40);
  close(updateRotation(outside,at(-120)).delta,60);
  const centralStart=beginRotation(center,center);
  assert.equal(centralStart.lastAngle,null);
  close(updateRotation(centralStart,at(150)).delta,0);
});

test('custom dead zone and exact center remain stable at any coordinate scale',()=>{
  const start=beginRotation(center,at(0),{minRadius:.25});
  assert.equal(updateRotation(start,at(90,.1)).lastAngle,null);
  close(updateRotation(start,at(90,.5)).delta,90);
  assert.equal(beginRotation(center,center,{minRadius:0}).lastAngle,null);
});

test('direction reversal retraces the gesture without losing accumulated turns',()=>{
  let state=beginRotation(center,at(10));
  for(const angle of [100,-170,-80,10])state=updateRotation(state,at(angle));
  close(state.delta,360);
  for(const angle of [-80,-170,100,10])state=updateRotation(state,at(angle));
  close(state.delta,0);
  state=updateRotation(state,at(-20));close(state.delta,-30);
});

test('Shift snaps the absolute element angle while preserving unsnapped movement',()=>{
  const start=beginRotation(center,at(-90),{initialAngle:7});
  let state=updateRotation(start,at(-79),{snap:true});
  close(state.rawDelta,11);close(state.angle,15);close(state.delta,8);
  state=updateRotation(state,at(-79),{snap:false});
  close(state.rawDelta,11);close(state.angle,18);close(state.delta,11);
  for(let i=0;i<40;i++)state=updateRotation(state,at(-79),{snap:i%2===0});
  close(state.rawDelta,11);close(state.delta,11);
  state=updateRotation(state,at(-66),{snap:true});
  close(state.rawDelta,24);close(state.angle,30);close(state.delta,23);
  state=updateRotation(state,at(-90),{snap:true});
  close(state.rawDelta,0);close(state.angle,0);close(state.delta,-7);
  state=updateRotation(state,at(-90),{snap:false});
  close(state.delta,0);close(state.angle,7);
});

test('absolute snapping works across zero and after multiple turns',()=>{
  let state=beginRotation(center,at(170),{initialAngle:-8});
  state=updateRotation(state,at(-170),{snap:true});
  close(state.rawDelta,20);close(state.angle,15);close(state.delta,23);
  for(const angle of [-80,10,100,170])state=updateRotation(state,at(angle),{snap:true});
  close(state.rawDelta,360);close(state.angle,345);close(state.delta,353);
  state=updateRotation(state,at(170));close(state.angle,352);close(state.delta,360);
});

test('invalid pointers, state, or settings fail before producing an invalid angle',()=>{
  const start=beginRotation(center,at(0));
  for(const invalid of [null,{}, {x:0,y:NaN},{x:Infinity,y:2},{x:'2',y:3}]) {
    assert.throws(()=>beginRotation(invalid,at(0)),TypeError);
    assert.throws(()=>beginRotation(center,invalid),TypeError);
    assert.throws(()=>updateRotation(start,invalid),TypeError);
  }
  for(const initialAngle of [NaN,Infinity,'45'])assert.throws(()=>beginRotation(center,at(0),{initialAngle}),TypeError);
  for(const minRadius of [NaN,Infinity,'6'])assert.throws(()=>beginRotation(center,at(0),{minRadius}),TypeError);
  assert.throws(()=>beginRotation(center,at(0),{minRadius:-1}),RangeError);
  assert.throws(()=>updateRotation(null,at(0)),TypeError);
  assert.throws(()=>updateRotation({...start,rawDelta:NaN},at(0)),TypeError);
  assert.throws(()=>updateRotation({...start,lastAngle:Infinity},at(0)),TypeError);
  assert.throws(()=>updateRotation(start,at(0),{snap:'true'}),TypeError);
  assert.equal(start.delta,0);
});
