import type {Rect,CaptureImage,ScreenRect,QuickPlacement} from './types.ts';
import type {EditorStyle} from './editor-style.ts';
export type {CaptureImage,ScreenRect,QuickPlacement} from './types.ts';

export type ShortcutAction = 'area' | 'window' | 'element' | 'screen' | 'pin';
export type ShortcutBindings = Record<ShortcutAction,string>;
export type ShortcutStatus = Partial<Record<ShortcutAction,{display:string;error?:string}>>;
export interface Preferences {
 openAtLogin:boolean;showEditorOnLaunch:boolean;menuBarVisible:boolean;
 menuBarStyle:'icon'|'icon-text'|'text';menuBarIcon:'capture'|'pin'|'wordmark'|'ligature';
 ocrEngine:'vision'|'tesseract';ocrMode:'accurate'|'fast';captureMode:'quick'|'editor';shortcuts:ShortcutBindings;
}
export interface QuickCapture {image:CaptureImage;placement:QuickPlacement|null;doubleClickMS:number}
export interface OCRLine extends Rect {text:string;confidence?:number}
export interface OCRResult {width:number;height:number;text:string;lines:OCRLine[]}
export interface AppInfo {version:string;platform:string;architecture:string;screenPermission:boolean|'granted'|'denied';engines:{id:string;name:string;detail:string;available:boolean}[]}
export interface Status {shortcuts:ShortcutStatus;version:string;captureMode:'quick'|'editor'}
export interface UpdateResult {status:'available'|'up_to_date'|'unavailable';currentVersion:string;latestVersion:string;url:string;message:string}
export interface NativeResponses {
 GetEditorStyle:EditorStyle;SetEditorStyle:EditorStyle;
 GetPreferences:Preferences;SetPreferences:Preferences;GetAppInfo:AppInfo;GetShortcutStatus:ShortcutStatus;
 GetStatus:Status;BeginShortcutRecording:ShortcutStatus;EndShortcutRecording:ShortcutStatus;
 CheckForUpdates:UpdateResult;OpenUpdatePage:void;GetQuickCapture:QuickCapture;GetQuickBounds:ScreenRect;TransformQuickWindow:ScreenRect;
 Capture:CaptureImage|null;OpenImage:CaptureImage|null;RecognizeText:OCRResult;SaveImage:string|null;PinImage:string;
 UpdatePin:void;CopyImage:void;CopyText:void;CloseEditor:void;CloseQuick:void;QuickReady:void;ShowEditor:void;
 HidePin:void;RestorePin:void;ClosePin:void;EditPin:void;ResizePin:void;RefreshPinShadow:void;
 OpenQuickInEditor:void;FinishQuickTransfer:void;ShowPermissionGuide:void;OpenScreenSettings:void;RevealApplication:void;
}
export type NativeMethod = keyof NativeResponses;
export type NativeCall = <K extends NativeMethod>(method:K,...args:unknown[])=>Promise<NativeResponses[K]>;
export function errorMessage(error:unknown):string {
 if(typeof error==='object'&&error!==null&&'message' in error&&typeof error.message==='string'&&error.message)return error.message;
 return String(error);
}
export interface PinInitial {id:string;dataURL:string;nativePinch?:boolean}
export interface GestureInputEvent extends Event {scale:number}

declare global {
 interface Window {mygo?:{call<T=unknown>(method:string,...args:unknown[]):Promise<T>}}
 interface WindowEventMap {
  'ciip:settings':CustomEvent<{tab?:string}>;
  'ciip:preferences':CustomEvent<Preferences>;
  'ciip:shortcuts-changed':Event;
  'ciip:pin-focus':Event;
  'ciip:image':CustomEvent<CaptureImage>;
  'ciip:document':CustomEvent<{documentJSON:string;pinID:string}>;
  'ciip:quick-document':CustomEvent<{documentJSON:string;token:string}>;
  'ciip:quick-transfer-abort':CustomEvent<{token:string}>;
  'ciip:pin':Event;'ciip:pin-closed':CustomEvent<{pinID:string}>;
  'ciip:error':CustomEvent<string|{message?:string}>;
  'ciip:open':Event;'ciip:copy':Event;'ciip:save':Event;'ciip:undo':Event;'ciip:redo':Event;
  'ciip:quick-open-editor':Event;'ciip:quick-transfer-cancelled':Event;
  gesturestart:GestureInputEvent;gesturechange:GestureInputEvent;gestureend:GestureInputEvent;
 }
}
