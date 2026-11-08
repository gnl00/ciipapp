// One interruptible motion and dismissal contract for lightweight app panels.
interface Popover {readonly open:boolean;show(keyboard?:boolean):Promise<void>;hide(restoreFocus?:boolean,instant?:boolean):Promise<void>}
const panels = new Set<Popover>();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function animatePanel(element:HTMLElement, opening:boolean, instant = false):Promise<void> {
  element.getAnimations().forEach(animation => animation.cancel());
  if (instant || reduced() || document.hidden || !document.hasFocus()) return Promise.resolve();
  const from = {opacity: 0, transform: 'translateY(var(--popover-shift, -4px)) scale(.98)'};
  const to = {opacity: 1, transform: 'translateY(0) scale(1)'};
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
  const token = style?.getPropertyValue(opening ? '--motion-panel-in' : '--motion-panel-out').trim() || '';
  const time = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)?$/.exec(token);
  const duration = time && (time[2] || +time[1] === 0) ? +time[1] * (time[2] === 's' ? 1000 : 1) : opening ? 170 : 110;
  if (!duration) return Promise.resolve();
  const easing = style?.getPropertyValue(opening ? '--ease-panel' : '--ease-exit').trim() || (opening ? 'cubic-bezier(.16,1,.3,1)' : 'ease-out');
  const animation = element.animate(opening ? [from, to] : [to, from], {
    duration, easing
  });
  // An occluded WebView can suspend its animation timeline. Dismissal must
  // complete even when the window loses visibility halfway through motion.
  return new Promise<void>(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true; clearTimeout(deadline); animation.cancel(); resolve();
    };
    const deadline = setTimeout(finish, duration + 100);
    animation.finished.then(finish, finish);
  });
}
export function createPopover(trigger:HTMLButtonElement, panel:HTMLElement):Popover {
  let opened = false, generation = 0;
  const anchor = panel.dataset.anchor ? document.getElementById(panel.dataset.anchor) : null;
  // Sample the page rather than an ancestor toolbar/footer's compositing group.
  if (anchor) document.body.appendChild(panel);
  const position = () => {
    if (!opened || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    const top = panel.dataset.placement === 'top' ? rect.top - panel.offsetHeight - 6 : rect.bottom + 6;
    panel.style.top = `${Math.max(8, Math.min(top, window.innerHeight - panel.offsetHeight - 8))}px`;
  };
  if (anchor) window.addEventListener('resize', position);
  trigger.setAttribute('aria-controls', panel.id);
  trigger.setAttribute('aria-expanded', 'false');
  const api = {
    get open() { return opened; },
    async show(keyboard = false) {
      for (const other of panels) if (other !== api) other.hide(false, true);
      generation++; opened = true; panel.hidden = false; panel.inert = false;
      position();
      trigger.setAttribute('aria-expanded', 'true');
      void animatePanel(panel, true, keyboard);
      if (keyboard) panel.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled)')?.focus();
    },
    async hide(restoreFocus = false, instant = false) {
      if (!opened) return;
      opened = false; const ticket = ++generation;
      trigger.setAttribute('aria-expanded', 'false');
      panel.inert = true;
      await animatePanel(panel, false, instant);
      if (ticket === generation) { panel.hidden = true; panel.inert = false; }
      if (restoreFocus && ticket === generation) trigger.focus();
    }
  };
  panels.add(api);
  trigger.addEventListener('click', event => {
    if (opened) void api.hide(false, event.detail === 0);
    else { panel.inert = false; void api.show(event.detail === 0); }
  });
  document.addEventListener('pointerdown', event => {
    if (opened && !panel.contains(event.target as Node) && !trigger.contains(event.target as Node)) void api.hide();
  });
  document.addEventListener('keydown', event => {
    if (!opened) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); void api.hide(true, true); }
    if (panel.getAttribute('role') === 'menu' && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const items = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }, true);
  panel.addEventListener('focusout', event => {
    // WebKit temporarily reports BODY as activeElement between buttons; use the intended target.
    const next = event.relatedTarget;
    if (next && !panel.contains(next as Node) && next !== trigger && opened) void api.hide(false, true);
  });
  return api;
}
