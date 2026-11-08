import './styles/site.css';
import {demoStatus,initialDemoState,updateDemo,type DemoAction} from './demo.ts';
import {resolveSiteConfig} from './config.ts';
function element<T extends HTMLElement>(selector:string):T {
  const found=document.querySelector<T>(selector);if(!found)throw new Error(`Missing website element: ${selector}`);return found;
}
const site=resolveSiteConfig({repositoryUrl:import.meta.env.VITE_REPOSITORY_URL,releaseUrl:import.meta.env.VITE_RELEASE_URL});
for(const link of document.querySelectorAll<HTMLAnchorElement>('[data-repository-link]'))if(site.repositoryUrl){link.href=site.repositoryUrl;link.hidden=false;}
element<HTMLAnchorElement>('#release-link').href=site.releaseUrl;
element('#site-version').textContent=import.meta.env.VITE_RELEASE_VERSION||site.version;
const demo=element('#demo'),picture=element('#demo-picture'),status=element('#demo-status');
const annotation=element<HTMLButtonElement>('[data-demo-action="annotate"]'),pin=element<HTMLButtonElement>('[data-demo-action="pin"]'),close=element<HTMLButtonElement>('[data-demo-action="close"]');
let state={...initialDemoState};
const actions=new Set<DemoAction>(['capture','annotate','pin','close','reset','smaller','larger']);
function renderDemo():void {
  demo.dataset.phase=state.phase;picture.classList.toggle('is-annotated',state.annotated);picture.style.setProperty('--demo-scale',String(state.scale));
  annotation.disabled=state.phase==='ready';annotation.setAttribute('aria-pressed',String(state.phase==='captured'&&state.annotated));pin.disabled=state.phase==='ready';pin.setAttribute('aria-pressed',String(state.phase==='pinned'));
  close.hidden=state.phase!=='pinned';element('#demo-zoom').hidden=state.phase!=='pinned';element('#demo-scale').textContent=`${Math.round(state.scale*100)}%`;status.textContent=demoStatus(state);
}
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-demo-action]'))button.addEventListener('click',()=>{const action=button.dataset.demoAction as DemoAction;if(!actions.has(action))return;state=updateDemo(state,action);renderDemo();if(action==='close')element<HTMLButtonElement>('[data-demo-action="capture"]').focus();});
picture.addEventListener('dblclick',()=>{if(state.phase!=='pinned')return;state=updateDemo(state,'close');renderDemo();element<HTMLButtonElement>('[data-demo-action="capture"]').focus();});
element('#demo-controls').hidden=false;renderDemo();
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-background]'))button.addEventListener('click',()=>{const background=button.dataset.background;if(!background||!['apricot','sage','evening'].includes(background))return;element('#background-sample').dataset.background=background;for(const candidate of document.querySelectorAll<HTMLButtonElement>('[data-background]'))candidate.setAttribute('aria-pressed',String(candidate===button));});
element('#background-controls').hidden=false;
