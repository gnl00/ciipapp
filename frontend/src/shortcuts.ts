export type ShortcutAction = 'area' | 'window' | 'screen' | 'pin';
export type Shortcuts = Record<ShortcutAction, string>;
export const shortcutActions: [ShortcutAction,string,string][]=[['area','区域截图','选择屏幕上的任意区域'],['window','窗口截图','点选一个窗口'],['screen','全屏截图','截取主显示器'],['pin','贴图','贴出当前正在编辑的截图']];
export const defaultShortcuts={area:'CmdOrCtrl+Shift+2',window:'CmdOrCtrl+Alt+3',screen:'CmdOrCtrl+Alt+4',pin:'CmdOrCtrl+Shift+P'};

export function shortcutFromEvent(event: Pick<KeyboardEvent, 'repeat' | 'key' | 'isComposing' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'code'>) {
  if(event.repeat||['Meta','Control','Alt','Shift','CapsLock'].includes(event.key))return null;
  if(event.isComposing)throw new Error('请先结束输入法组合，再按快捷键');
  const parts=[];
  if(event.metaKey)parts.push('CmdOrCtrl');
  if(event.ctrlKey)parts.push('Ctrl');
  if(event.altKey)parts.push('Alt');
  if(!parts.length)throw new Error('请同时按住 ⌘、⌃ 或 ⌥');
  if(event.shiftKey)parts.push('Shift');
  const code=event.code||'';
  const named: Record<string,string>={Space:'Space',Enter:'Enter',Tab:'Tab',Backspace:'Backspace',Delete:'Delete',Home:'Home',End:'End',PageUp:'PageUp',PageDown:'PageDown',ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down',Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/',Backquote:'`',Backslash:'\\'};
  let key=/^Key[A-Z]$/.test(code)?code.slice(3):/^Digit[0-9]$/.test(code)?code.slice(5):/^F([1-9]|1[0-9]|20)$/.test(code)?code:named[code];
  if(!key&&/^[a-z0-9]$/i.test(event.key))key=event.key.toUpperCase();
  if(!key)throw new Error('暂不支持此按键，请使用字母、数字、方向键或 F1–F20');
  return [...parts,key].join('+');
}
export function shortcutLabel(value: string) {
  if(!value)return '未设置';
  const parts=value.split('+'),key=parts.pop();
  const symbols: Record<string,string>={Space:'空格',Left:'←',Right:'→',Up:'↑',Down:'↓',Enter:'↩',Tab:'⇥',Escape:'Esc',Backspace:'⌫',Delete:'⌦'};
  return [['Ctrl','⌃'],['Alt','⌥'],['Shift','⇧'],['CmdOrCtrl','⌘']].filter(([key])=>parts.includes(key)).map(([,symbol])=>symbol).join('')+(symbols[key || '']||key);
}
export function shortcutConflict(shortcuts: Shortcuts,action: ShortcutAction,value: string) {
  if(!value)return null;
  return shortcutActions.find(([other])=>other!==action&&shortcuts[other]===value)?.[1]||null;
}
