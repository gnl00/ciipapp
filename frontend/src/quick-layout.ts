import type {Size, ScreenRect, FrameLayout} from './types.ts';
type QuickLayout = Pick<FrameLayout, 'width' | 'height' | 'offsetX' | 'offsetY'> & {crop: {x: number; y: number}};
export function quickCanvasRect(placement: {image: ScreenRect},image: Size,layout: QuickLayout,scale: number) {
 const baseLeft=placement.image.x+(placement.image.width-image.width*scale)/2;
 const baseTop=placement.image.y+(placement.image.height-image.height*scale)/2;
 return {x:baseLeft+(layout.crop.x-layout.offsetX)*scale,y:baseTop+(layout.crop.y-layout.offsetY)*scale,width:layout.width*scale,height:layout.height*scale};
}

export function fitQuickImage(image: Size,viewport: Size,layout: QuickLayout={crop:{x:0,y:0},offsetX:0,offsetY:0,width:image.width,height:image.height}) {
 const availableWidth=Math.max(1,viewport.width-24),availableHeight=Math.max(1,viewport.height-140);
 const scale=Math.min(1,availableWidth/layout.width,availableHeight/layout.height);
 return {scale,image:{
  x:(viewport.width-layout.width*scale)/2+(layout.offsetX-layout.crop.x)*scale,
  y:28+(availableHeight-layout.height*scale)/2+(layout.offsetY-layout.crop.y)*scale,
  width:image.width*scale,height:image.height*scale,
 }};
}
