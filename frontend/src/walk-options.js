import { t } from './i18n.js';
import { icon } from './icons.js';

export function readWalkOptions(userId, storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(`hometwin.walk.${userId || 'local'}`) || '{}');
    return { walls: saved?.walls === true, gravity: saved?.gravity === true };
  } catch { return { walls: false, gravity: false }; }
}

export class WalkOptions {
  constructor(app) {
    this.app = app;
    this.userId = app.hass?.user?.id || (app.hass?.demo ? 'demo' : 'local');
    try { app.walkOptions = readWalkOptions(this.userId); } catch { app.walkOptions = {walls:false,gravity:false}; }
    this.root = app.$('whOptions');
    this.root.innerHTML = `<div class="walk-options-fields" role="group">
      <button type="button" class="btn small" data-walk-option="walls">${icon('walkWalls')}</button>
      <button type="button" class="btn small" data-walk-option="gravity">${icon('walkGravity')}</button>
      <span class="walk-options-divider"></span>
      <button type="button" class="btn small" data-flight="1">${icon('walkUp')}</button>
      <button type="button" class="btn small" data-flight="-1">${icon('walkDown')}</button>
    </div>`;
    this.root.addEventListener('click', event => {
      const key = event.target.closest('[data-walk-option]')?.dataset.walkOption;
      if (!['walls','gravity'].includes(key)) return;
      app.walkOptions[key] = !app.walkOptions[key];
      if (app.stage.walk) { app.stage.walk.velocityY = 0; app.stage.walk.vertical = 0; }
      try { localStorage.setItem(`hometwin.walk.${this.userId}`, JSON.stringify(app.walkOptions)); } catch { /* Settings still work for this visit. */ }
      this.render(); app.stage.wake();
    });
    const stop = () => { if (app.stage.walk) app.stage.walk.vertical = 0; };
    this.root.addEventListener('focusin', () => { if (app.stage.walk) { app.stage.walk.keys.clear(); app.stage.walk.joy = [0, 0]; } });
    for (const button of this.root.querySelectorAll('[data-flight]')) {
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || app.walkOptions.gravity || !app.stage.walk) return;
        event.preventDefault();button.setPointerCapture(event.pointerId);app.stage.walk.vertical=Number(button.dataset.flight);app.stage.wake();
      });
      for (const type of ['pointerup','pointercancel','lostpointercapture','blur']) button.addEventListener(type,stop);
      button.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();if(!app.walkOptions.gravity && app.stage.walk)app.stage.walk.vertical=Number(button.dataset.flight);}});
      button.addEventListener('keyup',stop);
    }
    for (const type of ['keydown','keyup']) this.root.addEventListener(type,event=>event.stopPropagation());
    this.render();
  }
  render() {
    this.root.querySelector('[role="group"]').setAttribute('aria-label',t('panel.walkOptions.title'));
    for(const key of ['walls','gravity']) {
      const button=this.root.querySelector(`[data-walk-option="${key}"]`);
      button.setAttribute('aria-pressed',String(this.app.walkOptions[key]));
      button.setAttribute('aria-label',t(`panel.walkOptions.${key}`));
      button.title=`${t(`panel.walkOptions.${key}`)} — ${t(`panel.walkOptions.${key}Hint`)}`;
    }
    for(const button of this.root.querySelectorAll('[data-flight]')) {
      button.disabled=this.app.walkOptions.gravity;
      const label=t(Number(button.dataset.flight)>0?'panel.walkOptions.up':'panel.walkOptions.down');
      button.setAttribute('aria-label',label);button.title=`${label} — ${t('panel.walkOptions.flight')}`;
    }
  }
}

export const WALK_OPTIONS_CSS = `
.walk-options-fields{display:flex;align-items:center;gap:6px;margin-top:0;padding:6px;background:var(--line-soft);border-radius:11px}
.walk-options-fields button{display:grid;place-items:center;flex:1;height:36px;padding:7px;background:transparent;border-color:transparent;touch-action:none}
.walk-options-fields button svg{width:20px;height:20px}
.walk-options-fields button[aria-pressed="true"]{background:var(--edit-soft);border-color:var(--edit);color:var(--edit)}
.walk-options-fields button:focus-visible{outline:2px solid var(--edit);outline-offset:2px}
.walk-options-divider{height:20px;width:1px;background:var(--line);margin:0 3px}
.walkhud{max-height:calc(100% - 240px);overflow-y:auto}
`;
