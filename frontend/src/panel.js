import { renderRoomControls, wireRoomControls, guardRoomDetail } from './room-controls.js';
import { ROOM_CONTROLS_CSS } from './room-controls.css.js';
import { ROBOT_PREVIEW_ENABLED } from './features.js';
import englishFlag from './assets/flags/gb.svg';
import germanFlag from './assets/flags/de.svg';
import { t as tr, setLanguage, getLanguage, getLocale, formatNumber } from './i18n.js';
// <hometwin-panel>: the Home Assistant panel. Receives `hass`, `narrow`, `panel` from HA.
import { Stage } from './scene.js';
import { CSS } from './styles.js';
import { icon } from './icons.js';
import { syncStairVoids, migrate, demoPlan, emptyPlan, findItem, roomAt, roomOfOpening, usedEntities, roomCenter, applyOps, coverInverted, coverPercent } from './plan.js';
import { KINDS, lightColor } from './devices.js';
import { sunPosition } from './sun.js';
import { Editor } from './editor.js';
import { Agent } from './agent.js';
import { PlanWizard } from './wizard.js';
import { RobotAreas } from './robot-areas.js';
import { bbox, area as polyArea, pointInPolygon } from './geometry.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export { esc };
const CLIENT_ID = Math.random().toString(36).slice(2);

export class HomeTwinPanel extends HTMLElement {
  constructor() {
    super();
    this.mode = 'view'; this.levelSel = 'all'; this.activeLevelId = null; this.heatOn = false; this.xray = false;
    this.focusRoom = null; this.detailEntity = null; this.sel = null; this.hoverRoom = null;
    this.timeLive = true; this.customTime = null; this.undoStack = []; this.redoStack = []; this.hiddenLevels = new Set(); this.explode = false; this.dirty = false; this.plan = null;
    this._uiQueued = false; this._panelBusy = false;
  }
  // Scope of the view: 'all' = whole house from outside, a level id = that storey in section, 'roof' = the roof.
  get roofOn() { return this.levelSel === 'all' || this.levelSel === 'roof'; }
  hasRoof() { return this.plan?.site?.roof?.type && this.plan.site.roof.type !== 'none' && this.plan.levels.some((l) => l.rooms.some((r) => r.kind === 'room' || r.kind === 'garage')); }
  set hass(h) { const first = !this._hass; this._hass = h; if (first) this._init(); else this._onHass(); }
  get hass() { return this._hass; }
  set narrow(v) { this._narrow = v; this.$?.('menuBtn') && (this.$('menuBtn').hidden = !v); }
  set panel(p) {
    this._panel = p;
    const previous = getLanguage();
    this.lang = setLanguage(p?.config?.ui_language);
    if (this.plan && previous !== this.lang) this.refreshLanguage();
  }

  refreshLanguage() {
    // Update only our static labels: retain controls, listeners and user input.
    for (const el of this.shadowRoot.querySelectorAll('[data-i18n]')) {
      const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (node) node.textContent = tr(el.dataset.i18n);
    }
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      for (const el of this.shadowRoot.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, tr(el.getAttribute(`data-i18n-${attr}`)));
    }
    this.$('lib').lang = this.lang;
    this.$('saveState').textContent = tr(this.dirty ? 'panel.unsaved' : 'panel.saved');
    this.renderLevels(); this.renderSunPop(); this.updateLabelText();
    this.editor.refreshLanguage();
    if (!this.$('wizard').hidden) this.wizard.render();
    this.robotAreas?.render();
    if (!this.$('onboard').hidden) this.showOnboarding();
    if (this.detailEntity) this.renderDetail(true);
    this.scheduleUI(true);
  }

  /* ---------- HA access ---------- */
  states() { const states = this._hass?.states || {}; return this._preview ? { ...states, ...this._preview.states } : states; }
  // Show a scene in the model without activating it.
  async previewScene(id) {
    const scene = this._hass?.states?.[id]; if (!scene) return;
    let config = null;
    try { config = scene.attributes.id != null || this._hass.demo ? await this._hass.callApi('GET', `config/scene/config/${scene.attributes.id ?? id}`) : null; } catch { config = null; }
    if (!config?.entities) { this.toast(tr('panel.scenePreviewUnavailable')); return; }
    const states = {}, current = this._hass.states;
    for (const [entityId, value] of Object.entries(config.entities)) {
      const existing = current[entityId]; if (!existing) continue;
      const { state, ...attributes } = typeof value === 'object' ? value : { state: value }; const merged = { ...existing.attributes, ...attributes };
      if (attributes.rgb_color) merged.color_mode = 'rgb'; else if (attributes.color_temp_kelvin) { merged.color_mode = 'color_temp'; delete merged.rgb_color; }
      if (attributes.position != null) merged.current_position = attributes.position;
      states[entityId] = { ...existing, state: state ?? existing.state, attributes: merged };
    }
    this._preview = { id, states }; clearTimeout(this._prevT); this._prevT = setTimeout(() => this.endPreview(), 12000);
    const bar = this.$('scenePrev'); bar.hidden = false; bar.innerHTML = `<span>👁 ${tr('panel.preview')}: <b>${esc(this.nameOf(id))}</b> · ${tr('panel.deviceCount', { count: Object.keys(states).length })}</span><button class="btn small primary" data-sp="run">${tr('panel.run')}</button><button class="btn small" data-sp="end">${tr('panel.close')}</button>`;
    bar.onclick = (event) => { const button = event.target.closest('[data-sp]'); if (!button) return; if (button.dataset.sp === 'run') { this.call('scene', 'turn_on', { entity_id: id }); this.toast(tr('panel.scene', { name: this.nameOf(id) })); } this.endPreview(); };
    if (this.levelSel !== 'all') this.setLevel('all'); this.stage.wake(); this.scheduleUI(true);
  }
  endPreview() { if (!this._preview) return; this._preview = null; clearTimeout(this._prevT); this.$('scenePrev').hidden = true; this.stage.wake(); this.scheduleUI(true); }
  isAdmin() { return this._hass?.user?.is_admin !== false; }
  areaOf(id) {
    const h = this._hass, e = h.entities?.[id];
    return e?.area_id || (e?.device_id && h.devices?.[e.device_id]?.area_id) || h.states[id]?.attributes?.area || null;
  }
  areas() { return Object.values(this._hass.areas || {}); }
  floors() { return Object.values(this._hass.floors || {}).sort((a, b) => (a.level ?? 0) - (b.level ?? 0)); }
  areaName(id) { return this._hass.areas?.[id]?.name || id || ''; }
  nameOf(id) { return this.states()[id]?.attributes?.friendly_name || id; }
  call(domain, service, data) { return this._hass.callService(domain, service, data); }

  /* ---------- setup ---------- */
  async _init() {
    // HA may assign hass before panel in the same update cycle.
    await Promise.resolve();
    setLanguage(this._panel?.config?.ui_language);
    this.lang = getLanguage();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}${ROOM_CONTROLS_CSS}</style>${template()}`;
    this.$ = (id) => root.getElementById(id);
    root.querySelectorAll('[data-ic]').forEach((b) => b.insertAdjacentHTML('afterbegin', icon(b.dataset.ic)));
    this.setAttribute('mode', 'view');
    this.$('menuBtn').hidden = !this._narrow;
    this.stage = new Stage(this.$('stage'), this);
    this.editor = new Editor(this); this.agent = new Agent(this); this.wizard = new PlanWizard(this); this.robotAreas = new RobotAreas(this);
    this._wireTop(); this._wireView();
    new ResizeObserver(() => { this.stage.resize(); }).observe(this);
    this.stage.resize();
    let plan = null;
    try { plan = migrate((await this._hass.callWS({ type: 'hometwin/plan/get' }))?.plan); } catch (e) { console.warn('hometwin: plan/get failed', e); }
    if (!plan) { plan = this._panel?.config?.demo === false ? emptyPlan() : demoPlan(); this._firstRun = true; }
    this.setPlan(plan, { frame: true });
    try {
      this._unsub = await this._hass.connection?.subscribeMessage?.((msg) => {
        if (msg.client_id === CLIENT_ID || this.dirty) return;
        const p = migrate(msg.plan); if (p) { this.setPlan(p); this.toast(tr('panel.remoteChange')); }
      }, { type: 'hometwin/plan/subscribe' });
    } catch { /* older backend or demo */ }
    this.stage.connect(); setTimeout(() => this.stage.riseAll(), 250);
    this._sunTimer = setInterval(() => this.updateSun(), 30000);
    if (!this.isAdmin()) this.$('mEdit').hidden = true;
    if (this._firstRun && this.isAdmin()) this.showOnboarding();
  }
  // First start: choose between the sample house, an empty plan or the floor-plan wizard.
  showOnboarding() {
    const o = this.$('onboard'); o.hidden = false;
    o.innerHTML = `<div class="ob" role="dialog" aria-modal="true" aria-labelledby="obT"><div class="ob-languages" role="group" aria-label="${tr('panel.language')}">${[['en', 'English', englishFlag], ['de', 'Deutsch', germanFlag]].map(([code, name, flag]) => `<button type="button" data-language="${code}" lang="${code}" aria-pressed="${getLanguage() === code}"><img src="${esc(flag)}" alt="" width="27" height="18">${name}</button>`).join('')}</div><h2 id="obT">${tr('panel.welcome')}</h2>
      <p class="lead">${tr('panel.intro')}</p>
      <div class="choices">
        <button class="choice primary" data-ob="plan">${icon('image')}<strong>${tr('panel.startPlan')}</strong><span>${tr('panel.startPlanHint')}</span></button>
        <button class="choice" data-ob="empty">${icon('square')}<strong>${tr('panel.startEmpty')}</strong><span>${tr('panel.startEmptyHint')}</span></button>
        <button class="choice" data-ob="demo">${icon('home')}<strong>${tr('panel.startDemo')}</strong><span>${tr('panel.startDemoHint')}</span></button>
      </div></div>`;
    o.onclick = async (e) => {
      const languageButton = e.target.closest('[data-language]');
      if (languageButton) {
        const language = languageButton.dataset.language;
        if (language === getLanguage()) return;
        o.querySelectorAll('button').forEach((button) => { button.disabled = true; });
        try {
          await this._hass.callWS({ type: 'hometwin/language/set', language });
          this.panel = { ...this._panel, config: { ...this._panel?.config, ui_language: language } };
          this.dispatchEvent(new CustomEvent('hometwin-language-changed', { detail: language }));
          this.$('onboard').querySelector(`[data-language="${language}"]`)?.focus();
        } catch (error) {
          o.querySelectorAll('button').forEach((button) => { button.disabled = false; });
          this.toast(tr('panel.languageSaveError'));
        }
        return;
      }
      const c = e.target.closest('[data-ob]')?.dataset.ob; if (!c) return;
      o.hidden = true; o.innerHTML = ''; this._firstRun = false;
      if (c === 'demo') { this.markDirty(); return; }
      this.setPlan(emptyPlan(), { frame: true }); this.markDirty(); this.setMode('edit');
      if (c === 'plan') this.wizard.open({ levelId: this.plan.levels[0].id });
      else this.toast(tr('panel.drawFirst'));
    };
  }
  connectedCallback() { this.stage?.connect(); }
  disconnectedCallback() { this.stage?.disconnect(); }

  setPlan(plan, { frame = false } = {}) {
    this.plan = plan;
    if (!plan.site.lat && this._hass.config?.latitude != null) { plan.site.lat = this._hass.config.latitude; plan.site.lon = this._hass.config.longitude; }
    if (!plan.levels.find((l) => l.id === this.activeLevelId)) this.activeLevelId = (plan.levels.find((l) => l.elevation >= -0.01) || plan.levels[0])?.id;
    if (!['all', 'roof'].includes(this.levelSel) && !plan.levels.find((l) => l.id === this.levelSel)) this.levelSel = 'all';
    if (this.levelSel === 'roof' && !this.hasRoof()) this.levelSel = 'all';
    this.stage.rebuildAll(); this.editor.loadUnderlays();
    this.buildLabels(); this.renderLevels(); this.updateSun(); this.scheduleUI(true);
    if (frame) this.stage.frame(this.levelSel, true);
  }
  findRoom(levelId, roomId) { return this.plan.levels.find((l) => l.id === levelId)?.rooms.find((r) => r.id === roomId); }
  activeLevel() { return this.plan.levels.find((l) => l.id === this.activeLevelId) || this.plan.levels[0]; }

  /* ---------- persistence ---------- */
  pushUndo() { this.undoStack.push(JSON.stringify(this.plan)); if (this.undoStack.length > 60) this.undoStack.shift(); this.redoStack = []; this.editor?.renderBar(); }
  undo() { const s = this.undoStack.pop(); if (!s) return; this.redoStack.push(JSON.stringify(this.plan)); this.setPlan(JSON.parse(s)); this.markDirty({ settle: false }); this.editor.select(null); this.editor.renderBar(); }
  redo() { const s = this.redoStack.pop(); if (!s) return; this.undoStack.push(JSON.stringify(this.plan)); this.setPlan(JSON.parse(s)); this.markDirty({ settle: false }); this.editor.select(null); this.editor.renderBar(); }
  markDirty({ settle = true } = {}) {
    const voids = syncStairVoids(this.plan);
    if (voids.size) { for (const id of voids) this.stage.rebuildLevel(id); this.buildLabels(); if (this.mode === 'edit') this.editor.renderLeft(); }
    if (settle) this.stage.settleAutomaticItems();
    this.stage.select(this.sel, this.editor?.multi || []);
    this.dirty = true; this.$('saveState').textContent = tr('panel.unsaved');
    clearTimeout(this._saveT); this._saveT = setTimeout(() => this.save(), 900);
  }
  async save() {
    clearTimeout(this._saveT); this.$('saveState').textContent = tr('panel.saving');
    try { await this._hass.callWS({ type: 'hometwin/plan/save', plan: this.plan, client_id: CLIENT_ID }); this.dirty = false; this.$('saveState').textContent = tr('panel.saved'); }
    catch (e) { this.$('saveState').textContent = tr('panel.notSaved'); this.toast(tr('panel.saveError', {error: e.message || e.code || e})); }
  }
  // Applies ops (from editor tools or the agent), rebuilding only what changed.
  apply(ops, { undo = true, settle = true } = {}) {
    if (undo) this.pushUndo();
    const res = applyOps(this.plan, ops);
    this.stage.rebuildAll(); this.buildLabels(); this.renderLevels(); this.markDirty({ settle }); this.scheduleUI(true);
    return res;
  }

  applyLocal(op) {
    const res = applyOps(this.plan, [op])[0];
    if (!res.ok) { this.toast(res.error); return res; }
    const L = this.plan.levels.find((l) => l.id === op.level_id) || this.plan.levels[0];
    if (op.op === 'place_device') this.stage.addDevice(L.id, findItem(this.plan, res.id).item);
    else if (op.op === 'place_furniture') this.stage.addFurniture(L.id, findItem(this.plan, res.id).item);
    else { this.stage.rebuildLevel(L.id); this.buildLabels(); }
    if (['place_device', 'place_furniture', 'move_item', 'update_device'].includes(op.op)) {
      const f = findItem(this.plan, res.id || op.item_id || op.device_id);
      if (f) this.stage.settleItem(f.level.id, f.type, f.item);
    }
    this.stage.select(this.sel, this.editor?.multi || []);
    this.markDirty(); this.scheduleUI(true); return res;
  }

  /* ---------- top bar ---------- */
  _wireTop() {
    this.$('menuBtn').addEventListener('click', () => this.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true })));
    this.$('mView').addEventListener('click', () => this.setMode('view'));
    this.$('mEdit').addEventListener('click', () => this.setMode('edit'));
    this.$('tSun').addEventListener('click', () => { const p = this.$('sunPop'); p.hidden = !p.hidden; this.renderSunPop(); });
    this.$('levels').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) this.setLevel(b.dataset.level); });
    this._wireWalk();
    this.$('roomSel').addEventListener('change', (e) => { const [lv, rid] = e.target.value.split('|'); if (!rid) { this.setLevel('all'); this.setFocus(null); return; } this.setFocus(rid, lv); this.setSheet('half'); });
    this.$('sheetGrip').addEventListener('click', () => { const s = this.$('vp').dataset.sheet; this.setSheet(s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'); });
    { let y0 = null; const g = this.$('sheetGrip'); g.addEventListener('pointerdown', (e) => { y0 = e.clientY; g.setPointerCapture(e.pointerId); }); g.addEventListener('pointerup', (e) => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; if (Math.abs(dy) < 30) return; const s = this.$('vp').dataset.sheet, order = ['peek', 'half', 'full'], i = order.indexOf(s); this.setSheet(order[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]); e.stopPropagation(); this._skipGripClick = true; setTimeout(() => (this._skipGripClick = false), 50); }); }
    try { const pm = localStorage.getItem('hometwin-perf'); this.perfMode = pm == null ? matchMedia('(pointer: coarse)').matches : pm === '1'; } catch { this.perfMode = false; }
    this.stage.setPerf(this.perfMode);
    this.$('sunPop').addEventListener('click', (e) => {
      const cam = e.target.closest('[data-cam]'); if (cam) { this.stage.viewFrom(cam.dataset.cam); return; }
      const tg = e.target.closest('[data-toggle]'); if (!tg) return; const k = tg.dataset.toggle;
      if (k === 'heat') this.heatOn = !this.heatOn;
      if (k === 'xray') { this.xray = !this.xray; if (this.xray && this.levelSel !== 'all') this.setLevel('all'); this.stage.layout(); }
      if (k === 'stats') { this.showStats = !this.showStats; this.$('stats').hidden = !this.showStats; this.renderSunPop(); return; }
      if (k === 'perf') { this.perfMode = !this.perfMode; try { localStorage.setItem('hometwin-perf', this.perfMode ? '1' : '0'); } catch { /* ignore */ } this.stage.setPerf(this.perfMode); this.renderSunPop(); this.toast(this.perfMode ? tr('panel.perfOn') : tr('panel.perfOff')); return; }
      if (k === 'explode') { this.explode = !this.explode; if (this.explode && this.levelSel !== 'all') this.levelSel = 'all'; this.stage.layout(); this.buildLabels(); this.renderLevels(); this.stage.frame(this.levelSel); }
      this.renderSunPop();
    });
    this.$('sunPop').addEventListener('input', (e) => {
      if (e.target.id === 'sunLive') this.timeLive = e.target.checked;
      if (e.target.id === 'sunDate' || e.target.id === 'sunTime') {
        this.timeLive = false; const d = this.$('sunDate').value || new Date().toISOString().slice(0, 10); const m = +this.$('sunTime').value;
        const dt = new Date(`${d}T00:00:00`); dt.setMinutes(m); this.customTime = dt;
      }
      this.updateSun(); this.renderSunPop(false);
    });
    this.addEventListener('keydown', (e) => this.editor.onKey(e));
  }
  root() { return this.shadowRoot; }
  setMode(m) {
    if (m === 'edit' && !this.isAdmin()) return;
    this.mode = m; this.setAttribute('mode', m);
    this.$('mView').setAttribute('aria-pressed', m === 'view'); this.$('mEdit').setAttribute('aria-pressed', m === 'edit');
    if (m === 'edit') this.editor.open();
    else { this.editor.close(); this.focusRoom = null; }
    this.stage.layout(); this.renderLevels(); this.scheduleUI(true); this.stage.frame(this.levelSel);
  }
  setLevel(id, frame = true) {
    if (id === 'roof' && !this.hasRoof()) id = 'all';
    const changed = this.levelSel !== id; this.levelSel = id; if (!['all', 'roof'].includes(id)) this.activeLevelId = id;
    if (id !== 'all' && this.explode) this.explode = false;
    if (!changed && !frame) return;
    this.focusRoom = null; this.stage.layout(); this.buildLabels(); this.renderLevels(); this.scheduleUI(true);
    if (this.mode === 'edit') this.editor.onLevelChange();
    if (frame) this.stage.frame(this.levelSel);
  }
  renderLevels() {
    const ls = this.plan.levels; const el = this.$('levels');
    el.hidden = false;
    el.innerHTML = `<button data-level="all" aria-pressed="${this.levelSel === 'all'}" title="${tr('panel.wholeHouse')}" aria-label="${tr('panel.wholeHouse')}">${icon('home')}</button>`
      + [...ls].reverse().map((l) => `<button data-level="${l.id}" aria-pressed="${this.levelSel === l.id}" title="${esc(l.name)}">${esc(short(l.name))}</button>`).join('');
    this.renderRoomSel();
  }
  // Touch-friendly room picker (native select = OS picker on phones), grouped by storey.
  renderRoomSel() {
    const el = this.$('roomSel'); if (!el) return;
    const groups = [...this.plan.levels].reverse().map((l) => { const rs = l.rooms.filter((r) => r.kind !== 'void' && !(r.kind === 'outdoor' && polyArea(r.points) > 60)); return rs.length ? `<optgroup label="${esc(l.name)}">${rs.map((r) => `<option value="${l.id}|${r.id}" ${this.focusRoom === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</optgroup>` : ''; }).join('');
    el.innerHTML = `<option value="" ${this.focusRoom ? '' : 'selected'}>${tr('panel.allRooms')}</option>${groups}`;
  }
  renderSunPop(full = true) {
    const p = this.$('sunPop'); const s = this._sun || { azimuth: 0, elevation: 0 }; const d = this.sunDate();
    const tg = (k, on, label) => `<button class="chip" data-toggle="${k}" aria-pressed="${on}">${label}</button>`;
    if (full) p.innerHTML = `<div class="panel-head" style="padding:0"><h2>${tr('panel.view')}</h2></div>
      <div class="chips" style="padding:0">${tg('heat', this.heatOn, tr('panel.heatmap'))}${tg('xray', this.xray, tr('panel.xray'))}${this.plan.levels.length > 1 ? tg('explode', this.explode, tr('panel.explode')) : ''}${tg('perf', !!this.perfMode, tr('panel.performance'))}${tg('stats', !!this.showStats, tr('panel.performanceDisplay'))}</div>
      <div class="field"><span class="lbl">${tr('panel.camera')}</span><div class="chips" style="padding:0">${[['N', tr('panel.north')], ['E', tr('panel.east')], ['S', tr('panel.south')], ['W', tr('panel.west')], ['top', tr('panel.top')]].map(([k, l]) => `<button class="chip" data-cam="${k}">${l}</button>`).join('')}</div></div>
      <div class="panel-head" style="padding:6px 0 0"><h2>${tr('panel.sun')}</h2></div>
      <label class="check"><input type="checkbox" id="sunLive" ${this.timeLive ? 'checked' : ''}> ${tr('panel.live')}</label>
      <div class="field"><label for="sunDate">${tr('panel.date')}</label><input type="date" id="sunDate" value="${isoDate(d)}"></div>
      <div class="field"><label for="sunTime">${tr('panel.time')} <output id="sunTimeOut"></output></label><input type="range" id="sunTime" min="0" max="1439" step="5" value="${d.getHours() * 60 + d.getMinutes()}"></div>
      <div class="sunline" id="sunLine"></div>
      <p class="hint">${tr('panel.location', {lat: fmtCoord(this.plan.site.lat, 'N'), lon: fmtCoord(this.plan.site.lon, getLanguage() === 'de' ? 'O' : 'E'), north: Math.round(this.plan.site.north || 0)})}</p>`;
    this.$('sunTimeOut').textContent = d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
    this.$('sunLine').textContent = tr('panel.sunAngles', {azimuth: formatNumber(s.azimuth,{maximumFractionDigits:1}), elevation: formatNumber(s.elevation,{maximumFractionDigits:1})}) + (s.source ? ' · ' + s.source : '');
    if (!full && this.timeLive) { this.$('sunDate').value = isoDate(d); this.$('sunTime').value = d.getHours() * 60 + d.getMinutes(); }
  }
  sunDate() { return this.timeLive || !this.customTime ? new Date() : this.customTime; }
  updateSun() {
    const site = this.plan?.site; if (!site) return;
    let s; const sunEnt = this.states()['sun.sun'];
    // Always compute from the site when possible: sun.sun only refreshes every few minutes,
    // which shows near sunrise/sunset as a visible jump between live and preview.
    if (site.lat != null) s = { ...sunPosition(this.sunDate(), site.lat, site.lon), source: this.timeLive ? 'live' : tr('panel.preview') };
    else if (sunEnt?.attributes?.azimuth != null) s = { azimuth: +sunEnt.attributes.azimuth, elevation: +sunEnt.attributes.elevation, source: 'sun.sun' };
    else s = { azimuth: 180, elevation: 35, source: tr('panel.noLocation') };
    if (this._hass.demo) this._hass.updateDemoSun?.(s.elevation);
    this._sun = s; this.stage.setSun(s.azimuth, s.elevation, site.north || 0);
    this.$('tSun').innerHTML = icon(s.elevation > 0 ? 'sun' : 'moon');
    if (!this.$('sunPop').hidden) this.renderSunPop(false);
  }

  /* ---------- labels ---------- */
  buildLabels() {
    const box = this.$('labels'); box.innerHTML = ''; this._labels = [];
    if (this.levelSel === 'roof') return;
    if (this.levelSel === 'all') {
      if (!this.explode || this.plan.levels.length < 2) return;
      for (const l of this.plan.levels) {
        const pts = l.rooms.filter((r) => r.kind !== 'outdoor').flatMap((r) => r.points); if (!pts.length) continue; const b = bbox(pts);
        const el = document.createElement('div'); el.className = 'rlabel lvl'; box.appendChild(el); this._labels.push({ el, level: l, room: null, c: [b.minX - 0.4, b.maxZ + 0.4] });
      }
      return this.updateLabelText();
    }
    for (const l of this.plan.levels) {
      if (!this.stage.isVisible(l)) continue;
      for (const r of l.rooms) {
        if (r.kind === 'void') continue;
        if (r.kind === 'outdoor' && polyArea(r.points) < 8) continue;
        const el = document.createElement('div'); el.className = 'rlabel' + (r.kind === 'outdoor' ? ' out' : ''); box.appendChild(el);
        this._labels.push({ el, level: l, room: r, c: roomCenter(r) });
      }
    }
    this.updateLabelText();
  }
  updateLabelText() {
    for (const L of this._labels || []) {
      if (!L.room) { const lit = L.level.devices.filter((d) => d.kind === 'light' && this.states()[d.entity_id]?.state === 'on').length; L.el.innerHTML = `<b>${esc(L.level.name)}</b><span>${lit ? `<span class="on">${lit} ${tr('panel.lightsOn')}</span>` : ''}</span>`; continue; }
      const t = this.roomTemp(L.level, L.room); const lit = this.roomDevices(L.level, L.room).filter((d) => d.kind === 'light' && this.states()[d.entity_id]?.state === 'on').length;
      L.el.innerHTML = `<b>${esc(L.room.name)}</b><span>${t != null ? formatNumber(t, {minimumFractionDigits: 1, maximumFractionDigits: 1}) + '°' : ''}${lit ? ` <span class="on">· ${lit} ${tr('panel.on')}</span>` : ''}</span>`;
    }
  }
  onFrame() {
    if (this.showStats && performance.now() - (this._statT || 0) > 500) { this._statT = performance.now(); const info = this.stage.renderer.info; this.$('stats').textContent = tr('panel.performanceStats', { fps: this.stage.fps, drawCalls: info.render.calls, triangles: formatNumber(info.render.triangles / 1000, { maximumFractionDigits: 0 }), geometries: info.memory.geometries, pace: this.stage.pace }); }
    if (this.mode === 'edit') this.editor.placeDims();
    for (const L of this._labels || []) {
      const [x, y, z] = this.stage.project(L.c[0], this.stage.displayY(L.level) + 0.05, L.c[1]);
      L.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`; L.el.style.left = '0'; L.el.style.top = '0';
      const roofed = this.levelSel === 'roof';
      L.el.style.opacity = z > 1 || roofed ? 0 : this.focusRoom && L.room && this.focusRoom !== L.room.id ? 0.3 : 1;
    }
  }
  roomDevices(level, room) { return level.devices.filter((d) => roomAt(level, d.pos)?.id === room.id); }
  roomTemp(level, room) {
    const d = this.roomDevices(level, room).find((x) => x.kind === 'temp' && this.states()[x.entity_id]?.attributes?.device_class === 'temperature');
    if (d) return parseFloat(this.states()[d.entity_id].state);
    const c = this.roomDevices(level, room).find((x) => ['radiator', 'thermostat', 'ac'].includes(x.kind) && this.states()[x.entity_id]?.attributes?.current_temperature != null);
    return c ? +this.states()[c.entity_id].attributes.current_temperature : null;
  }
  roomTint(level, r) {
    if (this.heatOn && r.kind !== 'outdoor') { const t = this.roomTemp(level, r); if (t != null && !isNaN(t)) { const h = Math.min(0.62, Math.max(0, 0.62 - ((t - 17) / 8) * 0.62)); return { color: `hsl(${h * 360},85%,50%)`, opacity: 0.38 }; } }
    if (this.mode === 'edit' && this.sel?.type === 'room' && this.sel.id === r.id) return { color: '#79a6ff', opacity: 0.22 };
    if (this.mode === 'view' && this.hoverRoom === r.id && r.kind !== 'outdoor') return { color: '#ffffff', opacity: 0.05 };
    return null;
  }

  /* ---------- view panel ---------- */
  _onHass() {
    this.stage?.invalidate();
    this.scheduleUI();
  }
  scheduleUI(planChanged) {
    if (planChanged) this._planChanged = true;
    if (this._uiQueued) return; this._uiQueued = true;
    requestAnimationFrame(() => {
      this._uiQueued = false; if (this._panelBusy) return this.scheduleUI();
      this.renderView(); this.updateLabelText();
      if (this.mode === 'edit') this.editor.refresh(this._planChanged);
      this._planChanged = false;
    });
  }
  _wireView() {
    const vp = this.$('vp');
    wireRoomControls(this);
    for (const id of ['vp', 'lib']) { const el = this.$(id); el.addEventListener('pointerdown', () => (this._panelBusy = true)); const free = () => setTimeout(() => (this._panelBusy = false), 0); ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => el.addEventListener(ev, free)); }
    vp.addEventListener('click', (e) => {
      const more = e.target.closest('[data-more]'); if (more) { e.stopPropagation(); return this.openDetail(more.dataset.more); }
      const t = e.target.closest('[data-ent]'); if (t) { if (this._tileLp) { this._tileLp = false; return; } return this.primaryAction(t.dataset.ent); }
      const r = e.target.closest('[data-room]'); if (r) { if (!r.dataset.room) { this.setLevel('all'); return this.setFocus(null); } return this.setFocus(r.dataset.room); }
      const sc = e.target.closest('[data-scene]'); if (sc) { if (this._tileLp) { this._tileLp = false; return; } this.endPreview(); this.call('scene', 'turn_on', { entity_id: sc.dataset.scene }); this.toast(tr('panel.scene', {name: this.nameOf(sc.dataset.scene)})); return; }
      if (e.target.closest('#dBack')) this.closeDetail();
    });
    const c = this.$('stage');
    c.addEventListener('pointerdown', (e) => { this._down = { x: e.clientX, y: e.clientY, pick: this.stage.pick(e), started: performance.now() }; this._lastXY = null; if (this.mode === 'edit') { if(e.button!==0||e.isPrimary===false)return; this.editor.pointerDown(e); if(this.editor.drag){this.$('tip').hidden=true;this.stage.tween=null;this.stage.controls.enabled=false;this.stage.controls2.enabled=false;c.setPointerCapture(e.pointerId);}return; }
      clearTimeout(this._lp); this._lpFired = false; if (e.isPrimary === false) return;
      this._lp = setTimeout(() => { const d = this._down; if (!d || this.mode !== 'view') return; this._lpFired = true; this.inspectPick(d.pick); }, 520); }, {capture:true});
    c.addEventListener('contextmenu', (e) => { if (this.mode !== 'view') return; e.preventDefault(); clearTimeout(this._lp); this._lpFired = true; this.inspectPick(this.stage.pick(e)); });
    vp.addEventListener('contextmenu', (e) => { const entity = e.target.closest('[data-ent]'); if (entity) { e.preventDefault(); this.moreInfo(entity.dataset.ent); } const scene = e.target.closest('[data-scene]'); if (scene) { e.preventDefault(); this.previewScene(scene.dataset.scene); } });
    { let lt = null; vp.addEventListener('pointerdown', (e) => { const target = e.target.closest('[data-ent],[data-scene]'); if (!target || e.isPrimary === false) return; this._tileLp = false; lt = setTimeout(() => { lt = null; this._tileLp = true; navigator.vibrate?.(15); if (target.dataset.scene) this.previewScene(target.dataset.scene); else this.moreInfo(target.dataset.ent); }, 520); });
      ['pointerup', 'pointercancel', 'pointermove'].forEach((ev) => vp.addEventListener(ev, (e) => { if (ev === 'pointermove' && Math.abs(e.movementX) + Math.abs(e.movementY) < 4) return; clearTimeout(lt); lt = null; })); }
    c.addEventListener('pointermove', (e) => {
      if (this.stage.walk && this._down && !(this.mode === 'edit' && this.editor.drag)) { const l = this._lastXY || [this._down.x, this._down.y]; this.stage.walkLook(e.clientX - l[0], e.clientY - l[1]); this._lastXY = [e.clientX, e.clientY]; }
      if (this._down && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > 8) clearTimeout(this._lp); if (this.mode === 'edit' && this.editor.pointerMove(e)) return; this.hover(e); });
    c.addEventListener('pointerup', (e) => {
      const moved = this._down && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > 5; const was = this._down; this._down = null; clearTimeout(this._lp);
      if (this._lpFired) { this._lpFired = false; return; }
      if (this.mode === 'edit') return this.editor.pointerUp(e, moved);
      if (moved || !was) return;
      if (performance.now() - was.started >= 520) return this.inspectPick(was.pick);
      const p = was.pick;
      if (!p) return this.setFocus(null);
      if (p.type === 'device' || p.type === 'furniture') { const d = findItem(this.plan, p.id)?.item; if (d?.entity_id) { if (['camera', 'climate', 'media_player', 'image'].includes(d.entity_id.split('.')[0])) this.moreInfo(d.entity_id); else this.primaryAction(d.entity_id); } else this.inspectPick(p); }
      else if (p.type === 'opening') { const o = findItem(this.plan, p.id)?.item; if (o?.cover) this.primaryAction(o.cover); }
      else if (p.type === 'roofitem') { const o = (this.plan.site.roofItems || []).find((x) => x.id === p.id); if (o?.cover) this.primaryAction(o.cover); }
      else if (p.type === 'room') { const r = this.findRoom(p.level, p.id); if (r?.kind === 'outdoor' && polyArea(r.points) > 60) return this.setFocus(null); this.setFocus(this.focusRoom === p.id ? null : p.id, p.level); }
    });
    c.addEventListener('pointercancel', (e) => { if(this.mode==='edit'&&this.editor.drag)this.editor.pointerUp(e,true); clearTimeout(this._lp); this._down = null; this._lpFired = false; });
    c.addEventListener('pointerleave', () => { this.$('tip').hidden = true; this.hoverRoom = null; });
  }
  hover(e) {
    if (this.mode === 'edit') return this.editor.hoverUI?.move(e);
    if (e.pointerType === 'touch') return;
    const p = this.stage.pick(e, { furniture: this.mode === 'edit' }); const tip = this.$('tip');
    this.hoverRoom = p?.type === 'room' ? p.id : null;
    this.$('stage').style.cursor = p && (p.type !== 'room' || this.mode === 'view') ? 'pointer' : 'default';
    let html = null;
    if (p?.type === 'device') { const d = findItem(this.plan, p.id)?.item; if (d) html = `${esc(d.entity_id ? this.nameOf(d.entity_id) : KINDS[d.kind]?.label)}<small>${d.entity_id ? esc(this.stateText(d.entity_id)) : tr('panel.unlinked')}</small>`; }
    if (p?.type === 'opening') { const o = findItem(this.plan, p.id)?.item; const id = o?.cover || o?.contact; if (id) html = `${esc(this.nameOf(id))}<small>${esc(this.stateText(id))}${o.cover && this.mode === 'view' ? ' · ' + tr('panel.tapControl') : ''}</small>`; }
    if (p?.type === 'roofitem') { const o = (this.plan.site.roofItems || []).find((x) => x.id === p.id); const id = o?.cover || o?.contact; html = `${o?.kind === 'dormer' ? tr('panel.dormer') : tr('panel.roofWindow')}${id ? `<small>${esc(this.nameOf(id))}: ${esc(this.stateText(id))}</small>` : ''}`; }
    if (p?.type === 'furniture') { const f = findItem(this.plan, p.id)?.item; if (f) html = esc(this.editor.furnLabel(f)); }
    if (p?.type === 'xroof') { const x = (this.plan.site.roofs || []).find((r) => r.id === p.id); if (x) html = `${esc(x.name)}<small>${tr('panel.tapEdit')}</small>`; }
    if (html) { const r = this.getBoundingClientRect(); tip.innerHTML = html; tip.style.left = `${e.clientX - r.left + 14}px`; tip.style.top = `${e.clientY - r.top + 14}px`; tip.hidden = false; } else tip.hidden = true;
  }
  /* ---------- walkthrough ---------- */
  _wireWalk() {
    this.$('tWalk').addEventListener('click', () => (this.stage.walk ? this.stopWalk() : this.startWalk()));
    this.$('whExit').addEventListener('click', () => this.stopWalk());
    this.$('whUp').addEventListener('click', () => this.walkLevel(1));
    this.$('whDown').addEventListener('click', () => this.walkLevel(-1));
    this.$('whBody').addEventListener('change', (e) => { const v = Math.max(1, Math.min(2.2, +e.target.value || 1.75)); if (this.stage.walk) this.stage.walk.body = v; try { localStorage.setItem('hometwin-body', String(v)); } catch { /* ignore */ } });
    const keyOk = (e) => this.stage.walk && !e.target.closest?.('input,textarea,select') && !(e.composedPath?.()[0]?.closest?.('input,textarea,select'));
    window.addEventListener('keydown', (e) => { if (!keyOk(e)) return; const k = e.key.toLowerCase(); if (k === 'escape') return this.stopWalk(); if (['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { this.stage.walk.keys.add(k); e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (this.stage.walk) this.stage.walk.keys.delete(e.key.toLowerCase()); });
    window.addEventListener('blur', () => this.stage.walk?.keys.clear());
    // touch joystick
    const joy = this.$('joy'), knob = joy.querySelector('i'); let jid = null, c = null;
    joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); const r = joy.getBoundingClientRect(); c = [r.left + r.width / 2, r.top + r.height / 2]; e.stopPropagation(); });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId !== jid || !this.stage.walk) return; let dx = (e.clientX - c[0]) / 45, dy = (e.clientY - c[1]) / 45; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } this.stage.walk.joy = [dx, dy]; knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`; });
    const end = () => { jid = null; if (this.stage.walk) this.stage.walk.joy = [0, 0]; knob.style.transform = ''; };
    joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
  }
  startWalk() {
    const ls = this.plan.levels; if (!ls.length) return;
    let L = ls.find((l) => l.id === this.levelSel) || ls.find((l) => l.id === this.activeLevelId && this.levelSel !== 'all') || ls.find((l) => l.rooms.some((r) => r.kind === 'room')) || ls[0];
    const rooms = L.rooms.filter((r) => r.kind === 'room' || r.kind === 'garage');
    const r = (this.focusRoom && L.rooms.find((x) => x.id === this.focusRoom)) || rooms.sort((a, b) => polyArea(b.points) - polyArea(a.points))[0];
    const at = r ? roomCenter(r) : [0, 0];
    let body = 1.75; try { body = +localStorage.getItem('hometwin-body') || 1.75; } catch { /* ignore */ }
    this._walkPrev = this.levelSel; this.setLevel(L.id, false);
    this.stage.enterWalk(L, at, body); this.$('tWalk').setAttribute('aria-pressed', 'true');
    this.$('walkHud').hidden = false; this.$('whBody').value = body; this.$('whLevel').textContent = L.name;
    this.$('joy').hidden = !matchMedia('(pointer: coarse)').matches;
    this.$('whHint').textContent = matchMedia('(pointer: coarse)').matches ? tr('panel.walkTouch') : tr('panel.walkKeys');
    if (this.mode === 'view') this.setSheet('peek'); this.toast(tr('panel.walkWelcome'));
  }
  stopWalk() {
    if (!this.stage.walk) return; this.stage.exitWalk(); this.$('tWalk').setAttribute('aria-pressed', 'false');
    this.$('walkHud').hidden = true; this.$('joy').hidden = true; this.setLevel(this._walkPrev || 'all');
  }
  walkLevel(d) {
    const w = this.stage.walk; if (!w) return; const ls = this.plan.levels.filter((l) => l.rooms.length); const i = ls.findIndex((l) => l.id === w.levelId); const L = ls[i + d]; if (!L) return;
    w.levelId = L.id; this.setLevel(L.id, false); this.stage.rebuildAll(); this.stage.layout(); this.$('whLevel').textContent = L.name;
    if (!L.rooms.some((r) => pointInPolygon([w.x, w.z], r.points))) { const r = L.rooms.filter((x) => x.kind === 'room').sort((a, b) => polyArea(b.points) - polyArea(a.points))[0]; if (r) [w.x, w.z] = roomCenter(r); }
  }
  setSheet(s) { const vp = this.$('vp'); if (this._skipGripClick) return; vp.dataset.sheet = s; }
  // Long press / right click: Home Assistant's own detail dialog (all domains), own detail in the demo.
  moreInfo(entityId) {
    if (!entityId) return;
    if (this.hass?.demo) { this.openDetail(entityId); this.setSheet('half'); return; }
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }
  inspectPick(p) {
    const id = this.entityForPick(p);
    if (id) return this.moreInfo(id);
    if (p?.type === 'device' || (p?.type === 'furniture' && this.stage.levels.get(p.level)?.furnScreens?.get(p.id)?.screens.length)) this.toast(tr('panel.linkObject'));
  }
  entityAt(e) { return this.entityForPick(this.stage.pick(e)); }
  entityForPick(p) {
    if (!p) return null;
    if (p.type === 'device' || p.type === 'furniture') return findItem(this.plan, p.id)?.item?.entity_id || null;
    if (p.type === 'opening') { const o = findItem(this.plan, p.id)?.item; return o?.cover || o?.contact || null; }
    if (p.type === 'roofitem') { const o = (this.plan.site.roofItems || []).find((x) => x.id === p.id); return o?.cover || o?.contact || null; }
    return null;
  }
  setFocus(roomId, levelId) {
    this.roomCategory = 'all'; this.setSheet('half'); this.focusRoom = roomId; { const el = this.$('roomSel'); if (el) { const v = roomId ? [...el.options].find((o) => o.value.endsWith('|' + roomId))?.value : ''; if (v != null) el.value = v; } } this.closeDetail(false);
    if (roomId) { const l = this.plan.levels.find((x) => x.id === levelId && x.rooms.some((r) => r.id === roomId)) || this.plan.levels.find((x) => x.rooms.some((r) => r.id === roomId)); const r = l?.rooms.find((x) => x.id === roomId); if (!r) return;
      if (this.stage.walk) { const w = this.stage.walk; if (w.levelId !== l.id) { w.levelId = l.id; this.setLevel(l.id, false); this.stage.rebuildAll(); this.stage.layout(); this.$('whLevel').textContent = l.name; this.focusRoom = roomId; } [w.x, w.z] = roomCenter(r); }
      else { if (this.levelSel !== l.id) { this.setLevel(l.id, false); this.focusRoom = roomId; this.renderRoomSel(); } // only this storey, others hidden
        this.stage.frameRoom(l, r); } }
    else this.stage.frame(this.levelSel);
    this.scheduleUI();
  }
  stateText(id) {
    const s = this.states()[id]; if (!s) return tr('panel.unavailable'); const a = s.attributes, d = id.split('.')[0];
    if (s.state === 'unavailable') return tr('panel.unreachable');
    if (d === 'light') return s.state === 'on' ? (a.brightness != null ? `${Math.round(a.brightness / 2.55)} %` : tr('panel.on')) : tr('panel.off');
    if (d === 'cover') { if (a.current_position == null) return { open: tr('panel.open'), closed: tr('panel.closed'), opening: tr('panel.opening'), closing: tr('panel.closing') }[s.state] || s.state; const p = coverPercent(s, coverInverted(this.plan, id)); const t = a.current_tilt_position != null ? tr('panel.slatState', {percent: a.current_tilt_position}) : ''; return (p === 0 ? tr('panel.closed') : p === 100 ? tr('panel.open') : tr('panel.percentOpen', {percent: p})) + t; }
    if (d === 'binary_sensor') return ['motion', 'occupancy', 'presence'].includes(a.device_class) ? (s.state === 'on' ? tr('panel.detected') : tr('panel.clear')) : ['smoke', 'carbon_monoxide', 'gas', 'moisture', 'safety'].includes(a.device_class) ? (s.state === 'on' ? tr('panel.alarmUpper') : tr('panel.ok')) : s.state === 'on' ? tr('panel.open') : tr('panel.closed');
    if (d === 'sensor') return `${s.state} ${a.unit_of_measurement || ''}`;
    if (d === 'climate') return `${fmtT(a.current_temperature)} → ${fmtT(a.temperature)}${a.hvac_action === 'heating' ? ' · ' + tr('panel.heating') : a.hvac_action === 'cooling' ? ' · ' + tr('panel.cooling') : ''}`;
    if (d === 'media_player') return s.state === 'playing' ? `▶ ${a.media_title || tr('panel.playing')}` : { paused: tr('panel.paused'), idle: tr('panel.ready'), off: tr('panel.off'), on: tr('panel.on') }[s.state] || s.state;
    if (d === 'vacuum') return { docked: `${tr('panel.dock')}${a.battery_level != null ? ' · ' + a.battery_level + ' %' : ''}`, cleaning: tr('panel.cleaning'), returning: tr('panel.returning'), idle: tr('panel.ready'), paused: tr('panel.paused'), error: tr('panel.error') }[s.state] || s.state;
    if (d === 'lawn_mower') return { docked: tr('panel.dock'), mowing: tr('panel.mowing'), returning: tr('panel.returning'), paused: tr('panel.paused'), error: tr('panel.error') }[s.state] || s.state;
    if (d === 'camera') return { recording: tr('panel.recording'), streaming: tr('panel.liveState'), idle: tr('panel.ready') }[s.state] || s.state;
    if (d === 'fan') return s.state === 'on' ? (a.percentage != null ? `${a.percentage} %` : tr('panel.on')) : tr('panel.off');
    if (d === 'valve') return { open: tr('panel.open'), closed: tr('panel.closed') }[s.state] || s.state;
    return s.state === 'on' ? tr('panel.on') : s.state === 'off' ? tr('panel.off') : s.state;
  }
  primaryAction(id) {
    const d = id.split('.')[0], s = this.states()[id]; if (!s) return;
    if (['light', 'switch', 'fan', 'input_boolean'].includes(d)) this.call(d, 'toggle', { entity_id: id });
    else if (d === 'cover') this.call('cover', 'toggle', { entity_id: id });
    else if (d === 'media_player') this.call('media_player', 'media_play_pause', { entity_id: id });
    else if (d === 'vacuum') this.call('vacuum', s.state === 'cleaning' ? 'return_to_base' : 'start', { entity_id: id });
    else if (d === 'lawn_mower') this.call('lawn_mower', s.state === 'mowing' ? 'dock' : 'start_mowing', { entity_id: id });
    else if (d === 'valve') this.call('valve', s.state === 'open' ? 'close_valve' : 'open_valve', { entity_id: id });
    else if (d === 'scene') this.call('scene', 'turn_on', { entity_id: id });
    else this.openDetail(id);
  }
  boundEntities() {
    const out = []; const vis = this.plan.levels.filter((l) => this.stage.isVisible(l));
    for (const l of vis) {
      for (const d of l.devices) if (d.entity_id && this.states()[d.entity_id] && !out.some((x) => x.id === d.entity_id)) out.push({ id: d.entity_id, room: roomAt(l, d.pos)?.id, kind: d.kind, level: l });
      for (const f of l.furniture) if (f.entity_id && this.states()[f.entity_id] && !out.some(x => x.id === f.entity_id)) out.push({ id: f.entity_id, room: roomAt(l, f.pos)?.id, kind: 'tv', level: l });
      for (const o of l.openings) { const r = roomOfOpening(l, o)?.id; if (o.cover && this.states()[o.cover]) out.push({ id: o.cover, room: r, kind: o.type === 'garage' ? 'garage' : 'cover', level: l }); if (o.contact && this.states()[o.contact]) out.push({ id: o.contact, room: r, kind: 'contact', level: l }); }
    }
    return out;
  }
  entIcon(e) {
    const d = e.id.split('.')[0];
    if (e.kind === 'garage') return 'garage'; if (d === 'cover') return 'blinds';
    if (e.kind === 'contact') return this.states()[e.id]?.attributes?.device_class === 'window' ? 'window' : 'door';
    return KINDS[e.kind]?.icon || 'dots';
  }
  renderView() { renderRoomControls(this); }
  tileHtml(e) {
    const s = this.states()[e.id], d = e.id.split('.')[0], a = s.attributes;
    const on = (d === 'light' && s.state === 'on') || (['switch', 'fan', 'input_boolean'].includes(d) && s.state === 'on') || (d === 'media_player' && s.state === 'playing') || ['cleaning', 'mowing'].includes(s.state) || (d === 'climate' && a.hvac_action === 'heating') || (d === 'cover' && (coverPercent(s, coverInverted(this.plan, e.id)) ?? 0) > 0) || (d === 'valve' && s.state === 'open');
    const alert = d === 'binary_sensor' && s.state === 'on' && !['motion', 'occupancy', 'presence'].includes(a.device_class);
    const motion = d === 'binary_sensor' && s.state === 'on' && !alert;
    const cls = ['tile', on || motion ? 'on' : '', d === 'climate' ? 'heat' : '', alert ? 'alert' : ''].join(' ');
    const bar = d === 'light' && s.state === 'on' && a.brightness != null ? `<span class="bar"><i style="width:${Math.round(a.brightness / 2.55)}%"></i></span>` : d === 'cover' && a.current_position != null ? `<span class="bar"><i style="width:${coverPercent(s, coverInverted(this.plan, e.id))}%;background:var(--muted)"></i></span>` : '';
    const more = ['light', 'cover', 'climate', 'camera', 'media_player'].includes(d) ? `<span class="more" data-more="${e.id}" role="button" aria-label="${tr('panel.details')}">${icon('dots')}</span>` : '';
    return `<button class="${cls}" data-ent="${e.id}"><span class="ic">${icon(this.entIcon(e))}</span><span class="nm">${esc(a.friendly_name || e.id)}</span><span class="st">${esc(this.stateText(e.id))}</span>${more}${bar}</button>`;
  }
  openDetail(id) { this.setSheet('full'); this.detailEntity = id; this.$('vpList').hidden = true; this.$('vpDetail').hidden = false; this.renderDetail(true); }
  closeDetail(render = true) { this.detailEntity = null; this.$('vpDetail').hidden = true; this.$('vpList').hidden = false; if (this._camTimer) { clearInterval(this._camTimer); this._camTimer = null; } if (render) this.scheduleUI(); }
  renderDetail(full) {
    const id = this.detailEntity, s = this.states()[id]; const el = this.$('vpDetail'); if (!s) return;
    const a = s.attributes, d = id.split('.')[0];
    if (!full) { const act = this.shadowRoot.activeElement; if (act && el.contains(act) && act.type === 'range') { const o = el.querySelector('output'); if (o) o.textContent = this.stateText(id); return; } if (d === 'camera') return; }
    let body = '';
    if (d === 'light') {
      const pal = [[255, 147, 56], [255, 214, 170], [255, 90, 70], [255, 60, 160], [140, 90, 255], [70, 140, 255], [60, 220, 170]];
      const modes = a.supported_color_modes || ['brightness', 'color_temp', 'rgb'];
      const hasCT = modes.some((m) => ['color_temp'].includes(m)), hasRGB = modes.some((m) => ['rgb', 'hs', 'xy', 'rgbw', 'rgbww'].includes(m)), hasB = !modes.includes('onoff');
      body = `${hasB ? `<div class="field"><label for="dB">${tr('panel.brightness')} <output>${esc(this.stateText(id))}</output></label><input id="dB" type="range" min="1" max="255" value="${a.brightness ?? 255}"></div>` : ''}
        ${hasCT ? `<div class="field"><label for="dK">${tr('panel.white')} <output>${a.color_temp_kelvin ? a.color_temp_kelvin + ' K' : '—'}</output></label><input id="dK" type="range" min="${a.min_color_temp_kelvin || 2200}" max="${a.max_color_temp_kelvin || 6500}" step="100" value="${a.color_temp_kelvin || 3000}"></div>` : ''}
        ${hasRGB ? `<div class="field"><span class="lbl">${tr('panel.color')}</span><div class="swatches">${pal.map((c) => `<button data-rgb="${c.join(',')}" style="background:rgb(${c})" aria-label="${tr('panel.color')}"></button>`).join('')}</div></div>` : ''}
        <button class="btn" id="dToggle">${s.state === 'on' ? tr('panel.switchOff') : tr('panel.switchOn')}</button>`;
    } else if (d === 'cover') {
      const inv = coverInverted(this.plan, id);
      body = (a.current_position != null ? `<div class="field"><label for="dP">${tr('panel.position')} <output>${esc(this.stateText(id).split(' · ')[0])}</output></label><input id="dP" type="range" min="0" max="100" step="5" value="${coverPercent(s, inv)}"></div>` : `<p class="hint">${esc(this.stateText(id))}</p>`)
        + `<div class="actions"><button class="btn" data-cov="${inv ? 'close_cover' : 'open_cover'}">${tr('panel.openAction')}</button><button class="btn" data-cov="stop_cover">${tr('panel.stop')}</button><button class="btn" data-cov="${inv ? 'open_cover' : 'close_cover'}">${tr('panel.close')}</button></div>`
        + (a.current_tilt_position != null ? `<div class="field" style="margin-top:12px"><label for="dTilt">${tr('panel.slats')} <output>${a.current_tilt_position} %</output></label><input id="dTilt" type="range" min="0" max="100" step="5" value="${a.current_tilt_position}"></div><div class="actions"><button class="btn small" data-cov="open_cover_tilt">${tr('panel.slatsOpen')}</button><button class="btn small" data-cov="close_cover_tilt">${tr('panel.slatsClose')}</button></div>` : '');
    } else if (d === 'climate') {
      body = `<div class="big-temp"><button class="ibtn" data-dt="-0.5" aria-label="${tr('panel.cooler')}">−</button><div style="text-align:center"><b>${fmtT(a.temperature)}</b><div class="eid">${tr('panel.actual')} ${fmtT(a.current_temperature)} · ${{ heating: tr('panel.heating'), cooling: tr('panel.cooling'), idle: tr('panel.idle'), off: tr('panel.offState') }[a.hvac_action] || a.hvac_action || s.state}</div></div><button class="ibtn" data-dt="0.5" aria-label="${tr('panel.warmer')}">+</button></div>`;
    } else if (d === 'camera') {
      body = `<img class="camimg" id="camImg" alt="${tr('panel.liveImage')} ${esc(a.friendly_name)}"><p class="hint">${tr('panel.cameraHint')}</p>`;
    } else if (d === 'media_player') {
      body = `<p class="hint">${esc(a.media_title || '')}${a.media_artist ? ' · ' + esc(a.media_artist) : ''}</p><div class="actions"><button class="btn" data-mp="media_previous_track">◀◀</button><button class="btn" data-mp="media_play_pause">${s.state === 'playing' ? tr('panel.pause') : tr('panel.play')}</button><button class="btn" data-mp="media_next_track">▶▶</button></div>${a.volume_level != null ? `<div class="field"><label for="dV">${tr('panel.volume')} <output>${Math.round(a.volume_level * 100)} %</output></label><input id="dV" type="range" min="0" max="100" value="${Math.round(a.volume_level * 100)}"></div>` : ''}`;
    }
    el.innerHTML = `<div class="detail"><button class="btn" id="dBack" style="align-self:flex-start">${icon('back')}${tr('panel.back')}</button><div><h3>${esc(a.friendly_name || id)}</h3><div class="eid">${esc(id)}</div></div>${body}</div>`;
    guardRoomDetail(el, s, d);
    const q = (s2) => el.querySelector(s2);
    q('#dB')?.addEventListener('change', (e) => this.call('light', 'turn_on', { entity_id: id, brightness: +e.target.value }));
    q('#dK')?.addEventListener('change', (e) => this.call('light', 'turn_on', { entity_id: id, color_temp_kelvin: +e.target.value }));
    q('#dP')?.addEventListener('change', (e) => this.call('cover', 'set_cover_position', { entity_id: id, position: coverInverted(this.plan, id) ? 100 - +e.target.value : +e.target.value }));
    q('#dTilt')?.addEventListener('change', (e) => this.call('cover', 'set_cover_tilt_position', { entity_id: id, tilt_position: +e.target.value }));
    q('#dV')?.addEventListener('change', (e) => this.call('media_player', 'volume_set', { entity_id: id, volume_level: +e.target.value / 100 }));
    el.querySelectorAll('[data-rgb]').forEach((b) => b.addEventListener('click', () => this.call('light', 'turn_on', { entity_id: id, rgb_color: b.dataset.rgb.split(',').map(Number) })));
    q('#dToggle')?.addEventListener('click', () => this.call('light', 'toggle', { entity_id: id }));
    el.querySelectorAll('[data-cov]').forEach((b) => b.addEventListener('click', () => this.call('cover', b.dataset.cov, { entity_id: id })));
    el.querySelectorAll('[data-mp]').forEach((b) => b.addEventListener('click', () => this.call('media_player', b.dataset.mp, { entity_id: id })));
    el.querySelectorAll('[data-dt]').forEach((b) => b.addEventListener('click', () => this.call('climate', 'set_temperature', { entity_id: id, temperature: (a.temperature ?? 20) + +b.dataset.dt })));
    if (d === 'camera') this.startCamera(id);
  }
  startCamera(id) {
    const img = this.$('camImg'); if (!img) return; const pic = this.states()[id]?.attributes?.entity_picture; if (!pic) return;
    const base = this._hass.hassUrl ? this._hass.hassUrl(pic) : pic;
    if (pic.startsWith('data:') || pic.startsWith('blob:')) { img.src = pic; if (this._camTimer) clearInterval(this._camTimer); this._camTimer = setInterval(() => { const p = this.states()[id]?.attributes?.entity_picture; if (p) img.src = p; }, 1000); return; }
    img.onerror = () => { img.onerror = null; const tick = () => (img.src = `${base}${base.includes('?') ? '&' : '?'}t=${Date.now()}`); tick(); this._camTimer = setInterval(tick, 1000); };
    img.src = base.replace('/api/camera_proxy/', '/api/camera_proxy_stream/');
  }

  toast(t) { const el = this.$('toast'); el.textContent = t; el.hidden = false; clearTimeout(this._toastT); this._toastT = setTimeout(() => (el.hidden = true), 2400); }
}

function set(el, html) { if (el._h !== html) { el.innerHTML = html; el._h = html; } }
const short = (n) => { const m = { 'ground floor': 'GF', 'upper floor': 'UF', attic: 'AT', basement: 'B', erdgeschoss: 'EG', obergeschoss: 'OG', dachgeschoss: 'DG', keller: 'KG', untergeschoss: 'UG', kellergeschoss: 'KG' }; return m[String(n).toLowerCase()] || n; };
const fmtT = (v) => (v == null ? '—' : `${formatNumber(+v, {minimumFractionDigits: 1, maximumFractionDigits: 1})}°`);
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtCoord = (v, h) => (v == null ? '—' : `${formatNumber(Math.abs(v), {minimumFractionDigits: 3, maximumFractionDigits: 3})}° ${v >= 0 ? h : h === 'N' ? 'S' : 'W'}`);

const template = () => `
<canvas class="stage" id="stage" tabindex="0" aria-label="${tr('panel.canvas')}" data-i18n-aria-label="panel.canvas"></canvas>
<div class="labels" id="labels"></div>
<div class="labels" id="dims"></div>
<div class="tip" id="tip" hidden></div>
<header class="topbar">
  <button class="ibtn" id="menuBtn" title="${tr('panel.menu')}" data-i18n-title="panel.menu" data-ic="menu" hidden></button>
  <div class="brand"><i class="logo"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="ht-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f6fd8"/><stop offset="1" stop-color="#22408f"/></linearGradient><linearGradient id="ht-r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#79a6ff"/><stop offset="1" stop-color="#4b7be6"/></linearGradient><linearGradient id="ht-t" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#b9d0ff"/><stop offset="1" stop-color="#e8f0ff"/></linearGradient><radialGradient id="ht-g"><stop offset="0" stop-color="#ffd59a"/><stop offset=".45" stop-color="#ffb35c"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient></defs><path d="M10 27 L32 39.5 L32 60 L10 47.5 Z" fill="url(#ht-l)"/><path d="M32 39.5 L54 27 L54 47.5 L32 60 Z" fill="url(#ht-r)"/><path d="M32 39.5 L54 27 L43 21 Z" fill="#8fb4ff"/><path d="M10 27 L32 39.5 L43 21 L21 8.5 Z" fill="url(#ht-t)"/><path d="M21 8.5 L43 21" stroke="#ffffff" stroke-opacity=".7" stroke-width="1.2" stroke-linecap="round"/><circle cx="26.5" cy="24" r="9" fill="url(#ht-g)"/><circle cx="26.5" cy="24" r="3.1" fill="#fff4e3"/><path d="M21 50 L21 43.5 L26 46.3 L26 52.8 Z" fill="#ffb35c" fill-opacity=".85"/></svg></i><strong>HomeTwin</strong><span class="savestate edit-only" id="saveState" data-i18n="panel.saved">${tr('panel.saved')}</span></div>
  <div class="seg" id="levels" role="group" aria-label="${tr('panel.floor')}" data-i18n-aria-label="panel.floor"></div>

  <span class="spacer"></span>
  <div class="seg mode" role="group" aria-label="${tr('panel.mode')}" data-i18n-aria-label="panel.mode"><button id="mView" aria-pressed="true" data-ic="eye"><span class="wide" data-i18n="panel.view">${tr('panel.view')}</span></button><button id="mEdit" aria-pressed="false" data-ic="edit"><span class="wide" data-i18n="panel.edit">${tr('panel.edit')}</span></button></div>
 <button class="ibtn" id="tWalk" title="${tr('panel.walkTitle')}" data-i18n-title="panel.walkTitle" aria-label="${tr('panel.walk')}" data-i18n-aria-label="panel.walk" aria-pressed="false" data-ic="walk"></button>
  <button class="ibtn" id="tSun" title="${tr('panel.viewTitle')}" data-i18n-title="panel.viewTitle" aria-label="${tr('panel.view')}" data-i18n-aria-label="panel.view"></button>
  <button class="ibtn edit-only" id="tAI" aria-pressed="false" title="${tr('panel.assistant')}" data-i18n-title="panel.assistant" data-ic="sparkle"></button>
</header>
<aside class="panel popover" id="sunPop" hidden></aside>
<aside class="panel vp view-only" id="vp" aria-label="${tr('panel.controls')}" data-i18n-aria-label="panel.controls" data-sheet="half">
  <button class="sheet-grip" id="sheetGrip" aria-label="${tr('panel.resizeSheet')}" data-i18n-aria-label="panel.resizeSheet"><i></i></button>
  <div class="panel-head"><div class="rc-heading"><span id="roomContext"></span><h2 id="vpTitle"></h2><label class="roomsel view-only"><span class="sr" data-i18n="panel.room">${tr('panel.room')}</span><select id="roomSel" aria-label="${tr('panel.pickRoom')}" data-i18n-aria-label="panel.pickRoom"></select></label><div id="summary"></div></div><button id="roomCollapse" aria-label="${tr('panel.roomControl.collapse')}">↕</button></div>
  <div id="vpList" style="display:flex;flex-direction:column;min-height:0;flex:1">
    <div id="roomTabs" role="group" aria-label="${tr('panel.controls')}"></div>
    <div id="roomCategories"></div>
    <div class="panel-body" id="tileArea"></div>
  </div>
  <div class="panel-body" id="vpDetail" hidden></div>
</aside>
<aside class="panel lib edit-only" id="lib" aria-label="Editor" lang="${getLanguage()}">
  <div class="tabs" id="ltabs" style="padding-top:12px"><button data-ltab="tree" aria-pressed="true" data-i18n="panel.floors">${tr('panel.floors')}</button><button data-ltab="insert" aria-pressed="false" data-i18n="panel.insert">${tr('panel.insert')}</button>${ROBOT_PREVIEW_ENABLED ? `<button data-ltab="robots" aria-pressed="false" data-i18n="robots.tab">${tr('robots.tab')}</button>` : ''}</div>
  <div class="panel-body" id="lbody"></div>
</aside>
<aside class="panel insp edit-only" id="insp" aria-label="${tr('panel.properties')}" data-i18n-aria-label="panel.properties" hidden>
  <div class="panel-head"><h2 id="inspTitle" data-i18n="panel.properties">${tr('panel.properties')}</h2><button class="ibtn" id="inspClose" style="margin-left:auto;width:30px;height:30px" title="${tr('panel.deselect')}" data-i18n-title="panel.deselect" data-ic="x"></button></div>
  <div class="form" id="inspBody"></div>
</aside>
<aside class="panel agent edit-only" id="agent" aria-label="${tr('panel.assistant')}" data-i18n-aria-label="panel.assistant" hidden>
  <div class="panel-head"><h2 data-i18n="panel.assistant">${tr('panel.assistant')}</h2><span class="model" id="aiModel"></span><button class="ibtn" id="aiClose" style="width:30px;height:30px" title="${tr('panel.close')}" data-i18n-title="panel.close" data-ic="x"></button></div>
  <div class="msgs" id="msgs"></div>
  <form class="composer" id="aiForm">
    <input type="text" id="aiInput" placeholder="${tr('panel.prompt')}" data-i18n-placeholder="panel.prompt" autocomplete="off">
    <button class="btn primary" type="submit" id="aiSend" data-i18n="panel.send">${tr('panel.send')}</button>
    <label class="check" id="aiImgWrap" hidden><input type="checkbox" id="aiImg" data-i18n="panel.attachPlan"> ${tr('panel.attachPlan')}</label>
  </form>
</aside>
<div class="toolhint" id="toolHint" hidden></div>
<div class="edbar edit-only" id="edBar" role="toolbar" aria-label="${tr('panel.tools')}" data-i18n-aria-label="panel.tools"></div>
<div class="edstatus edit-only" id="edStatus"></div>
<div class="modal" id="modal" hidden><div class="card" id="modalCard"></div></div>
<div class="wzwrap" id="wizard" hidden></div>
<div class="wzwrap" id="robotAreas" hidden></div>
<div class="onboard" id="onboard" hidden></div>
<div class="toast" id="toast" hidden></div>
<div class="stats" id="stats" hidden></div>
<div class="sceneprev" id="scenePrev" hidden></div>
<div class="walkhud" id="walkHud" hidden>
  <div class="wh-row"><strong data-i18n="panel.walk">${tr('panel.walk')}</strong><span class="wh-lvl" id="whLevel"></span>
    <button class="btn small" id="whDown" title="${tr('panel.floorDown')}" data-i18n-title="panel.floorDown">▼</button><button class="btn small" id="whUp" title="${tr('panel.floorUp')}" data-i18n-title="panel.floorUp">▲</button>
    <label class="wh-body" data-i18n="panel.bodyHeight">${tr('panel.bodyHeight')} <input type="number" id="whBody" min="1" max="2.2" step="0.01"> m</label>
    <button class="btn small primary" id="whExit" data-i18n="panel.exit">${tr('panel.exit')}</button></div>
  <div class="wh-hint" id="whHint" data-i18n="panel.walkKeys">${tr('panel.walkKeys')}</div>
</div>
<div class="joy" id="joy" hidden><i></i></div>
`;

if (!customElements.get('hometwin-panel')) customElements.define('hometwin-panel', HomeTwinPanel);
