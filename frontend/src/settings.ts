import {errorMessage} from './native.ts';
import type {NativeCall,NativeMethod,Preferences,AppInfo,ShortcutStatus,ShortcutAction} from './native.ts';
import {animatePanel} from './popover.ts';
import {shortcutActions,defaultShortcuts,shortcutFromEvent,shortcutLabel,shortcutConflict} from './shortcuts.ts';

const icons:Record<string,string>={
  general:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  shortcuts:'M3 6h18v12H3zM6 9h.1M9 9h.1M12 9h.1M15 9h.1M18 9h.1M6 12h.1M9 12h.1M12 12h.1M15 12h.1M18 12h.1M8 15h8',
  ocr:'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M8 8h8M12 8v9',
  permissions:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 12l3 3 5-6',
  about:'M12 17v-5m0-5v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  close:'m6 6 12 12M18 6 6 18', capture:'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M8 8h8v8H8z',
  pin:'m9 3 12 12M11 5l-5 6-3 1 9 9 1-3 6-5M8 16l-6 6', check:'m5 12 4 4L19 6',
};
const svg=(name:string)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name]||icons.general}"/></svg>`;
const trayWordmark=`<svg viewBox="0 0 48 32" fill="none" aria-hidden="true"><g transform="translate(0 32) scale(1 -1)" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path stroke-width="1.7" d="M11 4H6C4.3 4 3 5.3 3 7V11 M3 21V25C3 26.7 4.3 28 6 28H11 M37 28H42C43.7 28 45 26.7 45 25V21 M45 11V7C45 5.3 43.7 4 42 4H37"/><path stroke-width="2.2" d="M15.8 20.2C12.7 23 8.7 20.9 8.5 16C8.1 10.8 12.2 9.1 15.2 11.9 M19.7 10.8L21.1 20.8 M25.7 10.8L27.1 20.8 M32 6.8L34 21 M33.9 20.4C43.6 24.2 43.2 8.8 33.2 12.2"/><g fill="currentColor" stroke="none"><circle cx="21.45" cy="25.25" r="1.25"/><circle cx="27.45" cy="25.25" r="1.25"/></g></g></svg>`;
// Same top-down 32-unit geometry as ciipDrawTrayLigature in permissions_darwin.m.
const trayLigature=`<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M13.2 3.6L4.7 3.6C3.7 3.6 3.2 4.1 3.2 5.2C2.2 10.6 4.1 17.5 8.2 20.4C10.2 21.8 12.1 22.5 15 22.5L19 22.5C23.1 22.5 27.8 19.1 28.3 16.1C28.5 14.4 23.2 12.5 20.4 12.5L15 12.5L15 29.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><g fill="currentColor"><circle cx="10.1" cy="8.9" r="1.4"/><circle cx="18" cy="8.9" r="1.4"/></g></svg>`;
const toggle=(key:string,title:string,detail:string)=>`<label class="setting-row"><span><strong>${title}</strong><small>${detail}</small></span><input type="checkbox" role="switch" data-setting="${key}"><span class="setting-switch" aria-hidden="true"></span></label>`;
const choices=(key:string,label:string,items:[string,string][])=>`<div class="setting-row"><span><strong>${label}</strong></span><div class="setting-segments" role="group" aria-label="${label}">${items.map(([value,text])=>`<button type="button" data-setting="${key}" data-value="${value}" aria-label="${text}">${text}</button>`).join('')}</div></div>`;

export function initializeSettings({call,native,beforeOpen,onOCRChange}:{call:NativeCall;native:boolean;beforeOpen?:()=>void;onOCRChange?:()=>void}) {
  const dialog=document.createElement('dialog');dialog.id='settings-dialog';dialog.setAttribute('aria-labelledby','settings-title');
  dialog.innerHTML=`<header class="settings-header"><h2 id="settings-title" tabindex="-1">设置</h2><button class="settings-close" aria-label="关闭设置">${svg('close')}</button></header>
    <div class="settings-layout"><nav class="settings-nav" aria-label="设置分类">${[['general','通用'],['shortcuts','快捷键'],['ocr','文字识别'],['permissions','权限'],['about','关于']].map(([id,label])=>`<button data-tab="${id}">${svg(id)}<span>${label}</span></button>`).join('')}<span class="settings-nav-brand">ciip<span>·</span></span></nav>
    <div class="settings-content"><section data-page="general"><h3>启动与菜单栏</h3><p class="settings-intro">按你的使用习惯，让 ciip 留在手边。</p>
      <div class="setting-group">${toggle('openAtLogin','登录时启动','登录 macOS 后自动启动 ciip')}${toggle('showEditorOnLaunch','启动时显示编辑器','关闭后仍可从菜单栏或 Dock 打开')}</div>
      <div class="setting-group">${toggle('menuBarVisible','显示菜单栏图标','隐藏后可用 ⌘, 打开设置')}${choices('menuBarStyle','显示方式',[['icon','图标'],['icon-text','图标与名称'],['text','名称']])}
      <div class="setting-row"><span><strong>图标样式</strong></span><div class="setting-segments setting-icon-options" role="group" aria-label="菜单栏图标样式"><button data-setting="menuBarIcon" data-value="capture" aria-label="截图框" title="截图框">${svg('capture')}</button><button data-setting="menuBarIcon" data-value="pin" aria-label="图钉" title="图钉">${svg('pin')}</button><button data-setting="menuBarIcon" data-value="wordmark" aria-label="ciip 截图框字标" title="ciip 截图框字标">${trayWordmark}</button><button data-setting="menuBarIcon" data-value="ligature" aria-label="ciip 连字" title="ciip 连字">${trayLigature}</button></div></div></div>
      <div class="setting-group">${choices('captureMode','截图后编辑',[['quick','就地快捷编辑'],['editor','完整编辑器']])}</div>
      <p class="settings-footnote">在独立窗口中快捷编辑，支持移动和边框缩放；随时可转到完整编辑器。</p></section>
    <section data-page="shortcuts" hidden><h3>快捷键</h3><p class="settings-intro">在任何应用中截图，或把当前截图贴在手边。</p><div class="setting-group shortcut-list">${shortcutActions.map(([id,title,detail])=>`<div class="setting-row shortcut-row"><span><strong>${title}</strong><small>${detail}</small><small data-shortcut-error="${id}" class="shortcut-error"></small></span><button class="shortcut-recorder" data-shortcut-record="${id}" aria-label="设置${title}快捷键" title="点击后按下新的组合键"><kbd>未设置</kbd></button><button class="shortcut-clear" data-shortcut-clear="${id}" aria-label="清除${title}快捷键" title="清除快捷键">${svg('close')}</button></div>`).join('')}</div><div class="shortcut-footer"><button id="shortcuts-reset" class="settings-secondary">恢复默认快捷键</button><span id="shortcut-recording-state" role="status"></span></div><p class="settings-footnote">点击按键区域开始录制，Esc 取消，按退格或 Delete 清除。组合键需包含 ⌘、⌃ 或 ⌥。窗口与全屏默认使用 ⌥⌘3／⌥⌘4，保留 macOS 自带的 ⇧⌘3／⇧⌘4。</p></section>
    <section data-page="ocr" hidden><h3>文字识别</h3><p class="settings-intro">识别在本机完成，图片不会上传。</p><div id="ocr-engine-options" class="ocr-engine-options" role="group" aria-label="识别引擎"></div>
      <div class="setting-group" id="vision-mode-row">${choices('ocrMode','Apple Vision 模式',[['accurate','精确'],['fast','快速']])}</div><p class="settings-footnote">Tesseract 使用本机已安装的语言数据。切换引擎后，下次识别使用新设置。</p></section>
    <section data-page="permissions" hidden><h3>屏幕录制权限</h3><p class="settings-intro">用于区域、窗口、元素和全屏截图。打开本地图片不需要此权限。</p><div class="permission-status"><span id="permission-indicator"></span><div><strong id="permission-state">正在读取…</strong><p>授权由 macOS 管理</p></div><button id="permissions-refresh" class="settings-secondary">刷新</button></div>
      <div class="permission-guide-card"><div class="mini-app-mark">ciip<span>·</span></div><div><strong>把 ciip 添加到系统权限列表</strong><p>打开授权引导，拖动应用图标到系统设置中的列表，再开启权限。</p></div></div><div class="settings-actions"><button id="permission-guide" class="settings-primary">打开授权引导</button><button id="permission-settings" class="settings-secondary">打开系统设置</button></div><button id="reveal-application" class="settings-link">在 Finder 中显示 ciip</button><p class="settings-footnote">如果系统列表不接受拖入，请点击列表的「＋」选择 ciip。授权后按 macOS 提示重新打开应用。</p><p class="settings-footnote">元素截图还需要辅助功能权限，首次使用时会提示授权。请在系统设置 → 隐私与安全性 → 辅助功能中允许 ciip。</p></section>
    <section data-page="about" hidden><div class="about-brand"><div class="about-app-mark">ciip<span>·</span></div><h3>ciip</h3><p>截下来，贴在手边。</p><span id="app-version">正在读取版本…</span></div><dl class="about-details"><div><dt>运行环境</dt><dd id="app-platform"></dd></div><div><dt>文字识别</dt><dd>本机离线</dd></div></dl><div class="settings-actions update-actions"><button id="check-updates" class="settings-secondary">检查更新</button><button id="update-download" class="settings-primary" hidden>前往 GitHub 下载</button></div><p id="update-result" class="settings-footnote" role="status" aria-live="polite">手动检查 GitHub 上的最新正式版本。</p></section>
    <p id="settings-feedback" class="settings-feedback" role="status" aria-live="polite"></p></div></div>`;
  document.body.append(dialog);
  let preferences:Preferences|null=null,info:AppInfo|null=null,shortcutStatus:ShortcutStatus={},pending=false,loading=0,returnFocus:HTMLElement|null=null,recording:ShortcutAction|null=null,recordingTimer:ReturnType<typeof setTimeout>|undefined,recordingRequest=0,recordingTasks=0,visibilityGeneration=0,closing:Promise<void>|null=null;
  let checkingUpdates=false,updateRequest=0,updateAvailable=false;
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>('#'+id)!;
  const feedback=(text:string,error=false)=>{$('settings-feedback').textContent=text;$('settings-feedback').classList.toggle('error',error);};
  function selectTab(tab:string) {
    if((recording||recordingTasks)&&tab!=='shortcuts')void endRecording();
    if(!['general','shortcuts','ocr','permissions','about'].includes(tab))tab='general';
    dialog.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button=>{const active=button.dataset.tab===tab;button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false');});
    dialog.querySelectorAll<HTMLElement>('[data-page]').forEach(page=>{page.hidden=page.dataset.page!==tab;});
    dialog.querySelector<HTMLElement>('.settings-content')!.scrollTop=0;
  }
  function render() {
    const locked=pending||checkingUpdates||recordingTasks>0;
    dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement>('[data-setting]').forEach(input=>{
      const value=preferences?.[input.dataset.setting as keyof Preferences];
      if(input instanceof HTMLInputElement)input.checked=!!value;
      else input.setAttribute('aria-pressed',String(value===input.dataset.value));
      input.disabled=locked||!native||!preferences;
      if(input.dataset.setting==='menuBarIcon'&&(preferences?.menuBarStyle==='text'||!preferences?.menuBarVisible))input.disabled=true;
      if(input.dataset.setting==='menuBarStyle'&&!preferences?.menuBarVisible)input.disabled=true;
      if(input.dataset.setting==='ocrEngine')input.disabled ||= !info?.engines?.find(engine=>engine.id===input.dataset.value)?.available;
    });
    for(const [action] of shortcutActions) {
      const button=dialog.querySelector<HTMLButtonElement>(`[data-shortcut-record=${action}]`)!,clear=dialog.querySelector<HTMLButtonElement>(`[data-shortcut-clear=${action}]`)!,status=shortcutStatus[action as ShortcutAction];
      button.disabled=locked||!native||!preferences;clear.disabled=locked||!native||!preferences?.shortcuts?.[action as ShortcutAction]||!!recording;
      button.classList.toggle('recording',recording===action);button.setAttribute('aria-pressed',String(recording===action));
      button.querySelector('kbd')!.textContent=recording===action?'按下组合键…':shortcutLabel(preferences?.shortcuts?.[action as ShortcutAction]||'');
      dialog.querySelector<HTMLElement>(`[data-shortcut-error=${action}]`)!.textContent=status?.error||'';
    }
    $<HTMLButtonElement>('shortcuts-reset').disabled=locked||!native||!preferences||!!recording;
    $('shortcut-recording-state').textContent=recording?'Esc 取消录制':'';
    $('vision-mode-row').hidden=preferences?.ocrEngine!=='vision';
    for(const id of ['permission-guide','permission-settings','reveal-application','permissions-refresh','check-updates','update-download'])$<HTMLButtonElement>(id).disabled=locked||!native;
    $('update-download').hidden=!updateAvailable;
    $<HTMLButtonElement>('check-updates').disabled ||= !!recording;
    $('check-updates').textContent=checkingUpdates?'正在检查…':'检查更新';
    if(info) {
      $('app-version').textContent=`版本 ${info.version}`;
      $('app-platform').textContent=[info.platform==='darwin'?'macOS':info.platform,info.architecture==='arm64'?'Apple Silicon':info.architecture].filter(Boolean).join(' · ');
      const allowed=info.screenPermission===true||info.screenPermission==='granted';
      $('permission-state').textContent=allowed?'已授权':'尚未授权';$('permission-indicator').classList.toggle('granted',allowed);
    }
  }
  function renderEngines() {
    $('ocr-engine-options').replaceChildren();
    for(const engine of info?.engines||[]) {
      const button=document.createElement('button');button.className='ocr-engine-option';button.dataset.setting='ocrEngine';button.dataset.value=engine.id;
      const title=document.createElement('strong'),detail=document.createElement('small'),mark=document.createElement('span');title.textContent=engine.name;detail.textContent=engine.detail;mark.className='engine-check';mark.innerHTML=svg('check');
      button.append(title,detail,mark);$('ocr-engine-options').append(button);
    }
  }
  async function refresh() {
    const ticket=++loading;pending=true;render();feedback('正在读取设置…');
    try {
      if(!native){feedback('请在 ciip 桌面应用中更改设置。');return;}
      const values=await Promise.all([call('GetPreferences'),call('GetAppInfo'),call('GetShortcutStatus')]);
      if(ticket!==loading)return;
      [preferences,info,shortcutStatus]=values;renderEngines();feedback('');
    }catch(error){feedback(errorMessage(error),true);}
    finally{if(ticket===loading){pending=false;render();}}
  }
  async function save(key:keyof Preferences,value:Preferences[keyof Preferences]) {
    if(pending||checkingUpdates||recordingTasks||!preferences)return;
    const previous=preferences;let saved=false;pending=true;preferences={...preferences,[key]:value};render();feedback('正在保存…');
    try {preferences=await call('SetPreferences',preferences);saved=true;window.dispatchEvent(new CustomEvent('ciip:preferences',{detail:preferences}));if(key==='shortcuts'){shortcutStatus=await call('GetShortcutStatus');window.dispatchEvent(new CustomEvent('ciip:shortcuts-changed'));}feedback('已保存');if(key==='ocrEngine'||key==='ocrMode')onOCRChange?.();}
    catch(error){if(!saved)preferences=previous;feedback((saved?'设置已保存，但状态刷新失败：':'')+(errorMessage(error)),true);}
    finally{pending=false;render();}
  }
  async function endRecording(message='') {
    recordingRequest++;clearTimeout(recordingTimer);recordingTimer=undefined;recording=null;recordingTasks++;render();
    try {if(native){await call('EndShortcutRecording');shortcutStatus=await call('GetShortcutStatus');window.dispatchEvent(new CustomEvent('ciip:shortcuts-changed'));}}
    catch(error){feedback(errorMessage(error),true);return false;}
    finally{recordingTasks--;render();}
    if(message)feedback(message);
    return true;
  }
  async function beginRecording(action:ShortcutAction) {
    if(pending||checkingUpdates||recordingTasks||!preferences||!native)return;
    if(recording===action){await endRecording();return;}
    if(recording&&!await endRecording())return;
    const ticket=++recordingRequest;recordingTasks++;render();feedback('');
    try {
      await call('BeginShortcutRecording');
      if(ticket!==recordingRequest||!dialog.open){await call('EndShortcutRecording');return;}
      recording=action;recordingTimer=setTimeout(()=>void endRecording('录制已超时，原快捷键已恢复'),45000);
    }catch(error){feedback(errorMessage(error),true);}
    finally{recordingTasks--;render();if(recording)dialog.querySelector<HTMLButtonElement>(`[data-shortcut-record=${action}]`)!.focus({preventScroll:true});}
  }
  async function recordKey(event:KeyboardEvent) {
    if(!recording)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.key==='Escape'){await endRecording();return;}
    const action=recording;
    let value;
    try {value=['Backspace','Delete'].includes(event.key)&&!event.metaKey&&!event.ctrlKey&&!event.altKey?'':shortcutFromEvent(event);}
    catch(error){feedback(errorMessage(error),true);return;}
    if(value===null)return;
    const conflict=shortcutConflict(preferences!.shortcuts,action,value);
    if(conflict){feedback(`此组合键已用于${conflict}，请换一组。`,true);return;}
    if(!await endRecording())return;
    await save('shortcuts',{...preferences!.shortcuts,[action]:value});
  }
  async function action(method:NativeMethod) {
    if(pending||checkingUpdates||recordingTasks||!native)return;pending=true;render();feedback('');
    try {await call(method);}
    catch(error){feedback(errorMessage(error),true);}
    finally{pending=false;render();}
  }
  async function checkForUpdates() {
    if(pending||checkingUpdates||recording||recordingTasks||!native)return;
    const ticket=++updateRequest;checkingUpdates=true;updateAvailable=false;render();feedback('');
    $('update-result').textContent='正在检查 …';$('update-result').classList.remove('error');
    try {
      const result=await call('CheckForUpdates');
      if(ticket!==updateRequest)return;
      updateAvailable=result.status==='available';$('update-result').textContent=result.message;
    }catch(error){
      if(ticket===updateRequest){$('update-result').textContent=errorMessage(error);$('update-result').classList.add('error');}
    }finally{if(ticket===updateRequest){checkingUpdates=false;render();}}
  }
  async function show(tab='general') {
    const opening=!dialog.open,reopening=!!closing;visibilityGeneration++;closing=null;
    if(opening){beforeOpen?.();returnFocus=document.activeElement as HTMLElement|null;dialog.showModal();}
    if(opening||reopening){$('settings-title').focus({preventScroll:true});void animatePanel(dialog,true);}
    selectTab(tab);await refresh();
  }
  function close(){
    if(!dialog.open)return Promise.resolve();
    if(closing)return closing;
    const ticket=++visibilityGeneration;loading++;updateRequest++;
    if(checkingUpdates){checkingUpdates=false;$('update-result').textContent='手动检查 GitHub 上的最新正式版本。';}
    closing=(async()=>{
      try {
        await endRecording();if(ticket!==visibilityGeneration)return;
        await animatePanel(dialog,false);if(ticket!==visibilityGeneration)return;
        dialog.close();returnFocus?.focus?.({preventScroll:true});
      }finally{if(ticket===visibilityGeneration)closing=null;}
    })();
    return closing;
  }
  dialog.querySelector<HTMLButtonElement>('.settings-close')!.onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();void close();});
  dialog.addEventListener('click',event=>{
    const recorder=(event.target as Element).closest<HTMLButtonElement>('[data-shortcut-record]');if(recorder){void beginRecording(recorder.dataset.shortcutRecord as ShortcutAction);return;}
    const clear=(event.target as Element).closest<HTMLButtonElement>('[data-shortcut-clear]');if(clear&&!clear.disabled){void save('shortcuts',{...preferences!.shortcuts,[clear.dataset.shortcutClear!]:''});return;}
    const tab=(event.target as Element).closest<HTMLButtonElement>('[data-tab]');if(tab){selectTab(tab.dataset.tab!);return;}
    const button=(event.target as Element).closest<HTMLButtonElement>('button[data-setting]');if(button&&!button.disabled)void save(button.dataset.setting as keyof Preferences,button.dataset.value as Preferences[keyof Preferences]);
  });
  dialog.addEventListener('change',event=>{const input=event.target as HTMLInputElement;if(input.matches('input[data-setting]'))void save(input.dataset.setting as keyof Preferences,input.checked);});
  $('permissions-refresh').onclick=refresh;
  $('shortcuts-reset').onclick=()=>save('shortcuts',{...defaultShortcuts});
  dialog.addEventListener('keydown',event=>{if(recording)void recordKey(event);},true);
  window.addEventListener('blur',()=>{if(recording||recordingTasks)void endRecording('录制已取消，原快捷键已恢复');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&(recording||recordingTasks))void endRecording();});
  for(const [id,method]of ([['permission-guide','ShowPermissionGuide'],['permission-settings','OpenScreenSettings'],['reveal-application','RevealApplication'],['update-download','OpenUpdatePage']] as const))$(id).onclick=()=>action(method);
  $('check-updates').onclick=()=>checkForUpdates();
  window.addEventListener('ciip:settings',event=>void show(event.detail?.tab));
  document.addEventListener('keydown',event=>{if(recording)return;if((event.metaKey||event.ctrlKey)&&event.key===','){event.preventDefault();event.stopImmediatePropagation();void show();}},true);
  return {show,get open(){return dialog.open;}};
}
