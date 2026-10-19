import { t, getLocale, formatNumber } from './i18n.js';
import { icon } from './icons.js';
import { coverInverted } from './plan.js';
import { collectRoomEntities, categoryFor } from './room-controls-data.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const update = (el, html) => { if (el._h !== html) { el.innerHTML = html; el._h = html; } };
const domain = id => id.split('.')[0];
const ready = s => s && !['unavailable', 'unknown'].includes(s.state);
const categories = ['lights', 'covers', 'climate', 'media', 'sensors', 'other'];

export function wireRoomControls(app) {
  const vp = app.$('vp');
  vp.addEventListener('click', event => {
    const button = event.target.closest('[data-room-tab],[data-category],[data-control],[data-automation],[data-script],[data-ha-info],#roomCollapse');
    if (!button) return;
    if (button.id === 'roomCollapse') {
      app.setSheet(vp.dataset.sheet === 'peek' ? 'half' : 'peek');
    } else if (button.dataset.roomTab) {
      app.roomTab = button.dataset.roomTab; app.closeDetail(false); app.setSheet('half'); app.renderView();
    } else if (button.dataset.category) {
      app.roomCategory = button.dataset.category; app.renderView();
    } else if (button.dataset.control) {
      const [d, service] = button.dataset.control.split('.');
      app.call(d, service, { entity_id: button.dataset.id }).catch(() => app.toast(t('panel.roomControl.failed')));
    } else if (button.dataset.automation) {
      const id = button.dataset.automation, state = app.states()[id];
      app.call('automation', state?.state === 'on' ? 'turn_off' : 'turn_on', { entity_id:id, ...(state?.state === 'on' ? { stop_actions:false } : {}) }).catch(() => app.toast(t('panel.roomControl.failed')));
    } else if (button.dataset.haInfo) {
      app.moreInfo(button.dataset.haInfo);
    } else if (button.dataset.script) {
      app.call('script', 'turn_on', { entity_id:button.dataset.script }).catch(() => app.toast(t('panel.roomControl.failed')));
    }
  });
  vp.addEventListener('change', event => {
    const input = event.target.closest('[data-brightness]');
    if (input) app.call('light', 'turn_on', {entity_id:input.dataset.brightness, brightness:+input.value}).catch(() => app.toast(t('panel.roomControl.failed')));
  });
}

function entityRow(app, entity) {
  const id = entity.id, s = app.states()[id], d = domain(id), a = s.attributes || {};
  const unavailable = !ready(s), name = app.nameOf(id);
  const active = ['on','playing','heating','cleaning'].includes(s.state);
  const toggle = ['light','switch','input_boolean','fan'].includes(d);
  const ownDetail = ['light','cover','climate','camera','media_player'].includes(d);
  const fallbackIcon = {light:'bulb',switch:'plug',input_boolean:'plug',fan:'fan',climate:'thermo',media_player:'speaker',sensor:'thermo',binary_sensor:'motion',automation:'sparkle'}[d] || app.entIcon(entity);
  const info = `<button class="rc-entity" ${ownDetail?'data-more':'data-ha-info'}="${esc(id)}"><span class="rc-icon">${icon(fallbackIcon)}</span><span><b>${esc(name)}</b><small>${esc(app.stateText(id))}</small></span></button>`;
  let controls = toggle ? `<button class="rc-toggle" data-control="${d}.toggle" data-id="${esc(id)}" aria-label="${esc(name)}" aria-pressed="${s.state === 'on'}" ${unavailable ? 'disabled' : ''}><i></i></button>` : '';
  let extra = '';
  if (d === 'light' && !unavailable && s.state === 'on' && a.brightness != null && !(a.supported_color_modes || []).every(m => m === 'onoff') ) {
    extra = `<label class="rc-slider"><span>${t('panel.brightness')}</span><input type="range" min="1" max="255" value="${a.brightness}" data-brightness="${esc(id)}" aria-label="${esc(name)} · ${t('panel.brightness')}"></label>`;
  }
  if (d === 'cover') {
    const supported = a.supported_features || 0;
    extra = `<div class="rc-cover">${[['open_cover',1,'↑','panel.open'],['stop_cover',8,'■','panel.roomControl.stop'],['close_cover',2,'↓','panel.closed']].filter(([,bit])=>supported & bit).map(([service,,glyph,label])=>`<button data-control="cover.${coverInverted(app.plan,id) && service!=='stop_cover' ? (service==='open_cover'?'close_cover':'open_cover') : service}" data-id="${esc(id)}" aria-label="${esc(name)} · ${t(label)}" ${unavailable?'disabled':''}>${glyph}</button>`).join('')}</div>`;
  }
  return `<article class="rc-row ${active?'active':''} ${unavailable?'unavailable':''}"><div class="rc-row-main">${info}${controls}</div>${extra}</article>`;
}

export function renderRoomControls(app) {
  if (app.mode !== 'view' || !app.plan) return;
  const S = app.states(), all = collectRoomEntities(app);
  const focusedLevel = app.plan.levels.find(l => l.rooms.some(r=>r.id === app.focusRoom));
  const focused = focusedLevel?.rooms.find(r=>r.id === app.focusRoom);
  const scope = all.filter(e => !focused || e.room === focused.id);
  const tab = app.roomTab || 'devices';
  const title = focused?.name || (app.levelSel === 'all' ? app.plan.name : app.plan.levels.find(l=>l.id===app.levelSel)?.name) || t('panel.home');
  app.$('vpTitle').textContent = title;
  app.$('roomContext').textContent = focused ? focusedLevel.name : t('panel.roomControl.overview');
  app.$('roomCollapse').setAttribute('aria-label', t(app.$('vp').dataset.sheet === 'peek' ? 'panel.roomControl.expand' : 'panel.roomControl.collapse'));
  const light = scope.filter(e=>domain(e.id)==='light');
  const contacts = scope.filter(e=>domain(e.id)==='binary_sensor' && ['window','door','opening'].includes(S[e.id].attributes.device_class));
  const measures = dc => scope.map(e=>S[e.id]).filter(s=>ready(s) && s.attributes.device_class===dc && Number.isFinite(Number(s.state)));
  const stats = [];
  for (const dc of ['temperature','humidity']) {
    const values = measures(dc), unit = values[0]?.attributes.unit_of_measurement;
    if (values.length && values.every(s=>s.attributes.unit_of_measurement===unit)) stats.push(`${formatNumber(values.reduce((sum,s)=>sum+Number(s.state),0)/values.length,{maximumFractionDigits:1})}${esc(unit || '')}`);
  }
  if (light.length) stats.push(t('panel.roomControl.lightsOn',{count:light.filter(e=>S[e.id].state==='on').length}));
  if (contacts.length) stats.push(t('panel.roomControl.contactsOpen',{count:contacts.filter(e=>S[e.id].state==='on').length}));
  update(app.$('summary'), stats.map(s=>`<span>${s}</span>`).join(''));
  update(app.$('roomTabs'), ['devices','scenes','automations'].map(key=>`<button data-room-tab="${key}" aria-pressed="${tab===key}">${t(`panel.roomControl.${key}`)}</button>`).join(''));
  const devices = scope.filter(e=>!['scene','script','automation'].includes(domain(e.id)));
  const present = categories.filter(c=>devices.some(e=>categoryFor(e.id,S[e.id])===c));
  if (!present.includes(app.roomCategory)) app.roomCategory = 'all';
  app.$('roomCategories').hidden = tab !== 'devices' || present.length < 2;
  update(app.$('roomCategories'), ['all',...present].map(c=>`<button class="chip" data-category="${c}" aria-pressed="${(app.roomCategory||'all')===c}">${t(`panel.roomControl.${c}`)}</button>`).join(''));
  let html = '';
  if (tab === 'devices') {
    for (const category of present.filter(c=>app.roomCategory==='all'||c===app.roomCategory)) {
      html += `<section class="rc-group"><h3>${t(`panel.roomControl.${category}`)}</h3>`;
      html += devices.filter(e=>categoryFor(e.id,S[e.id])===category).map(e=>entityRow(app,e)).join('');
      html += '</section>';
    }
  } else {
    const domains = tab==='scenes' ? ['scene','script'] : ['automation'];
    const ids = scope.filter(e=>domains.includes(domain(e.id))).map(e=>e.id);
    // Unassigned routines remain discoverable in the whole-house overview.
    if (!focused && app.levelSel==='all') for (const id of Object.keys(S)) {
      const reg=app.hass.entities?.[id];
      if (domains.includes(domain(id)) && !reg?.hidden_by && !reg?.disabled_by && !ids.includes(id)) ids.push(id);
    }
    if (tab==='automations') html += `<p class="rc-note">${t('panel.roomControl.automationHint')}</p>`;
    for (const id of ids) {
      const s=S[id], d=domain(id), disabled=!ready(s);
      const last=s.attributes.last_triggered;
      const description=d==='automation' ? (last ? t('panel.roomControl.lastRun',{time:new Date(last).toLocaleString(getLocale())}) : t('panel.roomControl.neverRun')) : t(d==='script'?'panel.roomControl.script':'panel.roomControl.scene');
      html += `<article class="rc-row"><div class="rc-row-main"><button class="rc-entity" data-ha-info="${esc(id)}"><span class="rc-icon">${icon(d==='automation'?'sparkle':'play')}</span><span><b>${esc(app.nameOf(id))}</b><small>${esc(description)}</small></span></button>`;
      html += d==='automation' ? `<button class="rc-toggle" data-automation="${esc(id)}" aria-label="${t('panel.roomControl.enabled')} · ${esc(app.nameOf(id))}" aria-pressed="${s.state==='on'}" ${disabled?'disabled':''}><i></i></button>` : `<button class="btn small" ${d==='scene'?'data-scene':'data-script'}="${esc(id)}" ${disabled?'disabled':''}>${t('panel.run')}</button>`;
      html += '</div></article>';
    }
    if (!ids.length) html += `<p class="hint">${t('panel.roomControl.noRoutines')}</p>`;
  }
  // Keep a keyboard-adjusted slider in place during state updates.
  const active = app.shadowRoot.activeElement;
  if (!(active?.type === 'range' && app.$('tileArea').contains(active))) update(app.$('tileArea'), html || `<p class="hint">${t('panel.noDevices')}</p>`);
  if (app.detailEntity) app.renderDetail();
}

export function guardRoomDetail(el, state, domain) {
  const features=state.attributes.supported_features;
  if (Number.isInteger(features)) {
    const requirements=domain==='cover'
      ? {'[data-cov=open_cover]':1,'[data-cov=close_cover]':2,'#dP':4,'[data-cov=stop_cover]':8,'[data-cov=open_cover_tilt]':16,'[data-cov=close_cover_tilt]':32,'#dTilt':128}
      : domain==='media_player' ? {'[data-mp=media_previous_track]':16,'[data-mp=media_next_track]':32,'#dV':4,'[data-mp=media_play_pause]':state.state==='playing'?1:16384}
      : domain==='climate' ? {'[data-dt]':1} : {};
    for (const [selector,bit] of Object.entries(requirements)) if (!(features & bit)) el.querySelectorAll(selector).forEach(control=>{const field=control.closest('.field');(field||control).hidden=true;});
  }
  if (!ready(state)) el.querySelectorAll('input,button:not(#dBack),select').forEach(control=>control.disabled=true);
}
