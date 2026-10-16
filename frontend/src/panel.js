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
  set panel(p) { this._panel = p; }

  /* ---------- HA access ---------- */
  states() { return this._hass?.states || {}; }
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
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>${TEMPLATE}`;
    this.$ = (id) => root.getElementById(id);
    root.querySelectorAll('[data-ic]').forEach((b) => b.insertAdjacentHTML('afterbegin', icon(b.dataset.ic)));
    this.setAttribute('mode', 'view');
    this.$('menuBtn').hidden = !this._narrow;
    this.stage = new Stage(this.$('stage'), this);
    this.editor = new Editor(this); this.agent = new Agent(this); this.wizard = new PlanWizard(this);
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
        const p = migrate(msg.plan); if (p) { this.setPlan(p); this.toast('Plan wurde auf einem anderen Gerät geändert'); }
      }, { type: 'hometwin/plan/subscribe' });
    } catch { /* older backend or demo */ }
    this.stage.start(); setTimeout(() => this.stage.riseAll(), 250);
    this._sunTimer = setInterval(() => this.updateSun(), 30000);
    if (!this.isAdmin()) this.$('mEdit').hidden = true;
    if (this._firstRun && this.isAdmin()) this.showOnboarding();
  }
  // First start: choose between the sample house, an empty plan or the floor-plan wizard.
  showOnboarding() {
    const o = this.$('onboard'); o.hidden = false;
    o.innerHTML = `<div class="ob" role="dialog" aria-modal="true" aria-labelledby="obT"><h2 id="obT">Willkommen bei HomeTwin</h2>
      <p class="lead">Dein Zuhause als 3D-Modell, mit Licht, Rollläden, Heizung und Sensoren aus Home Assistant. Wie möchtest du starten?</p>
      <div class="choices">
        <button class="choice primary" data-ob="plan">${icon('image')}<strong>Mit Bauplan starten</strong><span>Grundriss als Bild oder PDF laden; Räume werden erkannt oder nachgezeichnet.</span></button>
        <button class="choice" data-ob="empty">${icon('square')}<strong>Leer starten</strong><span>Räume selbst zeichnen, mit Maßen und Rechteck- oder Polygon-Werkzeug.</span></button>
        <button class="choice" data-ob="demo">${icon('home')}<strong>Beispielhaus ansehen</strong><span>Erst einmal ausprobieren. Später jederzeit leer neu beginnen.</span></button>
      </div></div>`;
    o.onclick = (e) => {
      const c = e.target.closest('[data-ob]')?.dataset.ob; if (!c) return;
      o.hidden = true; o.innerHTML = ''; this._firstRun = false;
      if (c === 'demo') { this.markDirty(); return; }
      this.setPlan(emptyPlan(), { frame: true }); this.markDirty(); this.setMode('edit');
      if (c === 'plan') this.wizard.open({ levelId: this.plan.levels[0].id });
      else this.toast('Wähle oben das Rechteck-Werkzeug und ziehe den ersten Raum auf.');
    };
  }
  connectedCallback() { this.stage?.start(); }
  disconnectedCallback() { this.stage?.stop(); }

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
  undo() { const s = this.undoStack.pop(); if (!s) return; this.redoStack.push(JSON.stringify(this.plan)); this.setPlan(JSON.parse(s)); this.markDirty(); this.editor.select(null); this.editor.renderBar(); }
  redo() { const s = this.redoStack.pop(); if (!s) return; this.undoStack.push(JSON.stringify(this.plan)); this.setPlan(JSON.parse(s)); this.markDirty(); this.editor.select(null); this.editor.renderBar(); }
  markDirty() {
    const voids = syncStairVoids(this.plan);
    if (voids.size) { for (const id of voids) this.stage.rebuildLevel(id); this.buildLabels(); if (this.mode === 'edit') this.editor.renderLeft(); }
    this.dirty = true; this.$('saveState').textContent = 'Ungespeichert';
    clearTimeout(this._saveT); this._saveT = setTimeout(() => this.save(), 900);
  }
  async save() {
    clearTimeout(this._saveT); this.$('saveState').textContent = 'Speichere …';
    try { await this._hass.callWS({ type: 'hometwin/plan/save', plan: this.plan, client_id: CLIENT_ID }); this.dirty = false; this.$('saveState').textContent = 'Gespeichert'; }
    catch (e) { this.$('saveState').textContent = 'Nicht gespeichert'; this.toast(`Speichern fehlgeschlagen: ${e.message || e.code || e}`); }
  }
  // Applies ops (from editor tools or the agent), rebuilding only what changed.
  apply(ops, { undo = true } = {}) {
    if (undo) this.pushUndo();
    const res = applyOps(this.plan, ops);
    this.stage.rebuildAll(); this.buildLabels(); this.renderLevels(); this.markDirty(); this.scheduleUI(true);
    return res;
  }

  applyLocal(op) {
    const res = applyOps(this.plan, [op])[0];
    if (!res.ok) { this.toast(res.error); return res; }
    const L = this.plan.levels.find((l) => l.id === op.level_id) || this.plan.levels[0];
    if (op.op === 'place_device') this.stage.addDevice(L.id, findItem(this.plan, res.id).item);
    else if (op.op === 'place_furniture') this.stage.addFurniture(L.id, findItem(this.plan, res.id).item);
    else { this.stage.rebuildLevel(L.id); this.buildLabels(); }
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
      if (k === 'perf') { this.perfMode = !this.perfMode; try { localStorage.setItem('hometwin-perf', this.perfMode ? '1' : '0'); } catch { /* ignore */ } this.stage.setPerf(this.perfMode); this.renderSunPop(); this.toast(this.perfMode ? 'Leistungsmodus an: geringere Auflösung, kein Leuchten' : 'Leistungsmodus aus'); return; }
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
    el.innerHTML = `<button data-level="all" aria-pressed="${this.levelSel === 'all'}" title="Ganzes Haus" aria-label="Ganzes Haus">${icon('home')}</button>`
      + [...ls].reverse().map((l) => `<button data-level="${l.id}" aria-pressed="${this.levelSel === l.id}" title="${esc(l.name)}">${esc(short(l.name))}</button>`).join('');
    this.renderRoomSel();
  }
  // Touch-friendly room picker (native select = OS picker on phones), grouped by storey.
  renderRoomSel() {
    const el = this.$('roomSel'); if (!el) return;
    const groups = [...this.plan.levels].reverse().map((l) => { const rs = l.rooms.filter((r) => r.kind !== 'void' && !(r.kind === 'outdoor' && polyArea(r.points) > 60)); return rs.length ? `<optgroup label="${esc(l.name)}">${rs.map((r) => `<option value="${l.id}|${r.id}" ${this.focusRoom === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</optgroup>` : ''; }).join('');
    el.innerHTML = `<option value="" ${this.focusRoom ? '' : 'selected'}>Alle Räume</option>${groups}`;
  }
  renderSunPop(full = true) {
    const p = this.$('sunPop'); const s = this._sun || { azimuth: 0, elevation: 0 }; const d = this.sunDate();
    const tg = (k, on, label) => `<button class="chip" data-toggle="${k}" aria-pressed="${on}">${label}</button>`;
    if (full) p.innerHTML = `<div class="panel-head" style="padding:0"><h2>Ansicht</h2></div>
      <div class="chips" style="padding:0">${tg('heat', this.heatOn, 'Temperatur-Heatmap')}${tg('xray', this.xray, 'Röntgen')}${this.plan.levels.length > 1 ? tg('explode', this.explode, 'Etagen aufklappen') : ''}${tg('perf', !!this.perfMode, 'Leistungsmodus')}</div>
      <div class="field"><span class="lbl">Kamera</span><div class="chips" style="padding:0">${[['N', 'Nord'], ['E', 'Ost'], ['S', 'Süd'], ['W', 'West'], ['top', 'Oben']].map(([k, l]) => `<button class="chip" data-cam="${k}">${l}</button>`).join('')}</div></div>
      <div class="panel-head" style="padding:6px 0 0"><h2>Sonnenstand</h2></div>
      <label class="check"><input type="checkbox" id="sunLive" ${this.timeLive ? 'checked' : ''}> Live (jetzt)</label>
      <div class="field"><label for="sunDate">Datum</label><input type="date" id="sunDate" value="${isoDate(d)}"></div>
      <div class="field"><label for="sunTime">Uhrzeit <output id="sunTimeOut"></output></label><input type="range" id="sunTime" min="0" max="1439" step="5" value="${d.getHours() * 60 + d.getMinutes()}"></div>
      <div class="sunline" id="sunLine"></div>
      <p class="hint">Standort ${fmtCoord(this.plan.site.lat, 'N')} ${fmtCoord(this.plan.site.lon, 'O')}, Nordrichtung ${Math.round(this.plan.site.north || 0)}°. Ändern im Editor beim Haus.</p>`;
    this.$('sunTimeOut').textContent = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    this.$('sunLine').textContent = `Azimut ${s.azimuth.toFixed(1)}° · Höhe ${s.elevation.toFixed(1)}°${s.source ? ' · ' + s.source : ''}`;
    if (!full && this.timeLive) { this.$('sunDate').value = isoDate(d); this.$('sunTime').value = d.getHours() * 60 + d.getMinutes(); }
  }
  sunDate() { return this.timeLive || !this.customTime ? new Date() : this.customTime; }
  updateSun() {
    const site = this.plan?.site; if (!site) return;
    let s; const sunEnt = this.states()['sun.sun'];
    // Always compute from the site when possible: sun.sun only refreshes every few minutes,
    // which shows near sunrise/sunset as a visible jump between live and preview.
    if (site.lat != null) s = { ...sunPosition(this.sunDate(), site.lat, site.lon), source: this.timeLive ? 'live' : 'Vorschau' };
    else if (sunEnt?.attributes?.azimuth != null) s = { azimuth: +sunEnt.attributes.azimuth, elevation: +sunEnt.attributes.elevation, source: 'sun.sun' };
    else s = { azimuth: 180, elevation: 35, source: 'ohne Standort' };
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
      if (!L.room) { const lit = L.level.devices.filter((d) => d.kind === 'light' && this.states()[d.entity_id]?.state === 'on').length; L.el.innerHTML = `<b>${esc(L.level.name)}</b><span>${lit ? `<span class="on">${lit} Lichter an</span>` : ''}</span>`; continue; }
      const t = this.roomTemp(L.level, L.room); const lit = this.roomDevices(L.level, L.room).filter((d) => d.kind === 'light' && this.states()[d.entity_id]?.state === 'on').length;
      L.el.innerHTML = `<b>${esc(L.room.name)}</b><span>${t != null ? t.toFixed(1) + '°' : ''}${lit ? ` <span class="on">· ${lit} an</span>` : ''}</span>`;
    }
  }
  onFrame() {
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
    for (const id of ['vp', 'lib']) { const el = this.$(id); el.addEventListener('pointerdown', () => (this._panelBusy = true)); const free = () => setTimeout(() => (this._panelBusy = false), 0); ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => el.addEventListener(ev, free)); }
    vp.addEventListener('click', (e) => {
      const more = e.target.closest('[data-more]'); if (more) { e.stopPropagation(); return this.openDetail(more.dataset.more); }
      const t = e.target.closest('[data-ent]'); if (t) { if (this._tileLp) { this._tileLp = false; return; } return this.primaryAction(t.dataset.ent); }
      const r = e.target.closest('[data-room]'); if (r) { if (!r.dataset.room) { this.setLevel('all'); return this.setFocus(null); } return this.setFocus(r.dataset.room); }
      const sc = e.target.closest('[data-scene]'); if (sc) { this.call('scene', 'turn_on', { entity_id: sc.dataset.scene }); this.toast(`Szene „${this.nameOf(sc.dataset.scene)}“`); return; }
      if (e.target.closest('#dBack')) this.closeDetail();
    });
    const c = this.$('stage');
    c.addEventListener('pointerdown', (e) => { this._down = { x: e.clientX, y: e.clientY }; this._lastXY = null; if (this.mode === 'edit') return this.editor.pointerDown(e);
      clearTimeout(this._lp); this._lpFired = false; if (e.isPrimary === false) return;
      this._lp = setTimeout(() => { const d = this._down; if (!d || this.mode !== 'view') return; const id = this.entityAt({ clientX: d.x, clientY: d.y }); if (id) { this._lpFired = true; navigator.vibrate?.(15); this.moreInfo(id); } }, 520); });
    c.addEventListener('contextmenu', (e) => { if (this.mode !== 'view') return; const id = this.entityAt(e); if (id) { e.preventDefault(); this.moreInfo(id); } });
    vp.addEventListener('contextmenu', (e) => { const t = e.target.closest('[data-ent]'); if (t) { e.preventDefault(); this.moreInfo(t.dataset.ent); } });
    { let lt = null; vp.addEventListener('pointerdown', (e) => { const t = e.target.closest('[data-ent]'); if (!t || e.pointerType === 'mouse') return; lt = setTimeout(() => { lt = null; this._tileLp = true; navigator.vibrate?.(15); this.moreInfo(t.dataset.ent); }, 520); });
      ['pointerup', 'pointercancel', 'pointermove'].forEach((ev) => vp.addEventListener(ev, (e) => { if (ev === 'pointermove' && Math.abs(e.movementX) + Math.abs(e.movementY) < 4) return; clearTimeout(lt); lt = null; })); }
    c.addEventListener('pointermove', (e) => {
      if (this.stage.walk && this._down && !(this.mode === 'edit' && this.editor.drag)) { const l = this._lastXY || [this._down.x, this._down.y]; this.stage.walkLook(e.clientX - l[0], e.clientY - l[1]); this._lastXY = [e.clientX, e.clientY]; }
      if (this._down && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > 8) clearTimeout(this._lp); if (this.mode === 'edit' && this.editor.pointerMove(e)) return; this.hover(e); });
    c.addEventListener('pointerup', (e) => {
      const moved = this._down && Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y) > 5; const was = this._down; this._down = null; clearTimeout(this._lp);
      if (this._lpFired) { this._lpFired = false; return; }
      if (this.mode === 'edit') return this.editor.pointerUp(e, moved);
      if (moved || !was) return;
      const p = this.stage.pick(e);
      if (!p) return this.setFocus(null);
      if (p.type === 'device') { const d = findItem(this.plan, p.id)?.item; if (d?.entity_id) { if (d.kind === 'camera' || ['climate'].includes(d.entity_id.split('.')[0])) this.openDetail(d.entity_id); else this.primaryAction(d.entity_id); } }
      else if (p.type === 'opening') { const o = findItem(this.plan, p.id)?.item; if (o?.cover) this.primaryAction(o.cover); }
      else if (p.type === 'roofitem') { const o = (this.plan.site.roofItems || []).find((x) => x.id === p.id); if (o?.cover) this.primaryAction(o.cover); }
      else if (p.type === 'room') { const r = this.findRoom(p.level, p.id); if (r?.kind === 'outdoor' && polyArea(r.points) > 60) return this.setFocus(null); this.setFocus(this.focusRoom === p.id ? null : p.id, p.level); }
    });
    c.addEventListener('pointerleave', () => { this.$('tip').hidden = true; this.hoverRoom = null; });
  }
  hover(e) {
    if (e.pointerType === 'touch') return;
    const p = this.stage.pick(e, { furniture: this.mode === 'edit' }); const tip = this.$('tip');
    this.hoverRoom = p?.type === 'room' ? p.id : null;
    this.$('stage').style.cursor = p && (p.type !== 'room' || this.mode === 'view') ? 'pointer' : 'default';
    let html = null;
    if (p?.type === 'device') { const d = findItem(this.plan, p.id)?.item; if (d) html = `${esc(d.entity_id ? this.nameOf(d.entity_id) : KINDS[d.kind]?.label)}<small>${d.entity_id ? esc(this.stateText(d.entity_id)) : 'nicht verknüpft'}</small>`; }
    if (p?.type === 'opening') { const o = findItem(this.plan, p.id)?.item; const id = o?.cover || o?.contact; if (id) html = `${esc(this.nameOf(id))}<small>${esc(this.stateText(id))}${o.cover && this.mode === 'view' ? ' · antippen zum Fahren' : ''}</small>`; }
    if (p?.type === 'roofitem') { const o = (this.plan.site.roofItems || []).find((x) => x.id === p.id); const id = o?.cover || o?.contact; html = `${o?.kind === 'dormer' ? 'Gaube' : 'Dachfenster'}${id ? `<small>${esc(this.nameOf(id))}: ${esc(this.stateText(id))}</small>` : ''}`; }
    if (p?.type === 'furniture') { const f = findItem(this.plan, p.id)?.item; if (f) html = esc(this.editor.furnLabel(f)); }
    if (p?.type === 'xroof') { const x = (this.plan.site.roofs || []).find((r) => r.id === p.id); if (x) html = `${esc(x.name)}<small>antippen zum Bearbeiten</small>`; }
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
    this.$('whHint').textContent = matchMedia('(pointer: coarse)').matches ? 'Joystick: gehen · Wischen: umsehen · Tippen: bedienen · lange drücken: Details' : 'W A S D / Pfeile: gehen · Shift: schneller · Ziehen: umsehen · Klick: bedienen · Esc: beenden';
    if (this.mode === 'view') this.setSheet('peek'); this.toast('Begehen: viel Spaß beim Rundgang!');
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
  entityAt(e) {
    const p = this.stage.pick(e); if (!p) return null;
    if (p.type === 'device') return findItem(this.plan, p.id)?.item?.entity_id || null;
    if (p.type === 'opening') { const o = findItem(this.plan, p.id)?.item; return o?.cover || o?.contact || null; }
    if (p.type === 'roofitem') { const o = (this.plan.site.roofItems || []).find((x) => x.id === p.id); return o?.cover || o?.contact || null; }
    return null;
  }
  setFocus(roomId, levelId) {
    this.focusRoom = roomId; { const el = this.$('roomSel'); if (el) { const v = roomId ? [...el.options].find((o) => o.value.endsWith('|' + roomId))?.value : ''; if (v != null) el.value = v; } } this.closeDetail(false);
    if (roomId) { const l = this.plan.levels.find((x) => x.id === levelId && x.rooms.some((r) => r.id === roomId)) || this.plan.levels.find((x) => x.rooms.some((r) => r.id === roomId)); const r = l?.rooms.find((x) => x.id === roomId); if (!r) return;
      if (this.stage.walk) { const w = this.stage.walk; if (w.levelId !== l.id) { w.levelId = l.id; this.setLevel(l.id, false); this.stage.rebuildAll(); this.stage.layout(); this.$('whLevel').textContent = l.name; this.focusRoom = roomId; } [w.x, w.z] = roomCenter(r); }
      else { if (this.levelSel !== l.id) { this.setLevel(l.id, false); this.focusRoom = roomId; this.renderRoomSel(); } // only this storey, others hidden
        this.stage.frameRoom(l, r); } }
    else this.stage.frame(this.levelSel);
    this.scheduleUI();
  }
  stateText(id) {
    const s = this.states()[id]; if (!s) return 'nicht verfügbar'; const a = s.attributes, d = id.split('.')[0];
    if (s.state === 'unavailable') return 'nicht erreichbar';
    if (d === 'light') return s.state === 'on' ? (a.brightness != null ? `${Math.round(a.brightness / 2.55)} %` : 'An') : 'Aus';
    if (d === 'cover') { if (a.current_position == null) return { open: 'Offen', closed: 'Geschlossen', opening: 'Öffnet', closing: 'Schließt' }[s.state] || s.state; const p = coverPercent(s, coverInverted(this.plan, id)); const t = a.current_tilt_position != null ? ` · Lamellen ${a.current_tilt_position} %` : ''; return (p === 0 ? 'Geschlossen' : p === 100 ? 'Offen' : `${p} % offen`) + t; }
    if (d === 'binary_sensor') return ['motion', 'occupancy', 'presence'].includes(a.device_class) ? (s.state === 'on' ? 'Erkannt' : 'Ruhig') : ['smoke', 'carbon_monoxide', 'gas', 'moisture', 'safety'].includes(a.device_class) ? (s.state === 'on' ? 'ALARM' : 'OK') : s.state === 'on' ? 'Offen' : 'Geschlossen';
    if (d === 'sensor') return `${s.state} ${a.unit_of_measurement || ''}`;
    if (d === 'climate') return `${fmtT(a.current_temperature)} → ${fmtT(a.temperature)}${a.hvac_action === 'heating' ? ' · heizt' : a.hvac_action === 'cooling' ? ' · kühlt' : ''}`;
    if (d === 'media_player') return s.state === 'playing' ? `▶ ${a.media_title || 'Wiedergabe'}` : { paused: 'Pausiert', idle: 'Bereit', off: 'Aus', on: 'An' }[s.state] || s.state;
    if (d === 'vacuum') return { docked: `Station${a.battery_level != null ? ' · ' + a.battery_level + ' %' : ''}`, cleaning: 'Saugt', returning: 'Fährt zurück', idle: 'Bereit', paused: 'Pausiert', error: 'Fehler' }[s.state] || s.state;
    if (d === 'lawn_mower') return { docked: 'Station', mowing: 'Mäht', returning: 'Fährt zurück', paused: 'Pausiert', error: 'Fehler' }[s.state] || s.state;
    if (d === 'camera') return { recording: 'Aufnahme', streaming: 'Live', idle: 'Bereit' }[s.state] || s.state;
    if (d === 'fan') return s.state === 'on' ? (a.percentage != null ? `${a.percentage} %` : 'An') : 'Aus';
    if (d === 'valve') return { open: 'Offen', closed: 'Geschlossen' }[s.state] || s.state;
    return s.state === 'on' ? 'An' : s.state === 'off' ? 'Aus' : s.state;
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
  renderView() {
    if (this.mode !== 'view' || !this.plan) return;
    const S = this.states(); const ents = this.boundEntities();
    const lights = ents.filter((e) => e.id.startsWith('light.')), lit = lights.filter((e) => S[e.id].state === 'on').length;
    const temps = this.plan.levels.flatMap((l) => l.rooms.filter((r) => r.kind !== 'outdoor').map((r) => this.roomTemp(l, r))).filter((x) => x != null && !isNaN(x));
    const avg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
    const open = ents.filter((e) => e.kind === 'contact' && S[e.id].state === 'on').length;
    const alarm = ents.some((e) => e.kind === 'smoke' && S[e.id].state === 'on');
    const pv = (this.plan.site.solar || []).filter((a) => a.entity_id && S[a.entity_id]).reduce((sum, a) => { const s = S[a.entity_id]; let v = parseFloat(s.state); if (/^w$/i.test(s.attributes.unit_of_measurement || '')) v /= 1000; return sum + (Number.isFinite(v) ? v : 0); }, null);
    set(this.$('summary'), (pv != null ? `<div class="stat"><b style="color:var(--lamp)">${pv.toFixed(1)}</b><span>kW Solar</span></div>` : '') + `<div class="stat"><b>${lit}/${lights.length}</b><span>Lichter an</span></div><div class="stat"><b>${avg != null ? avg.toFixed(1) + '°' : '—'}</b><span>Ø Innen</span></div><div class="stat"><b style="color:${open || alarm ? 'var(--warn)' : 'inherit'}">${alarm ? 'Alarm' : open}</b><span>${alarm ? 'Rauchmelder' : 'offen'}</span></div>`);
    const scenes = Object.keys(S).filter((id) => id.startsWith('scene.')).slice(0, 8);
    set(this.$('scenes'), scenes.map((id) => `<button class="chip scene" data-scene="${id}">${esc(this.nameOf(id))}</button>`).join(''));
    const rooms = this.plan.levels.filter((l) => this.stage.isVisible(l)).flatMap((l) => l.rooms.filter((r) => r.kind !== 'void').map((r) => ({ l, r })));
    set(this.$('roomChips'), `<button class="chip" data-room="" aria-pressed="${!this.focusRoom}">Alle Räume</button>` + rooms.filter(({ l, r }) => ents.some((e) => e.room === r.id && e.level === l)).map(({ r }) => `<button class="chip" data-room="${r.id}" aria-pressed="${this.focusRoom === r.id}">${esc(r.name)}</button>`).join(''));
    const fr = this.focusRoom && rooms.find((x) => x.r.id === this.focusRoom);
    this.$('vpTitle').textContent = fr ? fr.r.name : this.levelSel === 'all' ? this.plan.name : this.levelSel === 'roof' ? 'Dach' : this.plan.levels.find((l) => l.id === this.levelSel)?.name;
    let html = '';
    for (const { l, r } of rooms.filter((x) => !this.focusRoom || x.r.id === this.focusRoom)) {
      const list = ents.filter((e) => e.room === r.id && e.level === l && !e.id.startsWith('sensor.')); if (!list.length) continue;
      const t = this.roomTemp(l, r);
      html += `<div class="room-group"><h3>${esc(r.name)}<span>${t != null && !isNaN(t) ? t.toFixed(1) + ' °C' : ''}</span></h3><div class="tiles">`;
      for (const e of list) html += this.tileHtml(e);
      html += '</div></div>';
    }
    set(this.$('tileArea'), html || '<p class="hint">Noch keine Geräte verknüpft. Im Editor unter „Entitäten“ oder mit dem Assistenten platzieren.</p>');
    if (this.detailEntity) this.renderDetail();
  }
  tileHtml(e) {
    const s = this.states()[e.id], d = e.id.split('.')[0], a = s.attributes;
    const on = (d === 'light' && s.state === 'on') || (['switch', 'fan', 'input_boolean'].includes(d) && s.state === 'on') || (d === 'media_player' && s.state === 'playing') || ['cleaning', 'mowing'].includes(s.state) || (d === 'climate' && a.hvac_action === 'heating') || (d === 'cover' && (coverPercent(s, coverInverted(this.plan, e.id)) ?? 0) > 0) || (d === 'valve' && s.state === 'open');
    const alert = d === 'binary_sensor' && s.state === 'on' && !['motion', 'occupancy', 'presence'].includes(a.device_class);
    const motion = d === 'binary_sensor' && s.state === 'on' && !alert;
    const cls = ['tile', on || motion ? 'on' : '', d === 'climate' ? 'heat' : '', alert ? 'alert' : ''].join(' ');
    const bar = d === 'light' && s.state === 'on' && a.brightness != null ? `<span class="bar"><i style="width:${Math.round(a.brightness / 2.55)}%"></i></span>` : d === 'cover' && a.current_position != null ? `<span class="bar"><i style="width:${coverPercent(s, coverInverted(this.plan, e.id))}%;background:var(--muted)"></i></span>` : '';
    const more = ['light', 'cover', 'climate', 'camera', 'media_player'].includes(d) ? `<span class="more" data-more="${e.id}" role="button" aria-label="Details">${icon('dots')}</span>` : '';
    return `<button class="${cls}" data-ent="${e.id}"><span class="ic">${icon(this.entIcon(e))}</span><span class="nm">${esc(a.friendly_name || e.id)}</span><span class="st">${esc(this.stateText(e.id))}</span>${more}${bar}</button>`;
  }
  openDetail(id) { this.detailEntity = id; this.$('vpList').hidden = true; this.$('vpDetail').hidden = false; this.renderDetail(true); }
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
      body = `${hasB ? `<div class="field"><label for="dB">Helligkeit <output>${esc(this.stateText(id))}</output></label><input id="dB" type="range" min="1" max="255" value="${a.brightness ?? 255}"></div>` : ''}
        ${hasCT ? `<div class="field"><label for="dK">Weißton <output>${a.color_temp_kelvin ? a.color_temp_kelvin + ' K' : '—'}</output></label><input id="dK" type="range" min="${a.min_color_temp_kelvin || 2200}" max="${a.max_color_temp_kelvin || 6500}" step="100" value="${a.color_temp_kelvin || 3000}"></div>` : ''}
        ${hasRGB ? `<div class="field"><span class="lbl">Farbe</span><div class="swatches">${pal.map((c) => `<button data-rgb="${c.join(',')}" style="background:rgb(${c})" aria-label="Farbe"></button>`).join('')}</div></div>` : ''}
        <button class="btn" id="dToggle">${s.state === 'on' ? 'Ausschalten' : 'Einschalten'}</button>`;
    } else if (d === 'cover') {
      const inv = coverInverted(this.plan, id);
      body = (a.current_position != null ? `<div class="field"><label for="dP">Position (offen) <output>${esc(this.stateText(id).split(' · ')[0])}</output></label><input id="dP" type="range" min="0" max="100" step="5" value="${coverPercent(s, inv)}"></div>` : `<p class="hint">${esc(this.stateText(id))}</p>`)
        + `<div class="actions"><button class="btn" data-cov="${inv ? 'close_cover' : 'open_cover'}">Öffnen</button><button class="btn" data-cov="stop_cover">Stopp</button><button class="btn" data-cov="${inv ? 'open_cover' : 'close_cover'}">Schließen</button></div>`
        + (a.current_tilt_position != null ? `<div class="field" style="margin-top:12px"><label for="dTilt">Lamellen <output>${a.current_tilt_position} %</output></label><input id="dTilt" type="range" min="0" max="100" step="5" value="${a.current_tilt_position}"></div><div class="actions"><button class="btn small" data-cov="open_cover_tilt">Lamellen auf</button><button class="btn small" data-cov="close_cover_tilt">Lamellen zu</button></div>` : '');
    } else if (d === 'climate') {
      body = `<div class="big-temp"><button class="ibtn" data-dt="-0.5" aria-label="Kühler">−</button><div style="text-align:center"><b>${fmtT(a.temperature)}</b><div class="eid">Ist ${fmtT(a.current_temperature)} · ${{ heating: 'heizt', cooling: 'kühlt', idle: 'ruht', off: 'aus' }[a.hvac_action] || a.hvac_action || s.state}</div></div><button class="ibtn" data-dt="0.5" aria-label="Wärmer">+</button></div>`;
    } else if (d === 'camera') {
      body = `<img class="camimg" id="camImg" alt="Livebild ${esc(a.friendly_name)}"><p class="hint">Livebild über Home Assistant. Bei Kameras ohne MJPEG-Stream wird das Standbild jede Sekunde erneuert.</p>`;
    } else if (d === 'media_player') {
      body = `<p class="hint">${esc(a.media_title || '')}${a.media_artist ? ' · ' + esc(a.media_artist) : ''}</p><div class="actions"><button class="btn" data-mp="media_previous_track">◀◀</button><button class="btn" data-mp="media_play_pause">${s.state === 'playing' ? 'Pause' : 'Play'}</button><button class="btn" data-mp="media_next_track">▶▶</button></div>${a.volume_level != null ? `<div class="field"><label for="dV">Lautstärke <output>${Math.round(a.volume_level * 100)} %</output></label><input id="dV" type="range" min="0" max="100" value="${Math.round(a.volume_level * 100)}"></div>` : ''}`;
    }
    el.innerHTML = `<div class="detail"><button class="btn" id="dBack" style="align-self:flex-start">${icon('back')}Zurück</button><div><h3>${esc(a.friendly_name || id)}</h3><div class="eid">${esc(id)}</div></div>${body}</div>`;
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
const short = (n) => { const m = { erdgeschoss: 'EG', obergeschoss: 'OG', dachgeschoss: 'DG', keller: 'KG', untergeschoss: 'UG', kellergeschoss: 'KG' }; return m[String(n).toLowerCase()] || n; };
const fmtT = (v) => (v == null ? '—' : `${(+v).toFixed(1)}°`);
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtCoord = (v, h) => (v == null ? '—' : `${Math.abs(v).toFixed(3)}° ${v >= 0 ? h : h === 'N' ? 'S' : 'W'}`);

const TEMPLATE = `
<canvas class="stage" id="stage" tabindex="0" aria-label="3D-Modell des Hauses"></canvas>
<div class="labels" id="labels"></div>
<div class="labels" id="dims"></div>
<div class="tip" id="tip" hidden></div>
<header class="topbar">
  <button class="ibtn" id="menuBtn" title="Menü" data-ic="menu" hidden></button>
  <div class="brand"><i class="logo"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="ht-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f6fd8"/><stop offset="1" stop-color="#22408f"/></linearGradient><linearGradient id="ht-r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#79a6ff"/><stop offset="1" stop-color="#4b7be6"/></linearGradient><linearGradient id="ht-t" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#b9d0ff"/><stop offset="1" stop-color="#e8f0ff"/></linearGradient><radialGradient id="ht-g"><stop offset="0" stop-color="#ffd59a"/><stop offset=".45" stop-color="#ffb35c"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient></defs><path d="M10 27 L32 39.5 L32 60 L10 47.5 Z" fill="url(#ht-l)"/><path d="M32 39.5 L54 27 L54 47.5 L32 60 Z" fill="url(#ht-r)"/><path d="M32 39.5 L54 27 L43 21 Z" fill="#8fb4ff"/><path d="M10 27 L32 39.5 L43 21 L21 8.5 Z" fill="url(#ht-t)"/><path d="M21 8.5 L43 21" stroke="#ffffff" stroke-opacity=".7" stroke-width="1.2" stroke-linecap="round"/><circle cx="26.5" cy="24" r="9" fill="url(#ht-g)"/><circle cx="26.5" cy="24" r="3.1" fill="#fff4e3"/><path d="M21 50 L21 43.5 L26 46.3 L26 52.8 Z" fill="#ffb35c" fill-opacity=".85"/></svg></i><strong>HomeTwin</strong><span class="savestate edit-only" id="saveState">Gespeichert</span></div>
  <div class="seg" id="levels" role="group" aria-label="Etage"></div>
  <label class="roomsel view-only"><span class="sr">Raum</span><select id="roomSel" aria-label="Raum wählen"></select></label>
  <span class="spacer"></span>
  <div class="seg mode" role="group" aria-label="Modus"><button id="mView" aria-pressed="true" data-ic="eye"><span class="wide">Ansicht</span></button><button id="mEdit" aria-pressed="false" data-ic="edit"><span class="wide">Bearbeiten</span></button></div>
 <button class="ibtn" id="tWalk" title="Begehen: in Augenhöhe durchs Haus gehen" aria-label="Begehen" aria-pressed="false" data-ic="walk"></button>
  <button class="ibtn" id="tSun" title="Ansicht: Sonne, Kamera, Röntgen, Heatmap" aria-label="Ansicht"></button>
  <button class="ibtn edit-only" id="tAI" aria-pressed="false" title="Assistent" data-ic="sparkle"></button>
</header>
<aside class="panel popover" id="sunPop" hidden></aside>
<aside class="panel vp view-only" id="vp" aria-label="Steuerung" data-sheet="half">
  <button class="sheet-grip" id="sheetGrip" aria-label="Bereich vergrößern oder verkleinern"><i></i></button>
  <div class="panel-head"><h2 id="vpTitle">Zuhause</h2></div>
  <div id="vpList" style="display:flex;flex-direction:column;min-height:0;flex:1">
    <div class="summary" id="summary"></div>
    <div class="chips" id="scenes"></div>
    <div class="chips" id="roomChips"></div>
    <div class="panel-body" id="tileArea"></div>
  </div>
  <div class="panel-body" id="vpDetail" hidden></div>
</aside>
<aside class="panel lib edit-only" id="lib" aria-label="Editor" lang="de">
  <div class="tabs" id="ltabs" style="padding-top:12px"><button data-ltab="tree" aria-pressed="true">Ebenen</button><button data-ltab="insert" aria-pressed="false">Einfügen</button></div>
  <div class="panel-body" id="lbody"></div>
</aside>
<aside class="panel insp edit-only" id="insp" aria-label="Eigenschaften" hidden>
  <div class="panel-head"><h2 id="inspTitle">Eigenschaften</h2><button class="ibtn" id="inspClose" style="margin-left:auto;width:30px;height:30px" title="Auswahl aufheben" data-ic="x"></button></div>
  <div class="form" id="inspBody"></div>
</aside>
<aside class="panel agent edit-only" id="agent" aria-label="Assistent" hidden>
  <div class="panel-head"><h2>Assistent</h2><span class="model" id="aiModel"></span><button class="ibtn" id="aiClose" style="width:30px;height:30px" title="Schließen" data-ic="x"></button></div>
  <div class="msgs" id="msgs"></div>
  <form class="composer" id="aiForm">
    <input type="text" id="aiInput" placeholder="z. B. Ich möchte das Büro einbinden" autocomplete="off">
    <button class="btn primary" type="submit" id="aiSend">Senden</button>
    <label class="check" id="aiImgWrap" hidden><input type="checkbox" id="aiImg"> Grundriss-Bild mitsenden</label>
  </form>
</aside>
<div class="toolhint" id="toolHint" hidden></div>
<div class="edbar edit-only" id="edBar" role="toolbar" aria-label="Werkzeuge"></div>
<div class="edstatus edit-only" id="edStatus"></div>
<div class="modal" id="modal" hidden><div class="card" id="modalCard"></div></div>
<div class="wzwrap" id="wizard" hidden></div>
<div class="onboard" id="onboard" hidden></div>
<div class="toast" id="toast" hidden></div>
<div class="walkhud" id="walkHud" hidden>
  <div class="wh-row"><strong>Begehen</strong><span class="wh-lvl" id="whLevel"></span>
    <button class="btn small" id="whDown" title="Etage tiefer">▼</button><button class="btn small" id="whUp" title="Etage höher">▲</button>
    <label class="wh-body">Körpergröße <input type="number" id="whBody" min="1" max="2.2" step="0.01"> m</label>
    <button class="btn small primary" id="whExit">Beenden</button></div>
  <div class="wh-hint" id="whHint">W A S D / Pfeile: gehen · Shift: schneller · Ziehen: umsehen · Klick: bedienen · Esc: beenden</div>
</div>
<div class="joy" id="joy" hidden><i></i></div>
`;

if (!customElements.get('hometwin-panel')) customElements.define('hometwin-panel', HomeTwinPanel);
