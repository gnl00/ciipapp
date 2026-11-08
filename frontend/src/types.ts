export interface Point { x: number; y: number }
export interface Rect extends Point { w: number; h: number }
export interface ScreenRect extends Point { width: number; height: number }
export interface Size { width: number; height: number }
export interface CaptureImage extends Size { dataURL: string; name: string }
export type ArrowStyle = 'line' | 'pointer' | 'curved' | 'tapered' | 'direction';
export type NumberStyle = 'filled' | 'outline';
export type RedactStyle = 'blur' | 'pixelate' | 'solid';
export interface AnnotationBase { id: string; color: string; width: number; rotation?: number; flipX?: boolean; flipY?: boolean }
export interface ArrowAnnotation extends AnnotationBase { type: 'arrow'; points: [Point, Point]; control?: Point; style?: ArrowStyle }
export interface StrokeAnnotation extends AnnotationBase { type: 'pen' | 'highlighter'; points: Point[]; control?: undefined; style?: undefined }
export interface BoxAnnotation extends AnnotationBase, Rect { type: 'rectangle' | 'ellipse'; points?: undefined; control?: undefined; style?: undefined }
export interface RedactAnnotation extends AnnotationBase, Rect { type: 'redact'; style?: RedactStyle; intensity?: number; points?: undefined; control?: undefined }
export interface TextAnnotation extends AnnotationBase, Point { type: 'text'; text: string; fontSize?: number; points?: undefined; control?: undefined; style?: undefined }
export interface NumberAnnotation extends AnnotationBase, Point { type: 'number'; number: number; radius?: number; style?: NumberStyle; points?: undefined; control?: undefined }
export type Annotation = ArrowAnnotation | StrokeAnnotation | BoxAnnotation | RedactAnnotation | TextAnnotation | NumberAnnotation;
export type AnnotationType = Annotation['type'];
export interface Appearance { background: string; padding: number; radius: number; variant?: number }
export interface CiipDocument extends Size { base: string; name: string; annotations: Annotation[]; crop: Rect | null; appearance?: Partial<Appearance> }
export type ScreenshotDocument = CiipDocument;
export interface FrameLayout extends Size { crop: Rect; offsetX: number; offsetY: number; padding: number; radius: number; background: string; variant?: number }
export interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number }
export type CanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type CanvasSurface = HTMLCanvasElement | OffscreenCanvas;
export interface QuickPlacement { panel: ScreenRect; image: ScreenRect; scale: number; original?: boolean }
export interface RenderOptions { fullImage?: boolean; pixelRatio?: number; preview?: Annotation | null; selection?: string | null }
export interface SelectionHandle extends Point { id: string; cursor: string }
export interface FrameLayoutInput extends Size { crop?: Rect | null; appearance?: unknown }
