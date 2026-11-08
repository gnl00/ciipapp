export type DemoPhase='ready'|'captured'|'pinned';
export type DemoAction='capture'|'annotate'|'pin'|'close'|'reset'|'smaller'|'larger';
export interface DemoState {phase:DemoPhase;annotated:boolean;scale:number}
export const initialDemoState:DemoState={phase:'ready',annotated:false,scale:1};
export function updateDemo(state:DemoState,action:DemoAction):DemoState {
  switch(action){
    case 'capture':return {phase:'captured',annotated:false,scale:1};
    case 'annotate':return state.phase==='ready'?state:{...state,annotated:!state.annotated};
    case 'pin':return state.phase==='ready'?state:{...state,phase:'pinned'};
    case 'close':case 'reset':return {...initialDemoState};
    case 'smaller':return state.phase!=='pinned'?state:{...state,scale:Math.max(.75,state.scale-.125)};
    case 'larger':return state.phase!=='pinned'?state:{...state,scale:Math.min(1.125,state.scale+.125)};
  }
}
export function demoStatus(state:DemoState):string {
  if(state.phase==='ready')return '先截取这一小块风景。';
  if(state.phase==='pinned')return '贴在手边了。可以缩放，也可以双击图片关闭。';
  return state.annotated?'重点标好了，接着把它贴在手边。':'截图后会自动复制。也可以先加一个标注。';
}
