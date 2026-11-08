import type {Point, ScreenRect} from './types.ts';
interface WindowGesture {edge: string; start: Point; dx: number; dy: number; changed: boolean; ended: boolean; bounds: ScreenRect | null}
interface WindowGestureOptions {getBounds: () => Promise<ScreenRect>; transform: (bounds: ScreenRect, edge: string, dx: number, dy: number) => Promise<unknown>; onError?: (error: unknown) => void; onState?: (active: boolean) => void; requestFrame?: (callback: FrameRequestCallback) => number; cancelFrame?: (id: number) => void}
// Window gestures use global points and one native request at a time.
export function createQuickWindowGesture({getBounds,transform,onError=()=>{},onState=()=>{},requestFrame=callback=>requestAnimationFrame(callback),cancelFrame=id=>cancelAnimationFrame(id)}: WindowGestureOptions) {
 let gesture: WindowGesture | null=null,frame: number | null=null,inFlight=false;
 const finish=(current: WindowGesture)=>{if(gesture!==current)return;gesture=null;if(frame!==null)cancelFrame(frame);frame=null;onState(false);};
 const schedule=()=>{if(frame===null)frame=requestFrame(()=>{frame=null;void flush();});};
 async function flush(){
  const current=gesture;if(!current||!current.bounds||inFlight)return;
  if(!current.changed){if(current.ended)finish(current);return;}
  const {dx,dy}=current;current.changed=false;inFlight=true;
  try{await transform(current.bounds,current.edge,dx,dy);}
  catch(error){if(gesture===current){onError(error);finish(current);}}
  finally{inFlight=false;if(gesture===current){if(current.changed)schedule();else if(current.ended)finish(current);}}
 }
 function update(point: Point){
  const current=gesture;if(!current||current.ended||!Number.isFinite(point.x)||!Number.isFinite(point.y))return;
  const dx=point.x-current.start.x,dy=point.y-current.start.y;
  if(dx!==current.dx||dy!==current.dy){current.dx=dx;current.dy=dy;current.changed=true;schedule();}
 }
 return {
  begin(edge: string,point: Point){
   if(gesture||inFlight)return false;
   const current: WindowGesture={edge,start:point,dx:0,dy:0,changed:false,ended:false,bounds:null};gesture=current;onState(true);
   Promise.resolve().then(getBounds).then(bounds=>{if(gesture===current){current.bounds=bounds;schedule();}}).catch(error=>{if(gesture===current){onError(error);finish(current);}});
   return true;
  },
  update,
  end(point: Point){if(!gesture)return;update(point);gesture.ended=true;schedule();},
  cancel(){if(gesture)finish(gesture);},
  get active(){return !!gesture;},
 };
}
