// Input state updates immediately; only drawing waits for the next display frame.
export function createRenderScheduler(draw: () => void, requestFrame: (callback: FrameRequestCallback) => number=requestAnimationFrame, cancelFrame: (id: number) => void=cancelAnimationFrame) {
  let frame: number | null=null;
  return {
    request() {
      if(frame!==null)return;
      frame=requestFrame(()=>{frame=null;draw();});
    },
    cancel() {
      if(frame===null)return;
      cancelFrame(frame);frame=null;
    },
    get pending(){return frame!==null;},
  };
}

export function previewPixelRatio(scale: number, devicePixelRatio=1) {
  if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(devicePixelRatio)||devicePixelRatio<=0)throw new Error('预览比例无效');
  return Math.min(1,scale*Math.min(2,devicePixelRatio));
}
