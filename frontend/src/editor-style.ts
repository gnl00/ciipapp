import type {ArrowStyle,NumberStyle,RedactStyle} from './types.ts';

export interface EditorStyle {
 color:string;highlightColor:string;stroke:number;penStroke:number;highlightStroke:number;
 arrowStyle:ArrowStyle;numberStyle:NumberStyle;numberRadius:number;
 redactStyle:RedactStyle;redactStrength:number;textSize:number;
}
export const defaultEditorStyle:Readonly<EditorStyle>={color:'#c94632',highlightColor:'#e6a32b',stroke:4,penStroke:4,highlightStroke:20,arrowStyle:'line',numberStyle:'filled',numberRadius:16,redactStyle:'blur',redactStrength:12,textSize:24};
const number=(value:unknown,min:number,max:number,fallback:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:fallback;
const option=<T extends string>(value:unknown,values:readonly T[],fallback:T):T=>values.includes(value as T)?value as T:fallback;
export function normalizeEditorStyle(value:unknown):EditorStyle {
 const p=value&&typeof value==='object'?value as Partial<EditorStyle>:{},d=defaultEditorStyle;
 return {
  color:typeof p.color==='string'&&/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(p.color)?p.color:d.color,
  highlightColor:typeof p.highlightColor==='string'&&/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(p.highlightColor)?p.highlightColor:d.highlightColor,
  stroke:number(p.stroke,.5,200,d.stroke),penStroke:number(p.penStroke,.5,200,d.penStroke),highlightStroke:number(p.highlightStroke,.5,200,d.highlightStroke),
  arrowStyle:option(p.arrowStyle,['line','pointer','curved','tapered','direction'],d.arrowStyle),numberStyle:option(p.numberStyle,['filled','outline'],d.numberStyle),numberRadius:number(p.numberRadius,12,160,d.numberRadius),
  redactStyle:option(p.redactStyle,['blur','pixelate','solid'],d.redactStyle),redactStrength:number(p.redactStrength,4,40,d.redactStrength),textSize:number(p.textSize,8,512,d.textSize),
 };
}

export function createEditorStyleStore({read,write,onError}:{read:()=>Promise<unknown>;write:(patch:Partial<EditorStyle>)=>Promise<unknown>;onError:(error:unknown)=>void}) {
 let current=normalizeEditorStyle(null),pending:Partial<EditorStyle>={},queue=Promise.resolve(),revision=0,readRequest=0,lastError:unknown;
 function save() {
  queue=queue.then(async()=>{
   if(!Object.keys(pending).length)return;
   const patch={...pending},ticket=revision;
   try {
    const saved=normalizeEditorStyle(await write(patch));
    for(const key of Object.keys(patch) as (keyof EditorStyle)[])if(pending[key]===patch[key])delete pending[key];
    if(ticket===revision)current=saved;
    lastError=undefined;
   }catch(error){lastError=error;onError(error);}
  });
 }
 async function drain(){let tail;do{tail=queue;await tail;}while(tail!==queue);}
 async function flush(){await drain();if(Object.keys(pending).length){save();await drain();if(Object.keys(pending).length)throw lastError;}}
 return {
  snapshot:()=>({...current}),
  update(patch:Partial<EditorStyle>) {
   const next=normalizeEditorStyle({...current,...patch});
   for(const key of Object.keys(patch) as (keyof EditorStyle)[])if(!Object.prototype.hasOwnProperty.call(defaultEditorStyle,key)||next[key]!==patch[key])throw Error('工具样式无效');
   revision++;current=next;pending={...pending,...patch};save();
  },
  async refresh() {
   await flush();const ticket=revision,request=++readRequest;
   try {const saved=await read();if(ticket===revision&&request===readRequest)current=normalizeEditorStyle(saved);}
   catch(error){onError(error);}
   return {...current};
  },
  flush,
 };
}
