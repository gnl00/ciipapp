import type {Point} from './types.ts';
export interface RotationState {center: Point; initialAngle: number; minRadius: number; lastAngle: number | null; rawDelta: number; delta: number; angle: number}
function finite(value: number,name: string) {
  if(!Number.isFinite(value))throw new TypeError(`${name} must be a finite number`);
  return value;
}
function point(value: Point,name: string) {
  if(!value)throw new TypeError(`${name} must be a point`);
  finite(value.x,`${name}.x`);finite(value.y,`${name}.y`);
}
function radius(value: number) {
  finite(value,'minRadius');
  if(value<0)throw new RangeError('minRadius must be non-negative');
}
function direction(center: Point,pointer: Point,minRadius: number) {
  point(pointer,'pointer');
  const dx=finite(pointer.x-center.x,'pointer offset x'),dy=finite(pointer.y-center.y,'pointer offset y');
  return Math.hypot(dx,dy)<=minRadius?null:Math.atan2(dy,dx)*180/Math.PI;
}

// Coordinates and minRadius share units; positive angles follow screen-clockwise motion.
export function beginRotation(center: Point,pointer: Point,{initialAngle=0,minRadius=6}={}): RotationState {
  point(center,'center');finite(initialAngle,'initialAngle');radius(minRadius);
  return {center:{x:center.x,y:center.y},initialAngle,minRadius,lastAngle:direction(center,pointer,minRadius),rawDelta:0,delta:0,angle:initialAngle};
}

export function updateRotation(state: RotationState,pointer: Point,{snap=false}={}): RotationState {
  if(!state)throw new TypeError('rotation state is required');
  point(state.center,'center');finite(state.initialAngle,'initialAngle');finite(state.rawDelta,'rawDelta');radius(state.minRadius);
  if(state.lastAngle!==null)finite(state.lastAngle,'lastAngle');
  if(typeof snap!=='boolean')throw new TypeError('snap must be a boolean');
  const lastAngle=direction(state.center,pointer,state.minRadius);
  let rawDelta=state.rawDelta;
  if(lastAngle!==null&&state.lastAngle!==null) {
    let change=lastAngle-state.lastAngle;
    // shortcut: samples must be less than half a turn apart to infer the direction.
    if(change>180)change-=360;
    if(change<-180)change+=360;
    rawDelta=finite(rawDelta+change,'rawDelta');
  }
  const unsnapped=finite(state.initialAngle+rawDelta,'angle');
  const angle=snap?Math.round(unsnapped/15)*15:unsnapped;
  // Leaving the central dead zone only re-anchors; it cannot add a sudden half turn.
  return {...state,lastAngle,rawDelta,angle,delta:angle-state.initialAngle};
}
