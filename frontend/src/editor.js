import { automaticPlacement } from './object-placement.js';
// Editor: library, floor-plan drawing (with image underlay), structure, entity mapping, inspector.
import { icon } from './icons.js';
import { markStandaloneProjectorScreen } from './projector-migration.js';
import { esc } from './panel.js';
import { assetCatalog, CATALOG_CATS, renderThumbs, thumbFor, setThumb } from './thumbs.js';
import { FURNITURE, furnitureParams, stairInfo, registerLibrary, LIBRARY } from './furniture.js';
export const LIBRARY_URL = 'https://knaackee.github.io/hometwin/library/library.json';
import { KINDS, KIND_STYLES, deviceDefaults, entityMatchesKind, kindForEntity, FRAME_STYLES, FRAME_SIZES } from './devices.js';
import { SURFACES } from './kit.js';
import { findItem, roomAt, roomOfOpening, usedEntities, newId, newLevel, roomCenter, demoPlan, emptyPlan, migrate, computeElevations, slabThickness, plinthHeight, DEFAULT_BASEMENT_HEIGHT, DEFAULT_ROOM_HEIGHT } from './plan.js';
import { ROOF_TYPES, ROOF_COVERS, FACADES, FACADE_PRESETS, roofRect, rectCorners, rectAxes, HEAD_SHAPES, SOFFITS, BARGES, WOOD_PRESETS, DEFAULT_DETAILS, ROOF_STYLES, applyStyle, headSvg, ROOF_WINDOWS, newExtraRoof, rectOfPoints } from './roof.js';
import { isIndoor } from './house.js';
const WINDOW_PRESETS = { std: { w: 1.2, sill: 0.9, head: 2.2 }, floor: { w: 1.2, sill: 0.05, head: 2.2 }, terrace: { w: 2.0, sill: 0.02, head: 2.2 }, wide: { w: 2.4, sill: 0.5, head: 2.2 }, bath: { w: 0.8, sill: 1.4, head: 2.1 }, top: { w: 1.0, sill: 1.6, head: 2.2 } };
import { snapCfg, snapPoint, snap, distToSeg, projectOnSeg, edges, area as polyArea, bbox, r3, rectPoints, pointInPolygon } from './geometry.js';
import { importSh3d } from './sh3d.js';
import { placeItem, wallSegments, wallCfg } from './walls.js';
import { installTreeMenu } from './treemenu.js';
import { t, formatNumber } from './i18n.js';

const fmt = (v) => `${formatNumber(Math.round(v * 100) / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
const DOMAIN_LABEL = { light: 'editor.domain.light', cover: 'editor.domain.cover', climate: 'editor.domain.climate', sensor: 'editor.domain.sensor', binary_sensor: 'editor.domain.binarySensor', media_player: 'editor.domain.mediaPlayer', vacuum: 'editor.domain.vacuum', lawn_mower: 'editor.domain.lawnMower', camera: 'editor.domain.camera', fan: 'editor.domain.fan', valve: 'editor.domain.valve', switch: 'editor.domain.switch' };
const RELEVANT = ['light', 'cover', 'climate', 'sensor', 'binary_sensor', 'media_player', 'vacuum', 'lawn_mower', 'camera', 'image', 'fan', 'valve', 'switch'];
const KIND_ROOM = { room: 'editor.roomKind.room', garage: 'editor.roomKind.garage', outdoor: 'editor.roomKind.outdoor', void: 'editor.roomKind.void' };
const OPEN_TYPES = { door: 'editor.openingType.door', window: 'editor.openingType.window', garage: 'editor.openingType.garage', open: 'editor.openingType.open' };
const TOOLS = [['select', 'editor.tool.select', 'cursor'], ['rect', 'editor.tool.rect', 'square'], ['poly', 'editor.tool.poly', 'poly'], ['door', 'editor.tool.door', 'door'], ['window', 'editor.tool.window', 'window'], ['garage', 'editor.tool.garage', 'garage'], ['open', 'editor.tool.open', 'layers'], ['roofrect', 'editor.tool.roofrect', 'roof'], ['calibrate', 'editor.tool.calibrate', 'ruler']];
const TOOL_HINT = {
  rect: 'editor.toolHint.rect', poly: 'editor.toolHint.poly', door: 'editor.toolHint.door', window: 'editor.toolHint.window',
  garage: 'editor.toolHint.garage', open: 'editor.toolHint.open', calibrate: 'editor.toolHint.calibrate', roofrect: 'editor.toolHint.roofrect',
};

export class Editor {
  constructor(app) {
    this.app = app; this.left = 'tree'; this.insertSub = 'lib'; this.tool = 'select'; this.view2d = false;
    this.query = ''; this.treeQuery = ''; this.entFilter = { q: '', area: '*', domain: '', show: 'free' };
    this.expanded = new Set(['house']); this.closedSecs = new Set();
    this.catalog = assetCatalog(); this.images = new Map();
    const $ = app.$;
    $('ltabs').addEventListener('click', (e) => { const b = e.target.closest('[data-ltab]'); if (b) { this.left = b.dataset.ltab; this.renderLeft(); } });
    $('lbody').addEventListener('click', (e) => this.onLeftClick(e));
    $('lbody').addEventListener('dblclick', (e) => this.onLeftDbl(e));
    $('lbody').addEventListener('input', (e) => this.onLeftInput(e));
    installTreeMenu(this);
    $('lbody').addEventListener('dragstart', (e) => { const a = e.target.closest('[data-asset],[data-place]'); if (!a) return; e.dataTransfer.setData('text/plain', a.dataset.asset ? `asset:${a.dataset.asset}` : `entity:${a.dataset.place}`); e.dataTransfer.effectAllowed = 'copy'; });
    $('inspBody').addEventListener('change', (e) => this.onInspChange(e));
    $('inspBody').addEventListener('input', (e) => { if (e.target.type === 'range' || e.target.type === 'color') this.onInspChange(e, true); });
    $('inspBody').addEventListener('click', (e) => this.onInspClick(e));
    $('inspBody').addEventListener('toggle', (e) => { const d = e.target; if (d.tagName === 'DETAILS') d.open ? this.closedSecs.delete(d.dataset.sec) : this.closedSecs.add(d.dataset.sec); }, true);
    $('inspClose').addEventListener('click', () => this.select(null));
    $('edBar').addEventListener('click', (e) => {
      const toolButton = e.target.closest('[data-tool]'); if (toolButton) return this.setTool(toolButton.dataset.tool === this.tool && toolButton.dataset.tool !== 'select' ? 'select' : toolButton.dataset.tool);
      const v = e.target.closest('[data-view]'); if (v) return this.setView2d(v.dataset.view === '2d');
      if (e.target.closest('#tUndo')) app.undo(); if (e.target.closest('#tRedo')) app.redo();
      if (e.target.closest('#tPlan')) { this.app.wizard.open({ levelId: this.level.id }); }
    });
    $('edStatus').addEventListener('change', (e) => { if (e.target.id === 'snapOn') snapCfg.on = e.target.checked; if (e.target.id === 'wallOn') wallCfg.on = e.target.checked; if (e.target.id === 'winPre') this.windowPreset = e.target.value; });
    this.windowPreset = 'std';
    const c = $('stage');
    c.addEventListener('dragover', (e) => { if (app.mode === 'edit') { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    c.addEventListener('drop', (e) => {
      if (app.mode !== 'edit') return; e.preventDefault();
      const d = e.dataTransfer.getData('text/plain'); const fp = app.stage.floorPoint(e, this.level.id); if (!d || !fp) return;
      const pos = [r3(snap(fp[0])), r3(snap(fp[1]))];
      if (d.startsWith('asset:')) this.addAsset(d.slice(6), pos); else if (d.startsWith('entity:')) this.placeEntity(d.slice(7), pos);
    });
  }
  get level() { return this.app.activeLevel(); }

  open() { renderThumbs(this.catalog); this.loadRemoteLibrary(); this.renderLeft(); this.renderInspector(); this.renderBar(); this.renderStatus(); if (this.view2d) this.app.stage.setTopView(this.planLevel().id); this.roofHandles(); }
  refreshLanguage() {
    this.catalog = assetCatalog(); this.renderBar(); this.renderLeft(); this.renderInspector(); this.renderStatus();
    const hint = this.app.$('toolHint'); if (hint && TOOL_HINT[this.tool]) hint.textContent = t(TOOL_HINT[this.tool]);
  }
  close() { this.app.$('dims').replaceChildren(); this._dims = []; this.select(null); this.setTool('select'); this.app.stage.exitTopView(); this.app.stage.setPreview(null); this.app.$('agent').hidden = true; this.app.$('toolHint').hidden = true; }
  refresh(planChanged) { if (planChanged) { this.renderLeft(); this.renderInspector(); this.renderStatus(); } }
  onLevelChange() {
    const app = this.app, s = app.sel, sc = app.levelSel;
    if (sc === 'roof') { if (!['roof', 'solar', 'roofitem'].includes(s?.type)) this.select({ type: 'roof', id: 'roof' }); }
    else if (sc === 'all') { if (['roof', 'solar', 'roofitem', 'level'].includes(s?.type)) this.select(null); }
    else if ((s?.level && s.level !== sc) || ['roof', 'solar', 'roofitem'].includes(s?.type)) this.select(sc ? { type: 'level', id: sc, level: sc } : null);
    this.renderLeft(); this.renderStatus(); this.renderBar();
    if (app.stage.topView) { app.stage.exitTopView(); app.stage.setTopView(this.planLevel().id); }
    app.stage.layout(); this.roofHandles(); this.dimsDirty = true;
  }
  // The level the 2D view and the dimension labels refer to (top storey in roof scope).
  planLevel() { return this.app.levelSel === 'roof' ? this.app.stage.topLevel() || this.level : this.level; }
  roofRectNow() { const app = this.app; return roofRect(app.stage.topLevel(), app.plan.site.roof, isIndoor); }
  roofHandles() {
    const app = this.app, st = app.stage;
    if (app.mode !== 'edit' || app.levelSel !== 'roof' || app.plan.site.roof.type === 'none') { if (this._roofH) { st.setPreview(null); this._roofH = false; } return; }
    const R = this.roofRectNow(); if (!R) return; const T = st.topLevel(); const c = rectCorners(R);
    st.setHandles(T, this.tool === 'select' ? { id: '__roof', points: c } : null, true);
    if (st.topView) { st.setPreview(c, T.id, true); this._roofH = true; } else if (this._roofH) { st.setPreview(null); this._roofH = false; }
  }
  setView2d(on) {
    this.view2d = on; if (on) this.app.stage.setTopView(this.planLevel().id); else this.app.stage.exitTopView();
    this.markSelection(); this.dimsDirty = true; this.renderBar(); const s = this.app.sel; const L = this.level; this.app.stage.setHandles(L, s?.type === 'room' ? L.rooms.find((r) => r.id === s.id) : null); this.roofHandles();
  }
  setTool(tool) {
    if (tool !== 'select' && ['all', 'roof'].includes(this.app.levelSel)) this.app.setLevel(this.app.activeLevelId || this.app.plan.levels[0].id);
    this.tool = tool; this.draw = null; this.app.stage.setPreview(null); this.hover = null; this.app.stage.setMarks(null); this.dimsDirty = true;
    const hint = this.app.$('toolHint'); hint.hidden = !TOOL_HINT[tool]; hint.textContent = TOOL_HINT[tool] ? t(TOOL_HINT[tool]) : '';
    if (['rect', 'poly', 'calibrate', 'roofrect'].includes(tool) && !this.view2d) this.setView2d(true);
    if (tool !== 'select') this.app.stage.setHandles(null, null);
    this.renderBar(); this.renderStatus(); this.markSelection();
  }
  furnLabel(f) { return f.label || FURNITURE[f.type]?.label || f.type; }

  /* ---------------- toolbar & status ---------------- */
  renderBar() {
    const app = this.app;
    app.$('edBar').innerHTML = TOOLS.map(([k, key, ic]) => { const label = t(key); return `<button class="ibtn tb" data-tool="${k}" aria-pressed="${this.tool === k}" title="${label}" aria-label="${label}" ${k === 'calibrate' && !this.level?.underlay ? 'disabled' : ''}>${icon(ic)}</button>`; }).join('')
      + `<span class="sep"></span><button class="ibtn tb" id="tPlan" title="${t('editor.toolbar.floorPlanAssistantTitle')}" aria-label="${t('editor.toolbar.floorPlanAssistant')}">${icon('image')}</button>`
      + `<span class="sep"></span><div class="seg"><button data-view="3d" aria-pressed="${!this.view2d}">3D</button><button data-view="2d" aria-pressed="${this.view2d}">2D</button></div>`
      + `<span class="sep"></span><button class="ibtn tb" id="tUndo" title="${t('editor.toolbar.undoTitle')}" aria-label="${t('editor.toolbar.undo')}" ${app.undoStack.length ? '' : 'disabled'}>${icon('undo')}</button><button class="ibtn tb" id="tRedo" title="${t('editor.toolbar.redoTitle')}" aria-label="${t('editor.toolbar.redo')}" ${app.redoStack.length ? '' : 'disabled'}>${icon('redo')}</button>`;
  }
  renderStatus() {
    const L = this.level; if (!L) return;
    const tool = TOOLS.find((x) => x[0] === this.tool)?.[1];
    this.app.$('edStatus').innerHTML = `<span><b>${esc(L.name)}</b> · +${formatNumber(L.elevation, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m</span><span>${tool ? esc(t(tool).replace(/ \(.*\)/, '')) : ''}</span>${this.tool === 'window' ? `<select id="winPre" class="fsel" style="width:auto">${Object.entries(WINDOW_PRESETS).map(([k]) => `<option value="${k}" ${this.windowPreset === k ? 'selected' : ''}>${t(`editor.windowPreset.${k}`)}</option>`).join('')}</select>` : ''}<label class="check"><input type="checkbox" id="snapOn" ${snapCfg.on ? 'checked' : ''}> ${t('editor.status.snap')}</label><label class="check" title="${t('editor.status.wallSnapTitle')}"><input type="checkbox" id="wallOn" ${wallCfg.on ? 'checked' : ''}> ${t('editor.status.wallSnap')}</label><span id="stCoord" class="sunline"></span>`;
  }

  /* ---------------- left panel ---------------- */
  renderLeft() {
    const app = this.app, b = app.$('lbody'), L = this.level; if (!L) return;
    app.$('ltabs').querySelectorAll('[data-ltab]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.ltab === this.left));
    if (this.left === 'tree') { b.innerHTML = this.treeHtml(); const s = b.querySelector('#treeSearch'); if (this._focusTree) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); this._focusTree = false; } return; }
    const seg = `<div class="seg" style="display:flex;margin:0 0 8px">${[['lib', 'editor.insert.objects'], ['ents', 'editor.insert.entities']].map(([k, key]) => `<button data-sub="${k}" aria-pressed="${this.insertSub === k}" style="flex:1">${t(key)}</button>`).join('')}</div>`;
    if (this.insertSub === 'lib') {
      const q = this.query.toLowerCase();
      const items = this.catalog.filter((a) => !q || a.label.toLowerCase().includes(q) || a.cat.toLowerCase().includes(q));
      b.innerHTML = seg + `<p class="hint" style="margin:0 0 8px">${icon('sparkle')} ${t('editor.library.summary', { count: LIBRARY.size, state: this._libState === 'loading' ? t('editor.library.loading') : this._libState === 'ok' ? t('editor.library.current') : '', contribute: `<a href="https://github.com/knaackee/hometwin/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener">${t('editor.library.contribute')}</a>` })}</p><div class="search">${icon('search')}<input id="libSearch" type="search" placeholder="${t('editor.library.searchPlaceholder')}" value="${esc(this.query)}"></div>` +
        CATALOG_CATS.map((c) => { const list = items.filter((a) => a.cat === c); return list.length ? `<div class="cat">${c}</div><div class="assets">${list.map((a) => `<button class="asset" draggable="true" data-asset="${a.key}" title="${t('editor.common.tapOrDrag')}">${thumbFor(a.key) ? `<img src="${thumbFor(a.key)}" alt="" draggable="false">` : `<span class="ph">${icon('sofa')}</span>`}${esc(a.label)}</button>`).join('')}</div>` : ''; }).join('') +
        `<p class="hint" style="margin-top:12px">${t('editor.library.instructions')}</p>`;
      const s = b.querySelector('#libSearch'); if (this._focusSearch) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); this._focusSearch = false; }
      return;
    }
    const S = app.states(); const used = usedEntities(app.plan);
    const relevant = Object.keys(S).filter((id) => RELEVANT.includes(id.split('.')[0]) && (!['sensor', 'binary_sensor'].includes(id.split('.')[0]) || kindForEntity(S[id]) || ['door', 'window', 'garage_door', 'opening'].includes(S[id].attributes.device_class)) && (id.split('.')[0] !== 'switch' || app.areaOf(id)));
    const F = this.entFilter, q = F.q.trim().toLowerCase();
    const areas = [...new Set(relevant.map((id) => app.areaOf(id) || ''))].sort((a, c) => app.areaName(a).localeCompare(app.areaName(c)));
    const domains = [...new Set(relevant.map((id) => id.split('.')[0]))].sort();
    const match = (id) => (!q || id.toLowerCase().includes(q) || app.nameOf(id).toLowerCase().includes(q)) && (F.area === '*' || (app.areaOf(id) || '') === F.area) && (!F.domain || id.startsWith(F.domain + '.'));
    const free = relevant.filter((id) => !used.has(id) && match(id)), placed = relevant.filter((id) => used.has(id) && match(id));
    const byArea = {}; for (const id of free) (byArea[app.areaOf(id) || ''] ||= []).push(id);
    const row = (id, ok) => ok ? `<button class="listrow" data-selent="${id}"><span class="dot ok"></span><span class="nm">${esc(app.nameOf(id))}<br><small>${esc(id)}</small></span></button>` : `<button class="listrow" draggable="true" data-place="${id}" title="${t('editor.common.tapOrDrag')}"><span class="dot no"></span><span class="nm">${esc(app.nameOf(id))}<br><small>${esc(id)}</small></span>${icon('plus')}</button>`;
    b.innerHTML = seg + `<div class="search">${icon('search')}<input id="entSearch" type="search" placeholder="${t('editor.entities.searchPlaceholder')}" value="${esc(F.q)}"></div>
      <div class="row2" style="margin:6px 0 4px"><select id="entArea" aria-label="${t('editor.common.area')}" class="fsel"><option value="*">${t('editor.entities.allAreas')}</option>${areas.map((a) => `<option value="${a}" ${F.area === a ? 'selected' : ''}>${esc(a ? app.areaName(a) : t('editor.entities.noArea'))}</option>`).join('')}</select>
      <select id="entDomain" aria-label="${t('editor.common.type')}" class="fsel"><option value="">${t('editor.entities.allTypes')}</option>${domains.map((d) => `<option value="${d}" ${F.domain === d ? 'selected' : ''}>${DOMAIN_LABEL[d] ? t(DOMAIN_LABEL[d]) : d}</option>`).join('')}</select></div>
      <div class="seg" style="display:flex;margin:4px 0 6px">${[['free', t('editor.entities.freeCount', { count: free.length })], ['placed', t('editor.entities.placedCount', { count: placed.length })], ['all', t('editor.common.all')]].map(([k, l]) => `<button data-show="${k}" aria-pressed="${F.show === k}" style="flex:1">${l}</button>`).join('')}</div>`
      + (F.show !== 'placed' ? (free.length ? Object.entries(byArea).sort((x, y) => app.areaName(x[0]).localeCompare(app.areaName(y[0]))).map(([a, ids]) => `<div class="cat" style="margin-top:8px;text-transform:none;letter-spacing:0">${esc(a ? app.areaName(a) : t('editor.entities.noArea'))} · ${ids.length}</div>` + ids.map((id) => row(id, false)).join('')).join('') + `<button class="btn" data-act="askAI" style="margin-top:10px">${icon('sparkle')}${t('editor.entities.placeWithAssistant')}</button>` : `<p class="hint">${t('editor.entities.noneFree')}</p>`) : '')
      + (F.show !== 'free' ? `<div class="cat">${t('editor.entities.placedCount', { count: placed.length })}</div>` + placed.map((id) => row(id, true)).join('') : '');
    const es = b.querySelector('#entSearch'); if (this._focusEnt) { es.focus(); es.setSelectionRange(es.value.length, es.value.length); this._focusEnt = false; }
  }
  treeHtml() {
    const app = this.app, p = app.plan, sel = app.sel, q = this.treeQuery.trim().toLowerCase();
    const isSel = (type, id) => (type === 'house' ? !sel : (sel?.type === type && sel.id === id) || (this.multi || []).some((x) => x.id === id));
    const row = ({ type, id, level = '', depth, ic, label, meta = '', exp = null, eye = null, lock = null }) => `<div class="trow${isSel(type, id) ? ' sel' : ''}" style="--d:${depth}" data-pick="${type}" data-id="${id}" data-level="${level}">`
      + (exp === null ? '<span class="chev"></span>' : `<button class="chev" data-exp="${type}:${id}" aria-label="${t(exp ? 'editor.tree.collapse' : 'editor.tree.expand')}">${exp ? '▾' : '▸'}</button>`)
      + `<span class="tic">${icon(ic)}</span><span class="nm">${esc(label)}</span>${meta ? `<small>${esc(meta)}</small>` : ''}`
      + (lock === null ? '' : `<button class="tbtn${lock ? ' on' : ''}" data-lock="${type}:${id}" title="${t(lock ? 'editor.tree.unlock' : 'editor.tree.lock')}" aria-label="${t('editor.tree.lock')}">${icon(lock ? 'lock' : 'unlock')}</button>`)
      + (eye === null ? '' : `<button class="tbtn${eye ? '' : ' on'}" data-eye="${type}:${id}" title="${t(eye ? 'editor.tree.hide' : 'editor.tree.show')}" aria-label="${t('editor.tree.visibility')}">${icon(eye ? 'eye' : 'eyeoff')}</button>`) + '</div>';
    const devLabel = (d) => (d.entity_id ? app.nameOf(d.entity_id) : KIND_STYLES[d.kind]?.[d.style] || KINDS[d.kind]?.label || d.kind);
    const itemRows = (L, depth, devs, furn, ops) => ops.map((o) => row({ type: 'opening', id: o.id, level: L.id, depth, ic: o.type === 'window' ? 'window' : o.type === 'garage' ? 'garage' : 'door', label: t(OPEN_TYPES[o.type]), meta: [o.cover, o.contact].filter(Boolean).length ? t('editor.common.linkedBullet') : '' })).join('')
      + devs.map((d) => row({ type: 'device', id: d.id, level: L.id, depth, ic: KINDS[d.kind]?.icon || 'bulb', label: devLabel(d), meta: d.entity_id ? '' : t('editor.common.unassigned'), eye: !d.hidden, lock: !!d.locked })).join('')
      + furn.map((f) => row({ type: 'furniture', id: f.id, level: L.id, depth, ic: 'sofa', label: this.furnLabel(f), eye: !f.hidden, lock: !!f.locked })).join('');
    let h = `<div class="search">${icon('search')}<input id="treeSearch" type="search" placeholder="${t('editor.tree.searchPlaceholder')}" value="${esc(this.treeQuery)}"></div><div class="tree">`;
    if (q) {
      for (const L of [...p.levels].reverse()) {
        const m = (s) => String(s || '').toLowerCase().includes(q);
        const rooms = L.rooms.filter((r) => m(r.name)), devs = L.devices.filter((d) => m(devLabel(d)) || m(d.entity_id)), furn = L.furniture.filter((f) => m(this.furnLabel(f)));
        if (!rooms.length && !devs.length && !furn.length) continue;
        h += `<div class="cat">${esc(L.name)}</div>` + rooms.map((r) => row({ type: 'room', id: r.id, level: L.id, depth: 0, ic: r.kind === 'outdoor' ? 'tree' : 'square', label: r.name, meta: `${formatNumber(polyArea(r.points), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m²` })).join('') + itemRows(L, 0, devs, furn, []);
      }
      return h + '</div>';
    }
    h += row({ type: 'house', id: 'house', depth: 0, ic: 'home', label: p.name || t('editor.common.house'), meta: t('editor.tree.houseMeta') });
    const roofExp = this.expanded.has('roof:roof');
    h += row({ type: 'roof', id: 'roof', depth: 1, ic: 'roof', label: t('editor.common.roof'), meta: ROOF_TYPES[p.site.roof?.type] || '', exp: p.site.solar.length || (p.site.roofItems || []).length ? roofExp : null });
    if (roofExp) h += p.site.solar.map((a, i) => row({ type: 'solar', id: a.id, depth: 2, ic: 'sun', label: `PV-Feld ${i + 1}`, meta: `${a.rows}×${a.cols}` })).join('');
    h += (p.site.roofs || []).map((x) => row({ type: 'xroof', id: x.id, depth: 1, ic: 'roof', label: x.name, meta: `${ROOF_TYPES[x.type] || ''}${x.posts ? ' · Pfosten' : ''}` })).join('');
    if (roofExp) h += (p.site.roofItems || []).map((a, i) => row({ type: 'roofitem', id: a.id, depth: 2, ic: 'window', label: `${t(a.kind === 'dormer' ? 'editor.common.dormer' : 'editor.common.roofWindow')} ${i + 1}`, meta: `${Math.round(a.w * 100)}×${Math.round((a.kind === 'dormer' ? a.dormer?.h ?? 1.3 : a.h) * 100)}` })).join('');
    for (const L of [...p.levels].reverse()) {
      const lexp = this.expanded.has(`level:${L.id}`) || (L.id === this.level.id && !this.expanded.has(`closed:${L.id}`));
      h += row({ type: 'level', id: L.id, level: L.id, depth: 1, ic: 'layers', label: L.name, meta: `+${formatNumber(L.elevation, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`, exp: lexp, eye: !app.hiddenLevels.has(L.id) });
      if (!lexp) continue;
      const inRoom = (r) => (it) => roomAt(L, it.pos)?.id === r.id;
      for (const r of L.rooms.filter((x) => x.kind !== 'void').sort((a, b) => (a.kind === 'outdoor') - (b.kind === 'outdoor') || a.name.localeCompare(b.name))) {
        const ops = L.openings.filter((o) => o.type !== 'open' && roomOfOpening(L, o)?.id === r.id), devs = L.devices.filter(inRoom(r)), furn = L.furniture.filter(inRoom(r));
        const rexp = this.expanded.has(`room:${r.id}`), n = ops.length + devs.length + furn.length;
        h += row({ type: 'room', id: r.id, level: L.id, depth: 2, ic: r.kind === 'outdoor' ? 'tree' : r.kind === 'garage' ? 'garage' : 'square', label: r.name, meta: `${formatNumber(polyArea(r.points), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m²${r.area_id ? '' : ` · ${t('editor.entities.noArea')}`}`, exp: n ? rexp : null });
        if (rexp) h += itemRows(L, 3, devs, furn, ops);
      }
      for (const r of L.rooms.filter((x) => x.kind === 'void')) h += row({ type: 'room', id: r.id, level: L.id, depth: 2, ic: 'square', label: r.name, meta: t('editor.tree.void') });
      const loose = (it) => !roomAt(L, it.pos); const ld = L.devices.filter(loose), lf = L.furniture.filter(loose);
      if (ld.length || lf.length) { const oexp = this.expanded.has(`loose:${L.id}`); h += row({ type: 'loose', id: L.id, level: L.id, depth: 2, ic: 'dots', label: t('editor.tree.outsideRooms'), meta: `${ld.length + lf.length}`, exp: oexp }); if (oexp) h += itemRows(L, 3, ld, lf, []); }
      if (!L.rooms.length) h += `<p class="hint" style="padding-left:52px">${t('editor.tree.noRooms')}</p>`;
    }
    return h + '</div>';
  }
  onLeftInput(e) {
    const target = e.target;
    if (target.id === 'treeSearch') { this.treeQuery = target.value; this._focusTree = true; this.renderLeft(); }
    if (target.id === 'libSearch') { this.query = target.value; this._focusSearch = true; this.renderLeft(); }
    if (target.id === 'entSearch') { this.entFilter.q = target.value; this._focusEnt = true; this.renderLeft(); }
    if (target.id === 'entArea' || target.id === 'entDomain') { this.entFilter[target.id === 'entArea' ? 'area' : 'domain'] = target.value; this.renderLeft(); }
  }
  onLeftClick(e) {
    const app = this.app, g = (s) => e.target.closest(s);
    const sub = g('[data-sub]'); if (sub) { this.insertSub = sub.dataset.sub; this.renderLeft(); return; }
    const a = g('[data-asset]'); if (a) return this.addAsset(a.dataset.asset);
    const sh = g('[data-show]'); if (sh) { this.entFilter.show = sh.dataset.show; this.renderLeft(); return; }
    const pl = g('[data-place]'); if (pl) return this.placeEntity(pl.dataset.place);
    const se = g('[data-selent]'); if (se) { const hit = this.findByEntity(se.dataset.selent); if (hit) { if (hit.level.id !== this.level.id) app.setLevel(hit.level.id); this.select({ type: hit.type, id: hit.item.id, level: hit.level.id }); } return; }
    if (g('[data-act="askAI"]')) return app.agent.open(t('editor.ai.placeEntitiesPrompt'));
    const ex = g('[data-exp]'); if (ex) { const k = ex.dataset.exp; const [type, id] = k.split(':'); const open = ex.textContent.includes('▾'); if (open) { this.expanded.delete(k); if (type === 'level') this.expanded.add(`closed:${id}`); } else { this.expanded.add(k); this.expanded.delete(`closed:${id}`); } this.renderLeft(); return; }
    const eye = g('[data-eye]'); if (eye) { this.toggleFlag(eye.dataset.eye, 'hidden'); return; }
    const lk = g('[data-lock]'); if (lk) { this.toggleFlag(lk.dataset.lock, 'locked'); return; }
    const r = g('[data-pick]'); if (!r) return;
    const { pick: type, id, level } = r.dataset;
    if (e.shiftKey && ['device', 'furniture'].includes(type)) return this.select({ type, id, level }, { add: true });
    if (type === 'house') { if (app.levelSel !== 'all') app.setLevel('all'); else app.stage.frame('all'); return this.select(null); }
    if (type === 'loose') { const k = `loose:${id}`; this.expanded.has(k) ? this.expanded.delete(k) : this.expanded.add(k); this.renderLeft(); return; }
    if (type === 'roof' || type === 'solar' || type === 'roofitem' || type === 'xroof') { if (type !== 'xroof' || app.levelSel !== 'all') this.showRoof(); return this.select({ type, id }); }
    if (level && app.levelSel !== level) app.setLevel(level, type === 'level');
    if (type === 'level') { if (app.levelSel === level) app.stage.frame(level); return this.select({ type: 'level', id, level: id }); }
    this.select({ type, id, level });
    const L = app.plan.levels.find((l) => l.id === level), it = findItem(app.plan, id)?.item;
    if (L && type === 'room' && it) { const b = bbox(it.points); app.stage.focusPoint(roomCenter(it), app.stage.displayY(L), Math.max(b.w, b.d)); }
    else if (L && it?.pos) app.stage.focusPoint(it.pos, app.stage.displayY(L), 1.5);
    else if (L && it?.from) app.stage.focusPoint([(it.from[0] + it.to[0]) / 2, (it.from[1] + it.to[1]) / 2], app.stage.displayY(L) + 1, 2);
  }
  onLeftDbl(e) {
    const r = e.target.closest('[data-pick="room"]'); if (!r) return; const L = this.level; const room = L.rooms.find((x) => x.id === r.dataset.id); if (!room) return;
    const b = bbox(room.points); this.app.stage.focusPoint(roomCenter(room), this.app.stage.displayY(L), Math.max(b.w, b.d));
  }
  toggleFlag(key, flag) {
    const app = this.app, [type, id] = key.split(':');
    if (type === 'level' && flag === 'hidden') { app.hiddenLevels.has(id) ? app.hiddenLevels.delete(id) : app.hiddenLevels.add(id); app.stage.layout(); app.buildLabels(); this.renderLeft(); return; }
    const f = findItem(app.plan, id); if (!f) return; app.pushUndo(); f.item[flag] = !f.item[flag]; if (!f.item[flag]) delete f.item[flag];
    if (flag === 'hidden') app.stage.refreshItem(f.level.id, f.type, f.item);
    if (flag === 'hidden' && app.sel?.id === id) app.stage.select(app.sel);
    app.markDirty(); this.renderLeft(); this.renderInspector();
  }
  // Adds an additional roof over the given outline (room, garage, carport, garden house …).
  addExtraRoof(points, { levelId, room = null } = {}) {
    const app = this.app, p = app.plan; app.pushUndo(); p.site.roofs ||= [];
    const carport = room && room.kind === 'outdoor', garage = room?.kind === 'garage';
    const L = p.levels.find((l) => l.id === levelId) || this.level;
    const x = newExtraRoof(p, { levelId: L.id, rect: rectOfPoints(points), name: room ? t('editor.roof.named', { name: room.name }) : t('editor.roof.numbered', { number: p.site.roofs.length + 2 }), type: room?.kind === 'room' ? 'gable' : 'flat', posts: carport, height: room?.kind === 'room' ? L.height : undefined });
    if (room && !carport) { const R = x.rect, wt = garage || room.kind === 'room' ? 0.24 : 0; R.length = r3(R.length + wt); R.width = r3(R.width + wt); }
    p.site.roofs.push(x); this.setTool('select'); if (!['all', 'roof'].includes(app.levelSel)) app.setLevel('all'); app.stage.layout(); app.markDirty(); this.renderLeft(); this.select({ type: 'xroof', id: x.id });
    app.toast(t('editor.toast.roofCreated', { name: x.name })); return x;
  }
  frameHtml(item, num) {
    const src = item.src || 'art';
    const sizeKey = Object.entries(FRAME_SIZES).find(([, [, w, h]]) => (Math.abs(w - (item.fw || 0.5)) < 0.005 && Math.abs(h - (item.fh || 0.7)) < 0.005) || (Math.abs(h - (item.fw || 0.5)) < 0.005 && Math.abs(w - (item.fh || 0.7)) < 0.005))?.[0] || '';
    if (src === 'folder' && !this._dirs) {
      this._dirs = [];
      this.app.stage.media?.browseDirs().then((dirs) => { this._dirs = dirs; if (this.app.sel?.id === item.id) this.renderInspector(); });
    }
    return this.sec(t('editor.section.image'), `<div class="field"><label for="frSrc">${t('editor.frame.source')}</label><select id="frSrc">${['art', 'upload', 'entity', 'folder'].map((key) => `<option value="${key}" ${src === key ? 'selected' : ''}>${t(`editor.frame.source.${key}`)}</option>`).join('')}</select></div>
        ${src === 'upload' ? `<label class="btn small">${icon('image')}${t(item.artV ? 'editor.frame.otherImage' : 'editor.frame.chooseImage')}<input type="file" id="frFile" accept="image/*" hidden></label><p class="hint">${t('editor.frame.uploadHelp')}</p>` : ''}
        ${src === 'folder' ? `<div class="field"><label for="frFolder">${t('editor.frame.folder')}</label><select id="frFolder"><option value="">${t('editor.frame.chooseFolder')}</option>${(this._dirs || []).map((dir) => `<option value="${esc(dir.id)}" ${dir.id === item.folder ? 'selected' : ''}>${esc(dir.title)}</option>`).join('')}${item.folder && !(this._dirs || []).some((dir) => dir.id === item.folder) ? `<option value="${esc(item.folder)}" selected>${esc(item.folder)}</option>` : ''}</select></div>` : ''}
        ${src === 'folder' || (src === 'entity' && item.entity_id?.startsWith('camera.')) ? num('frInt', t('editor.frame.interval'), item.interval || 60, 10, 'min="30"') : ''}`)
      + this.sec(t('editor.section.frame'), `<div class="row2"><div class="field"><label for="frSize">${t('editor.frame.format')}</label><select id="frSize"><option value="">${t('editor.frame.customSize')}</option>${Object.entries(FRAME_SIZES).map(([key, [label]]) => `<option value="${key}" ${key === sizeKey ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="field"><label for="frStyle">${t('editor.frame.frameStyle')}</label><select id="frStyle">${Object.keys(FRAME_STYLES).map((key) => `<option value="${key}" ${(item.frame || 'black') === key ? 'selected' : ''}>${t(`editor.frame.style.${key}`)}</option>`).join('')}</select></div></div>
        <div class="row2">${num('frW', t('editor.common.widthMeters'), item.fw || 0.5, 0.01, 'min="0.1"')}${num('frH', t('editor.common.heightMeters'), item.fh || 0.7, 0.01, 'min="0.1"')}</div>
        <div class="actions"><label class="chk"><input type="checkbox" id="frPasse" ${item.passe ? 'checked' : ''}> ${t('editor.frame.passepartout')}</label><button class="btn small" data-act="frTurn">${t('editor.frame.rotateFormat')}</button></div>`);
  }
  async uploadArt(item, file) {
    const app = this.app;
    try {
      const bmp = await createImageBitmap(file); const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)); const canvas = document.createElement('canvas'); canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale); canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86)); const resp = await app.hass.fetchWithAuth(`/api/hometwin/underlay/art_${item.id}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      if (!resp.ok) throw new Error(resp.status); item.artV = Date.now(); item.src = 'upload'; const found = findItem(app.plan, item.id); if (found) app.stage.refreshItem(found.level.id, 'device', item); app.markDirty(); app.toast(t('editor.toast.artSaved'));
    } catch (err) { app.toast(t('editor.toast.artSaveFailed', { message: err.message || err })); }
  }
  stairHtml(item, fp, L, num) {
    const i = stairInfo(fp), p = this.app.plan, up = p.levels[p.levels.indexOf(L) + 1], need = up ? r3(up.elevation - L.elevation) : null;
    const ok = i.rise <= 0.19 && i.tread >= 0.23 && i.rule >= 0.59 && i.rule <= 0.65;
    return this.sec(t('editor.section.stairs'), `<div class="row2"><div class="field"><label for="stShape">${t('editor.common.shape')}</label><select id="stShape">${[['straight', 'editor.stairs.straight'], ['quarter', 'editor.stairs.quarter'], ['half', 'editor.stairs.half']].map(([k, key]) => `<option value="${k}" ${(item.shape || 'straight') === k ? 'selected' : ''}>${t(key)}</option>`).join('')}</select></div>
        ${item.shape ? `<div class="field"><label for="stTurn">${t('editor.stairs.turnsToward')}</label><select id="stTurn"><option value="right" ${item.turn !== 'left' ? 'selected' : ''}>${t('editor.common.right')}</option><option value="left" ${item.turn === 'left' ? 'selected' : ''}>${t('editor.common.left')}</option></select></div>` : '<span></span>'}</div>
      ${item.shape ? `<div class="row2">${num('stFw', t('editor.stairs.flightWidth'), r3(i.fw), 0.05, 'min="0.6" max="1.5"')}<span></span></div>` : ''}
      <p class="${ok ? 'ok' : 'warn'}">${t('editor.stairs.metrics', { steps: i.n, rise: Math.round(i.rise * 100), tread: Math.round(i.tread * 100), rule: Math.round(i.rule * 100), warning: ok ? '✓' : t('editor.stairs.metricsWarning') })}</p>
      ${need && Math.abs(need - fp.h) > 0.02 ? `<p class="warn">${t('editor.stairs.heightMismatch', { height: formatNumber(fp.h, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), level: esc(up.name), needed: formatNumber(need, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</p>` : ''}
      <p class="hint">${t('editor.stairs.help')}</p>
      <div class="actions"><button class="btn small" data-act="stFlip">${t('editor.stairs.reverse')}</button>${need ? `<button class="btn small" data-act="stFit">${t('editor.stairs.fitHeight')}</button>` : ''}</div>`);
  }
  showRoof() { if (this.app.levelSel !== 'roof') this.app.setLevel('roof'); }
  showModal(title, text) {
    const c = this.app.$('modalCard');
    c.innerHTML = `<div class="panel-head"><h2>${esc(title)}</h2></div><textarea readonly spellcheck="false">${esc(text)}</textarea><div class="foot"><button class="btn" id="mCopy">${t('editor.common.copy')}</button><button class="btn primary" id="mClose">${t('editor.common.close')}</button></div>`;
    this.app.$('modal').hidden = false;
    c.querySelector('#mClose').onclick = () => (this.app.$('modal').hidden = true);
    c.querySelector('#mCopy').onclick = async () => { const ta = c.querySelector('textarea'); try { await navigator.clipboard.writeText(ta.value); this.app.toast(t('editor.toast.copied')); } catch { ta.select(); } };
  }
  findByEntity(id) {
    for (const level of this.app.plan.levels) {
      const d = level.devices.find((x) => x.entity_id === id); if (d) return { level, type: 'device', item: d };
      const o = level.openings.find((x) => x.cover === id || x.contact === id); if (o) return { level, type: 'opening', item: o };
    }
    return null;
  }

  /* ---------------- adding things ---------------- */
  targetPoint() {
    const L = this.level, s = this.app.sel;
    if (s?.type === 'room' && s.level === L.id) { const r = L.rooms.find((x) => x.id === s.id); if (r) return { room: r, pos: roomCenter(r) }; }
    if (s && s.level === L.id) { const it = findItem(this.app.plan, s.id)?.item; if (it?.pos) { const r = roomAt(L, it.pos); if (r) return { room: r, pos: roomCenter(r) }; } }
    const r = L.rooms.find((x) => x.kind === 'room') || L.rooms[0];
    return { room: r, pos: r ? roomCenter(r) : [0, 0] };
  }
  // Newest library objects from GitHub Pages (merged pull requests appear without an update). Silent if offline.
  async loadRemoteLibrary() {
    if (this._libState) return; this._libState = 'loading';
    try {
      const r = await fetch(LIBRARY_URL, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status);
      const data = await r.json(); const n = registerLibrary(data.items || []);
      for (const it of data.items || []) if (it.preview && !thumbFor(`f:lib:${it.id}`)) setThumb(`f:lib:${it.id}`, new URL(it.preview, LIBRARY_URL).href);
      this._libState = 'ok'; if (n) { this.catalog = assetCatalog(); }
    } catch { this._libState = 'offline'; }
    if (this.left === 'insert') this.renderLeft();
  }
  addAsset(key, at = null) {
    const a = this.catalog.find((x) => x.key === key); if (!a) return;
    if (a.spec.type?.startsWith('lib:')) { const it = LIBRARY.get(a.spec.type.slice(4)); if (it) (this.app.plan.site.library ||= {})[it.id] = it; } /* keep the recipe with the plan (offline, stable) */
    const L = this.level; const tp = this.targetPoint(); const pos = at || tp.pos; const room = at ? roomAt(L, at) : tp.room;
    const id = newId(a.furniture ? 'f' : 'd');
    const op = a.furniture ? { op: 'place_furniture', level_id: L.id, id, type: a.spec.type, pos } : { op: 'place_device', level_id: L.id, id, ...a.spec, pos };
    this.app.pushUndo(); this.app.applyLocal(op);
    const it = findItem(this.app.plan, id)?.item; if (it) { placeItem(L, a.furniture ? 'furniture' : 'device', it); this.app.stage.moveItem(L.id, a.furniture ? 'furniture' : 'device', it); }
    this.select({ type: a.furniture ? 'furniture' : 'device', id, level: L.id });
    this.app.toast(t(room ? 'editor.toast.assetPlacedInRoom' : 'editor.toast.assetPlacedOutside', { label: a.label, room: room?.name || '' }));
  }
  placeEntity(id, at = null) {
    const s = this.app.states()[id]; if (!s) return; const area = this.app.areaOf(id);
    let L = this.level, room = at ? roomAt(L, at) : L.rooms.find((r) => r.area_id && r.area_id === area);
    if (!room && !at) for (const l of this.app.plan.levels) { const r = l.rooms.find((x) => x.area_id && x.area_id === area); if (r) { L = l; room = r; break; } }
    const dc = s.attributes.device_class, dom = id.split('.')[0];
    if (dom === 'cover' || (dom === 'binary_sensor' && ['door', 'window', 'garage_door', 'opening'].includes(dc))) {
      const field = dom === 'cover' ? 'cover' : 'contact';
      const want = dom === 'cover' ? (dc === 'garage' ? ['garage'] : ['window', 'garage']) : dc === 'door' ? ['door', 'window'] : dc === 'garage_door' ? ['garage'] : ['window', 'door'];
      let cands = L.openings.filter((o) => want.includes(o.type) && !o[field] && (!room || roomOfOpening(L, o)?.id === room.id));
      if (at) cands = cands.sort((x, y) => distToSeg(at, x.from, x.to) - distToSeg(at, y.from, y.to));
      if (!cands.length) return this.app.toast(t('editor.toast.noFreeOpening', { kind: t(dom === 'cover' ? 'editor.common.windowOrGate' : 'editor.common.windowOrDoor'), room: room ? t('editor.common.inRoom', { room: room.name }) : '' }));
      this.app.pushUndo(); cands[0][field] = id; this.app.stage.rebuildLevel(L.id); this.app.markDirty(); this.app.scheduleUI(true);
      if (L.id !== this.level.id) this.app.setLevel(L.id);
      this.select({ type: 'opening', id: cands[0].id, level: L.id }); return;
    }
    const k = kindForEntity(s); if (!k) return this.app.toast(t('editor.toast.noEntityRepresentation'));
    if (!room && !at) room = L.rooms.find((r) => r.kind === 'room') || L.rooms[0];
    if (!room && !at) return this.app.toast(t('editor.toast.drawRoomFirst'));
    let pos = at;
    if (!pos) { const c = roomCenter(room); const n = L.devices.filter((d) => roomAt(L, d.pos)?.id === room.id).length; pos = [r3(c[0] + ((n % 3) - 1) * 0.4), r3(c[1] + (Math.floor(n / 3) % 3 - 1) * 0.4)]; }
    const did = newId('d');
    this.app.pushUndo(); this.app.applyLocal({ op: 'place_device', level_id: L.id, id: did, kind: k.kind, style: k.style, entity_id: id, pos, ...deviceDefaults(k.kind, k.style) });
    { const it = findItem(this.app.plan, did)?.item; if (it) { placeItem(L, 'device', it); this.app.stage.moveItem(L.id, 'device', it); } }
    if (L.id !== this.level.id) this.app.setLevel(L.id);
    this.select({ type: 'device', id: did, level: L.id });
    if (!at && (!room.area_id || room.area_id !== area)) this.app.toast(t('editor.toast.entityPlacedCheckPosition', { room: room.name }));
  }

  /* ---------------- selection & inspector ---------------- */
  // All selected device/furniture items (primary first), for group operations.
  selection() { const s = this.app.sel; return s ? [s, ...(this.multi || [])] : []; }
  select(sel, { add = false } = {}) {
    const app = this.app; const groupable = (x) => x && ['device', 'furniture'].includes(x.type);
    if (add && groupable(sel) && groupable(app.sel) && sel.level === app.sel.level) {
      this.multi ||= [];
      if (sel.id === app.sel.id) { if (this.multi.length) { app.sel = this.multi.shift(); } }
      else { const i = this.multi.findIndex((x) => x.id === sel.id); if (i >= 0) this.multi.splice(i, 1); else this.multi.push(sel); }
      app.stage.select(app.sel, this.multi); this.renderInspector(); this.renderLeft(); return;
    }
    this.multi = [];
    if (app.sel?.type === 'xroof' && sel?.type !== 'xroof') app.stage.setMarks(null);
    app.sel = sel; app.stage.select(sel); this.dimsDirty = true; this.markSelection();
    const L = sel?.level && app.plan.levels.find((l) => l.id === sel.level);
    app.stage.setHandles(L, sel?.type === 'room' && this.tool === 'select' ? L.rooms.find((r) => r.id === sel.id) : null);
    if (sel?.type === 'room' && sel.level) this.expanded.add(`level:${sel.level}`);
    if (['device', 'furniture', 'opening'].includes(sel?.type) && L) { const it = findItem(app.plan, sel.id)?.item; const r = it?.pos ? roomAt(L, it.pos) : it?.from ? roomOfOpening(L, it) : null; if (r) this.expanded.add(`room:${r.id}`); }
    this.renderInspector(); this.renderLeft(); this.roofHandles();
    if (this.left === 'tree') requestAnimationFrame(() => app.$('lbody').querySelector('.trow.sel')?.scrollIntoView({ block: 'nearest' }));
  }
  sec(title, html) { return `<details class="sec" data-sec="${esc(title)}" ${this.closedSecs.has(title) ? '' : 'open'}><summary>${esc(title)}</summary><div class="secb">${html}</div></details>`; }
  renderInspector() {
    const app = this.app, box = app.$('inspBody'), s = app.sel;
    if (app.mode !== 'edit') { app.$('insp').hidden = true; return; }
    app.$('insp').hidden = false;
    const num = (id, label, v, step = 0.05, extra = '') => `<div class="field"><label for="${id}">${label}</label><input type="number" id="${id}" step="${step}" value="${v ?? ''}" ${extra}></div>`;
    const rot = (v) => `<div class="field"><label for="iRot">${t('editor.common.rotation')} <output>${Math.round(v || 0)}°</output></label><input type="range" id="iRot" min="-180" max="180" step="5" value="${v || 0}"></div>`;
    const title = (text) => (app.$('inspTitle').textContent = text);
    const p = app.plan, site = p.site;
    if (!s || s.type === 'roof') {
      const roof = site.roof, isFlat = roof.type === 'flat';
      const covers = Object.entries(ROOF_COVERS).filter(([, v]) => !!v.flat === isFlat || (!isFlat && false));
      const roofHtml = `<div class="field"><label for="rfType">${t('editor.roof.form')}</label><select id="rfType">${Object.entries(ROOF_TYPES).map(([k, v]) => `<option value="${k}" ${roof.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${roof.type !== 'none' ? `<div class="row2"><div class="field"><label for="rfCover">${t('editor.roof.covering')}</label><select id="rfCover">${covers.map(([k, v]) => `<option value="${k}" ${roof.cover === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div><div class="field"><label for="rfColor">${t('editor.common.color')}</label><input type="color" id="rfColor" value="${roof.color || ROOF_COVERS[roof.cover]?.color || '#7d3a2c'}"></div></div>` : ''}
        ${!['none', 'flat'].includes(roof.type) ? `<div class="row2">${num('rfPitch', t('editor.roof.pitch'), roof.pitch ?? 35, 1, 'min="3" max="60"')}${num('rfOh', t('editor.roof.overhang'), roof.overhang ?? 0.4, 0.05, 'min="0" max="1.5"')}</div>` : ''}
        ${['gable', 'shed'].includes(roof.type) ? `<div class="row2">${num('rfOhG', t('editor.roof.gableOverhang'), roof.overhangGable ?? roof.overhang ?? 0.4, 0.05, 'min="0" max="1.5"')}${roof.type === 'gable' ? num('rfROff', t('editor.roof.ridgeOffset'), Math.round((roof.ridgeOffset || 0) * 100), 5, 'min="-45" max="45"') : '<span></span>'}</div>` : ''}
        ${!['none', 'flat'].includes(roof.type) ? `<div class="row2">${num('rfKnee', t('editor.roof.kneeWall'), roof.knee ?? 0, 0.05, 'min="0" max="2"')}<span></span></div>` : ''}`;
      const R = roof.type !== 'none' ? this.roofRectNow() : null;
      const geoHtml = R ? `<div class="field"><label for="rfRot">${t('editor.common.rotation')} <output>${R.rot.toFixed(1)}°</output></label><input type="range" id="rfRot" min="-180" max="180" step="0.5" value="${R.rot}"></div>
        <div class="row2">${num('rfRotN', t('editor.common.rotationDegrees'), +R.rot.toFixed(1), 0.5)}<div class="field"><span class="lbl">${t('editor.common.quick')}</span><div class="actions"><button class="btn small" data-act="roofRot" data-deg="-90">−90°</button><button class="btn small" data-act="roofRot" data-deg="90">+90°</button><button class="btn small" data-act="roofRot" data-deg="180">180°</button></div></div></div>
        <div class="row2">${num('rfLen', t('editor.roof.lengthAlongRidge'), R.length.toFixed(2), 0.05, 'min="0.5"')}${num('rfWid', t('editor.common.widthMeters'), R.width.toFixed(2), 0.05, 'min="0.5"')}</div>
        <div class="row2">${num('rfCx', t('editor.common.centerX'), R.cx.toFixed(2))}${num('rfCz', t('editor.common.centerZ'), R.cz.toFixed(2))}</div>
        <p class="hint">${roof.type === 'shed' ? t('editor.roof.shedOrientation') + ' ' : ''}${t('editor.roof.geometryHelp')}</p>
        <div class="actions"><button class="btn small" data-act="roofFit" ${roof.rect ? '' : 'disabled'}>${t('editor.roof.fitTopLevel')}</button></div>` : '';
      const D = { ...DEFAULT_DETAILS, ...(roof.details || {}) }; const pitched = !['none', 'flat'].includes(roof.type);
      const chk = (id, label, on) => `<label class="chk"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${label}</label>`;
      const styleHtml = `<div class="stylegrid">${Object.entries(ROOF_STYLES).map(([k, v]) => `<button class="btn small" data-style="${k}" aria-pressed="${roof.style === k}">${v.label}</button>`).join('')}</div><label class="chk" style="margin-top:8px"><input type="checkbox" id="stKeep" ${this.keepRoofType !== false ? 'checked' : ''}> ${t('editor.roof.keepForm', { type: ROOF_TYPES[roof.type] || '–' })}</label><p class="hint">${t('editor.roof.styleHelp', { form: this.keepRoofType !== false ? '' : t('editor.roof.styleTypicalForm') })}</p>`;
      const detHtml = pitched ? `<div class="field"><label for="dtSoffit">${t('editor.roof.soffit')}</label><select id="dtSoffit">${Object.entries(SOFFITS).map(([k, v]) => `<option value="${k}" ${D.soffit === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><span class="lbl">${t('editor.roof.beamEnd')}</span><div class="heads">${Object.entries(HEAD_SHAPES).map(([k, v]) => `<button data-head="${k}" aria-pressed="${D.head === k}" title="${v}">${headSvg(k === 'bracket' ? 'straight' : k)}<small>${v}</small></button>`).join('')}</div></div>
        <div class="chks">${chk('dtRafters', t('editor.roof.showRafterTails'), D.rafters)}${chk('dtPurlins', t('editor.roof.purlinEnds'), D.purlins)}${chk('dtFly', t('editor.roof.flyRafters'), D.flyRafter)}${chk('dtBrackets', t('editor.roof.brackets'), D.brackets)}${chk('dtBraces', t('editor.roof.braces'), D.braces)}</div>
        ${D.rafters ? `<div class="row2">${num('dtSpacing', t('editor.roof.rafterSpacing'), D.spacing, 0.05, 'min="0.3" max="1.5"')}${num('dtRh', t('editor.roof.rafterHeight'), Math.round(D.rh * 100), 1, 'min="6" max="30"')}</div>` : ''}
        ${D.purlins ? `<div class="row2">${num('dtPOut', t('editor.roof.purlinOverhang'), D.purlinOut, 0.05, 'min="0" max="1.2"')}<span></span></div>` : ''}
        <div class="field"><label for="dtBarge">${t('editor.roof.bargeboard')}</label><select id="dtBarge">${Object.entries(BARGES).map(([k, v]) => `<option value="${k}" ${D.barge === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><span class="lbl">${t('editor.roof.woodColor')}</span><div class="swatches">${Object.entries(WOOD_PRESETS).map(([c, n]) => `<button data-wood="${c}" style="background:${c}" aria-pressed="${D.wood === c}" aria-label="${n}" title="${n}"></button>`).join('')}<input type="color" id="dtWood" value="${D.wood}" aria-label="${t('editor.roof.customWoodColor')}" style="width:30px;height:30px;padding:0;border:0;background:none"></div></div>
        ${D.soffit !== 'open' && D.rafters ? `<p class="hint">${t('editor.roof.rafterVisibilityHint')}</p>` : ''}` : `<p class="hint">${t('editor.roof.detailsPitchedOnly')}</p>`;
      const solarHtml = (site.solar.length ? site.solar.map((a, i) => `<button class="listrow" data-solar="${a.id}"><span class="nm">${t('editor.solar.fieldNumber', { number: i + 1 })}</span><small>${t('editor.solar.moduleCount', { rows: a.rows, cols: a.cols })}${a.entity_id ? ' · ' + esc(app.nameOf(a.entity_id)) : ''}</small></button>`).join('') : `<p class="hint">${t('editor.solar.none')}</p>`) + `<button class="btn small" data-act="addSolar" style="margin-top:6px" ${roof.type === 'none' ? 'disabled' : ''}>${icon('plus')}${t('editor.solar.addField')}</button>`;
      const riHtml = (site.roofItems || []).map((it, i) => `<button class="listrow" data-ritem="${it.id}"><span class="nm">${t(it.kind === 'dormer' ? 'editor.common.dormer' : 'editor.common.roofWindow')} ${i + 1}</span><small>${Math.round(it.w * 100)}×${Math.round(it.h * 100)}${it.cover ? ' · ' + esc(app.nameOf(it.cover)) : ''}</small></button>`).join('') + `<div class="actions" style="margin-top:6px"><button class="btn small" data-act="addRoofWin" ${pitched ? '' : 'disabled'}>${icon('plus')}${t('editor.common.roofWindow')}</button><button class="btn small" data-act="addDormer" ${pitched ? '' : 'disabled'}>${icon('plus')}${t('editor.common.dormer')}</button></div>`;
      const roofSecs = this.sec(t('editor.common.roof'), roofHtml) + this.sec(t('editor.section.styleTemplate'), styleHtml) + this.sec(t('editor.section.roofDetails'), detHtml) + this.sec(t('editor.section.roofWindowsDormers'), riHtml);
      const moreHtml = `${(site.roofs || []).map((x) => `<button class="listrow" data-xroof="${x.id}"><span class="nm">${esc(x.name)}</span><small>${ROOF_TYPES[x.type] || ''}</small></button>`).join('')}<p class="hint">${t('editor.roof.extraHelp')}</p><div class="actions"><button class="btn small" data-act="toolRoof">${icon('plus')}${t('editor.roof.draw')}</button></div>`;
      if (s?.type === 'roof') { title(t('editor.common.roof')); box.innerHTML = roofSecs + this.sec(t('editor.section.extraRoofs'), moreHtml) + (geoHtml ? this.sec(t('editor.section.locationDimensions'), geoHtml) : '') + this.sec(t('editor.section.photovoltaics'), solarHtml); return; }
      title(t('editor.common.house'));
      const fac = site.facade;
      box.innerHTML = this.sec(t('editor.section.general'), `<div class="field"><label for="stName">${t('editor.common.name')}</label><input type="text" id="stName" value="${esc(p.name)}"></div>`)
        + this.sec(t('editor.section.locationSun'), `<div class="row2"><div class="field"><label for="stLat">${t('editor.site.latitude')}</label><input type="number" id="stLat" step="0.0001" value="${site.lat ?? ''}"></div><div class="field"><label for="stLon">${t('editor.site.longitude')}</label><input type="number" id="stLon" step="0.0001" value="${site.lon ?? ''}"></div></div>
          <div class="field"><label for="stNorth">${t('editor.site.northDirection')} <output>${Math.round(site.north || 0)}°</output></label><input type="range" id="stNorth" min="-180" max="180" step="1" value="${site.north || 0}"></div><p class="hint">${t('editor.site.northHelp')}</p>`)
        + this.sec(t('editor.section.facade'), `<div class="field"><label for="faMat">${t('editor.common.material')}</label><select id="faMat">${Object.entries(FACADES).map(([k, v]) => `<option value="${k}" ${fac.material === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><span class="lbl">${t('editor.common.color')}</span><div class="swatches">${FACADE_PRESETS.map((c) => `<button data-fcol="${c}" style="background:${c}" aria-pressed="${fac.color === c}" aria-label="${t('editor.common.colorValue', { value: c })}"></button>`).join('')}<input type="color" id="faColor" value="${fac.color}" aria-label="${t('editor.common.customColor')}" style="width:30px;height:30px;padding:0;border:0;background:none"></div></div>
          <div class="row2"><div class="field"><label for="faPlinth">${t('editor.facade.plinth')}</label><input type="color" id="faPlinth" value="${fac.plinth}"></div><div class="field"><label for="faFrame">${t('editor.facade.windowFrame')}</label><input type="color" id="faFrame" value="${fac.frame}"></div></div>
          ${num('faPlinthH', t('editor.facade.plinthHeight'), plinthHeight(site), 0.05, 'min="0" max="1.5"')}<p class="hint">${t('editor.facade.plinthHelp')}</p>`)
        + roofSecs + (geoHtml ? this.sec(t('editor.section.roofLocationDimensions'), geoHtml) : '') + this.sec(t('editor.section.photovoltaics'), solarHtml)
        + this.sec(t('editor.section.backup'), `<p class="hint">${t('editor.backup.help')}</p><div class="actions"><button class="btn small primary" data-act="backupExport">${icon('save')}${t('editor.backup.export')}</button><label class="btn small">${icon('upload')}${t('editor.backup.import')}<input type="file" id="backupFile" accept=".json,application/json" hidden></label></div>`)
        + this.sec(t('editor.section.file'), `<div class="actions"><button class="btn small" data-act="export">${icon('code')}${t('editor.file.planAsJson')}</button><label class="btn small">${t('editor.file.loadJson')}<input type="file" id="jsonFile" accept=".json,application/json" hidden></label><label class="btn small">Sweet Home 3D<input type="file" id="sh3dFile" accept=".sh3d" hidden></label></div>
          <div class="actions" style="margin-top:6px"><button class="btn small" data-act="demo">${t('editor.file.loadExample')}</button><button class="btn small danger" data-act="empty">${t('editor.file.startEmpty')}</button></div>
          <details class="danger-zone"><summary>${t('editor.common.advanced')}</summary><p class="hint">${t('editor.file.resetHelp')}</p><button class="btn small danger" data-act="resetAll">${t('editor.file.resetAll')}</button></details>`);
      return;
    }
    if (s.type === 'xroof') {
      const x = (site.roofs || []).find((r) => r.id === s.id); if (!x) return this.select(null);
      title(t('editor.common.roof')); const flat = x.type === 'flat'; const R = x.rect || { cx: 0, cz: 0, length: 3, width: 3, rot: 0 };
      const covers = Object.entries(ROOF_COVERS).filter(([, v]) => !!v.flat === flat);
      box.innerHTML = this.sec(t('editor.section.general'), `<div class="field"><label for="xrName">${t('editor.common.name')}</label><input type="text" id="xrName" value="${esc(x.name)}"></div>
          <div class="row2"><div class="field"><label for="xrType">${t('editor.roof.form')}</label><select id="xrType">${Object.entries(ROOF_TYPES).filter(([k]) => k !== 'none').map(([k, v]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label for="xrCover">${t('editor.roof.covering')}</label><select id="xrCover">${covers.map(([k, v]) => `<option value="${k}" ${x.cover === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div></div>
          ${flat ? '' : `<div class="row2">${num('xrPitch', t('editor.roof.pitch'), x.pitch ?? 25, 1, 'min="3" max="60"')}${num('xrOh', t('editor.roof.overhang'), x.overhang ?? 0.3, 0.05, 'min="0" max="1.5"')}</div>`}
          <div class="row2"><div class="field"><label for="xrLevel">${t('editor.roof.sitsOn')}</label><select id="xrLevel">${p.levels.map((l) => `<option value="${l.id}" ${l.id === x.levelId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>${num('xrH', t('editor.roof.eavesHeight'), x.height ?? 2.5, 0.05, 'min="1.8" max="8"')}</div>
          <label class="chk"><input type="checkbox" id="xrPosts" ${x.posts ? 'checked' : ''}> ${t('editor.roof.onPosts')}</label>`)
        + this.sec(t('editor.section.locationDimensions'), `<div class="row2">${num('xrLen', t('editor.roof.lengthAlongRidge'), R.length, 0.05, 'min="0.5"')}${num('xrWid', t('editor.common.widthMeters'), R.width, 0.05, 'min="0.5"')}</div>
          <div class="row2">${num('xrCx', t('editor.common.centerX'), R.cx)}${num('xrCz', t('editor.common.centerZ'), R.cz)}</div>
          <div class="row2">${num('xrRot', t('editor.common.rotationDegrees'), R.rot, 5)}<div class="field"><span class="lbl">${t('editor.common.quick')}</span><div class="actions"><button class="btn small" data-act="xrRot90">+90°</button></div></div></div>
          ${x.type === 'shed' ? `<p class="hint">${t('editor.roof.shedOrientationExtra')}</p>` : ''}`)
        + `<div class="actions"><button class="btn small" data-act="xrDup">${t('editor.common.duplicate')}</button><button class="btn small danger" data-act="del">${t('editor.common.delete')}</button></div>`;
      app.stage.setMarks(app.plan.levels.find((l) => l.id === x.levelId) || p.levels[0], x.rect ? rectCorners(x.rect).map((c, i, a) => ({ a: c, b: a[(i + 1) % 4], color: '#ffb35c', width: 0.12, opacity: 0.95 })) : []);
      return;
    }
    if (s.type === 'roofitem') {
      const it = (site.roofItems || []).find((x) => x.id === s.id); if (!it) return this.select(null);
      const top = [...app.stage.levels.values()].find((o) => o.roof)?.roof; const planes = top?.planes || [];
      const ents = (dom) => Object.keys(app.states()).filter((id) => dom.some((d) => id.startsWith(d + '.')));
      const entSel = (id, label, list, cur) => `<div class="field"><label for="${id}">${label}</label><select id="${id}"><option value="">—</option>${list.map((e) => `<option value="${e}" ${e === cur ? 'selected' : ''}>${esc(app.nameOf(e))}</option>`).join('')}</select></div>`;
      const dorm = it.kind === 'dormer';
      title(t(dorm ? 'editor.common.dormer' : 'editor.common.roofWindow'));
      box.innerHTML = this.sec(t('editor.section.location'), `<div class="field"><label for="riKind">${t('editor.common.type')}</label><select id="riKind"><option value="window" ${!dorm ? 'selected' : ''}>${t('editor.common.roofWindow')}</option><option value="dormer" ${dorm ? 'selected' : ''}>${t('editor.roofItem.dormerWithWindow')}</option></select></div>
          <div class="field"><label for="riPlane">${t('editor.roofItem.roofPlane')}</label><select id="riPlane">${planes.map((pl, i) => (pl.flat ? '' : `<option value="${i}" ${+it.plane === i ? 'selected' : ''}>${esc(pl.label || t('editor.roofItem.planeNumber', { number: i + 1 }))}</option>`)).join('')}</select></div>
          <div class="row2">${num('riU', t('editor.roofItem.sideways'), it.u ?? 0)}${num('riV', t('editor.roofItem.fromEaves'), it.v ?? 1)}</div><p class="hint">${t('editor.roofItem.dragHelp')}</p>`)
        + this.sec(t('editor.section.size'), dorm ? `<div class="row2">${num('riW', t('editor.common.widthMeters'), it.w, 0.05, 'min="0.8" max="6"')}${num('riDH', t('editor.roofItem.wallHeight'), it.dormer?.h ?? 1.3, 0.05, 'min="0.6" max="2.5"')}</div>
            <div class="field"><label for="riDType">${t('editor.roofItem.dormerRoof')}</label><select id="riDType"><option value="gable" ${it.dormer?.type !== 'shed' ? 'selected' : ''}>${t('editor.roofItem.gableRoof')}</option><option value="shed" ${it.dormer?.type === 'shed' ? 'selected' : ''}>${t('editor.roofItem.shedRoof')}</option></select></div>`
          : `<div class="field"><label for="riSize">${t('editor.roofItem.standardSize')}</label><select id="riSize"><option value="">${t('editor.roofItem.customDimensions')}</option>${Object.keys(ROOF_WINDOWS).map((k) => `<option value="${k}" ${ROOF_WINDOWS[k][0] === it.w && ROOF_WINDOWS[k][1] === it.h ? 'selected' : ''}>${k.replace('x', ' × ')}</option>`).join('')}</select></div>
            <div class="row2">${num('riW', t('editor.common.widthMeters'), it.w, 0.01, 'min="0.4" max="2"')}${num('riH', t('editor.common.heightMeters'), it.h, 0.01, 'min="0.4" max="2"')}</div>`)
        + this.sec(t('editor.section.link'), entSel('riCover', t('editor.roofItem.blind'), ents(['cover']), it.cover) + (it.cover ? `<label class="chk"><input type="checkbox" id="riInv" ${it.coverInvert ? 'checked' : ''}> ${t('editor.common.reversePosition')}</label>` : '') + entSel('riContact', t('editor.roofItem.windowContact'), ents(['binary_sensor']), it.contact) + `<p class="hint">${t('editor.roofItem.linkHelp')}</p>`)
        + `<div class="actions"><button class="btn small" data-act="dup">${t('editor.common.duplicate')}</button><button class="btn small danger" data-act="delRoofItem">${t('editor.common.delete')}</button></div>`;
      return;
    }
    if (s.type === 'solar') {
      const a = site.solar.find((x) => x.id === s.id); if (!a) return this.select(null);
      const top = [...app.stage.levels.values()].find((o) => o.roof)?.roof; const planes = top?.planes || [];
      const S = app.states(); const sensors = Object.keys(S).filter((id) => id.startsWith('sensor.') && (S[id].attributes.device_class === 'power' || /^(k?w)$/i.test(S[id].attributes.unit_of_measurement || '')));
      title(t('editor.solar.field'));
      box.innerHTML = this.sec(t('editor.section.location'), `<div class="field"><label for="pvPlane">${t('editor.roofItem.roofPlane')}</label><select id="pvPlane"><option value="auto" ${a.plane === 'auto' ? 'selected' : ''}>${t('editor.solar.automaticSunniest')}</option>${planes.map((pl, i) => `<option value="${i}" ${String(a.plane) === String(i) ? 'selected' : ''}>${esc(pl.label)}${pl.azimuth != null ? ` (${Math.round(pl.azimuth)}°)` : ''}</option>`).join('')}</select></div>
          <div class="row2">${num('pvRows', t('editor.solar.rows'), a.rows, 1, 'min="1" max="12"')}${num('pvCols', t('editor.solar.columns'), a.cols, 1, 'min="1" max="30"')}</div>
          <div class="field"><label for="pvOrient">${t('editor.solar.orientation')}</label><select id="pvOrient"><option value="1" ${a.portrait !== false ? 'selected' : ''}>${t('editor.solar.portrait')}</option><option value="0" ${a.portrait === false ? 'selected' : ''}>${t('editor.solar.landscape')}</option></select></div>
          <div class="row2">${num('pvOu', t('editor.solar.sideOffset'), a.offset?.[0] ?? 0)}${num('pvOv', t('editor.solar.ridgeOffset'), a.offset?.[1] ?? 0)}</div>`)
        + this.sec(t('editor.section.link'), `<div class="field"><label for="pvEnt">${t('editor.solar.powerSensor')}</label><select id="pvEnt"><option value="">—</option>${sensors.map((id) => `<option value="${id}" ${id === a.entity_id ? 'selected' : ''}>${esc(app.nameOf(id))}</option>`).join('')}</select></div>${num('pvPeak', t('editor.solar.peakPower'), a.peak_kw ?? 5, 0.1, 'min="0.1"')}<p class="hint">${t('editor.solar.powerHelp')}</p>`)
        + `<div class="actions"><button class="btn small danger" data-act="delSolar">${t('editor.common.delete')}</button></div>`;
      return;
    }
    if (s.type === 'level') {
      const L = p.levels.find((l) => l.id === s.id); if (!L) return this.select(null);
      const idx = p.levels.indexOf(L), u = L.underlay;
      title(t('editor.common.level'));
      box.innerHTML = this.sec(t('editor.section.general'), `<div class="field"><label for="lvName">${t('editor.common.name')}</label><input type="text" id="lvName" value="${esc(L.name)}"></div>
          <div class="field"><label for="lvFloor">${t('editor.level.haFloor')}</label><select id="lvFloor"><option value="">—</option>${app.floors().map((f) => `<option value="${f.floor_id}" ${f.floor_id === L.floor_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>`)
        + this.sec(t('editor.section.heights'), `<div class="row2">${num('lvH', t('editor.level.roomHeight'), L.height, 0.05, 'min="1.8"')}${idx > 0 ? num('lvSlab', t('editor.level.slabThickness'), slabThickness(L), 0.01, 'min="0"') : '<span></span>'}</div>
          ${idx > 0 ? `<label class="check"><input type="checkbox" id="lvAuto" ${L.autoElevation !== false ? 'checked' : ''}> ${t('editor.level.autoElevation')}</label>` : ''}
          ${num('lvElev', t('editor.level.floorAboveGround'), L.elevation.toFixed(2), 0.05, idx > 0 && L.autoElevation !== false ? 'disabled' : '')}
          <div class="field"><label for="lvCut">${t('editor.level.cutWallsAt')} <output>${formatNumber(L.cutHeight, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m</output></label><input type="range" id="lvCut" min="0.3" max="${L.height}" step="0.05" value="${L.cutHeight}"></div>`)
        + this.sec(t('editor.section.floorPlanTemplate'), (this.calib?.measured ? `<div class="field"><label for="calReal">${t('editor.underlay.measuredLength', { measured: formatNumber(this.calib.measured, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</label><div class="actions"><input type="number" id="calReal" step="0.01" min="0.1" style="flex:1" placeholder="${t('editor.underlay.lengthExample')}"><button class="btn primary small" data-act="calApply">${t('editor.common.apply')}</button></div></div>` : '')
          + (u ? `<div class="field"><label for="ulOpacity">${t('editor.underlay.opacity')} <output>${Math.round((u.opacity ?? 0.6) * 100)} %</output></label><input type="range" id="ulOpacity" min="0.1" max="1" step="0.05" value="${u.opacity ?? 0.6}"></div>
            <div class="row2">${num('ulX', t('editor.underlay.offsetX'), u.x0)}${num('ulZ', t('editor.underlay.offsetZ'), u.z0)}</div>
            <label class="chk"><input type="checkbox" id="ulShow3d" ${u.show3d ? 'checked' : ''}> ${t('editor.underlay.show3d')}</label>
            <p class="hint">${t('editor.underlay.scaleHelp', { pixels: formatNumber(1 / u.mpp, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</p>
            <div class="actions"><button class="btn primary small" data-act="wizard">${icon('sparkle')}${t('editor.toolbar.floorPlanAssistant')}</button><button class="btn small" data-act="calStart">${icon('ruler')}${t('editor.underlay.measureScale')}</button><label class="btn small">${icon('image')}${t('editor.underlay.otherImage')}<input type="file" id="ulFile" accept="image/*" hidden></label><button class="btn small danger" data-act="ulRemove">${t('editor.common.remove')}</button></div>
            <div class="actions" style="margin-top:6px"><button class="btn small" data-act="aiPlan">${icon('sparkle')}${t('editor.underlay.detectFloorPlan')}</button></div>`
          : `<p class="hint">${t('editor.underlay.emptyHelp')}</p><div class="actions" style="margin-top:6px"><button class="btn primary small" data-act="wizard">${icon('sparkle')}${t('editor.toolbar.floorPlanAssistant')}</button><label class="btn small">${icon('upload')}${t('editor.underlay.templateOnly')}<input type="file" id="ulFile" accept="image/*" hidden></label></div>`))
        + this.sec(t('editor.section.levels'), `<div class="actions"><button class="btn small" data-act="addLevel">${icon('plus')}${t('editor.level.addAbove')}</button><button class="btn small" data-act="addBasement">${t('editor.level.addBasement')}</button>${p.levels.length > 1 ? `<button class="btn small danger" data-act="delLevel">${t('editor.level.delete')}</button>` : ''}</div>`);
      return;
    }
    if (this.multi?.length) {
      const sel = this.selection(); title(t('editor.selection.objectCount', { count: sel.length }));
      box.innerHTML = this.sec(t('editor.section.multiSelect'), `<p class="hint">${sel.map((x) => { const it = findItem(p, x.id)?.item; return esc(x.type === 'device' ? (it?.entity_id ? app.nameOf(it.entity_id) : KINDS[it?.kind]?.label || '') : this.furnLabel(it || {})); }).join(', ')}</p><p class="hint">${t('editor.selection.help')}</p>`)
        + `<div class="actions"><button class="btn small" data-act="rot90">↻ 90°</button><button class="btn small" data-act="dup">${t('editor.common.duplicate')}</button><button class="btn small danger" data-act="del">${t('editor.selection.deleteAll')}</button></div>`;
      return;
    }
    const found = findItem(p, s.id); if (!found) { app.sel = null; return this.renderInspector(); }
    const { item, level: L, type } = found; let h = '';
    const vis = () => this.sec(t('editor.section.visibility'), `<label class="check"><input type="checkbox" id="iHidden" ${item.hidden ? 'checked' : ''}> ${t('editor.visibility.hideInModel')}</label><label class="check"><input type="checkbox" id="iLocked" ${item.locked ? 'checked' : ''}> ${t('editor.visibility.lock')}</label>`);
    if (type === 'device') {
      const k = KINDS[item.kind]; const asset = this.catalog.find((a) => a.key === (KIND_STYLES[item.kind] ? `${item.kind}:${item.style || Object.keys(KIND_STYLES[item.kind])[0]}` : item.kind));
      const room = roomAt(L, item.pos); const S = app.states();
      const ents = Object.keys(S).filter((id) => entityMatchesKind(item.kind, S[id])).sort((a, b) => (app.areaOf(b) === room?.area_id) - (app.areaOf(a) === room?.area_id) || a.localeCompare(b));
      const used = usedEntities(p);
      const dom = item.entity_id?.split('.')[0]; const altKinds = dom ? Object.entries(KINDS).filter(([kk, v]) => v.domains.includes(dom) && (!S[item.entity_id] || entityMatchesKind(kk, S[item.entity_id]))) : [];
      const isScreen = item.kind === 'tv';
      title(t('editor.common.device'));
      h = `<div class="kind">${asset && thumbFor(asset.key) ? `<img src="${thumbFor(asset.key)}" alt="">` : ''}<div><b>${esc(KIND_STYLES[item.kind]?.[item.style] || k?.label || item.kind)}</b><small>${esc(room?.name || t('editor.common.outside'))} · ${esc(L.name)}</small> ${item.entity_id ? `<span class="badge">${t('editor.common.linked')}</span>` : `<span class="badge no">${t('editor.common.unassigned')}</span>`}</div></div>`
        + this.sec(t(isScreen ? 'editor.section.screenContent' : 'editor.section.link'), `<div class="field"><label for="iEnt">${t(isScreen ? 'editor.screen.chooseEntity' : 'editor.device.haEntity')}</label><select id="iEnt"><option value="">${t(isScreen ? 'editor.screen.none' : 'editor.device.notLinked')}</option>${ents.map((id) => `<option value="${id}" ${id === item.entity_id ? 'selected' : ''}>${esc(app.nameOf(id))}${app.areaOf(id) ? ' · ' + esc(app.areaName(app.areaOf(id))) : ''}${used.has(id) && id !== item.entity_id ? ` ${t('editor.device.occupied')}` : ''}</option>`).join('')}</select></div>${isScreen ? `<p class="hint">${t(item.entity_id ? 'editor.screen.help' : 'editor.screen.emptyHelp')}</p>` : ''}`)
        + this.sec(t('editor.section.appearance'), `${altKinds.length > 1 ? `<div class="field"><label for="iKind">${t('editor.device.displayAs')}</label><select id="iKind">${altKinds.map(([kk, v]) => `<option value="${kk}" ${kk === item.kind ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>` : ''}
          ${KIND_STYLES[item.kind] ? `<div class="field"><label for="iStyle">${t('editor.common.shape')}</label><select id="iStyle">${Object.entries(KIND_STYLES[item.kind]).map(([kk, v]) => `<option value="${kk}" ${kk === (item.style || Object.keys(KIND_STYLES[item.kind])[0]) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>` : ''}
          ${['strip', 'track', 'pendantTrio'].includes(item.style) || ['tv', 'radiator', 'fireplace'].includes(item.kind) ? num('iL', t(item.kind === 'tv' ? 'editor.device.imageWidth' : 'editor.common.lengthWidthMeters'), item.length ?? '', 0.05, `placeholder="${t('editor.common.auto')}"`) : ''}
          ${item.kind === 'tv' && item.style === 'curved' ? num('iCurve', t('editor.device.curveRadius'), item.curve ?? 4, 0.1, 'min="1" max="20"') : ''}
          ${item.kind === 'tv' ? `<p class="hint">${t('editor.device.mediaScreenHelp')}</p>` : ''}`)
        + (item.kind === 'frame' ? this.frameHtml(item, num) : '')
        + this.sec(t('editor.section.position'), `<div class="row2">${num('iX', 'X (m)', item.pos[0])}${num('iZ', 'Z (m)', item.pos[1])}</div>
          ${num('iElevation', t('editor.position.elevation'), app.stage.itemElevation(L.id, type, item.id).toFixed(3), 0.01)}<label><input type="checkbox" id="iAutoElevation" ${automaticPlacement(item, type) ? 'checked' : ''}> ${t('editor.position.automatic')}</label><button class="btn small" data-act="onSurface">${t('editor.position.onSurface')}</button>
          ${rot(item.rot)}`) + vis();
    } else if (type === 'furniture') {
      const def = FURNITURE[item.type] || {}; const fp = furnitureParams(item);
      title(t('editor.common.furniture'));
      h = `<div class="kind">${thumbFor(`f:${item.type}`) ? `<img src="${thumbFor(`f:${item.type}`)}" alt="">` : ''}<div><b>${esc(def.label || item.type)}</b><small>${esc(roomAt(L, item.pos)?.name || t('editor.common.outside'))} · ${esc(L.name)}</small></div></div>`
        + (def.screen ? this.sec(t('editor.section.screenContent'), `<div class="field"><label for="lEnt">${t('editor.screen.chooseEntity')}</label><select id="lEnt"><option value="">${t('editor.screen.none')}</option>${Object.keys(app.states()).filter((id) => /^(media_player|camera|image)\./.test(id)).sort().map((id) => `<option value="${id}" ${id === item.entity_id ? 'selected' : ''}>${esc(app.nameOf(id))}</option>`).join('')}</select></div><p class="hint">${t(item.entity_id ? 'editor.screen.help' : 'editor.screen.emptyHelp')}</p>`) : '')
        + this.sec(t('editor.section.dimensions'), `<div class="row2">${def.w != null ? num('fW', t('editor.common.widthMeters'), fp.w, 0.05, 'min="0.1"') : ''}${def.d != null ? num('fD', t('editor.common.depthMeters'), fp.d, 0.05, 'min="0.05"') : ''}</div>
          ${def.h != null ? `<div class="row2">${num('fH', t('editor.common.heightMeters'), fp.h, 0.05, 'min="0.1"')}<span></span></div>` : ''}
          ${def.chairs != null ? `<div class="row2">${num('fChairs', t('editor.furniture.chairs'), item.chairs ?? def.chairs, 1, 'min="0" max="12"')}<span></span></div>` : ''}
          ${def.stools != null ? `<div class="row2">${num('fStools', t('editor.furniture.stools'), item.stools ?? def.stools, 1, 'min="0" max="6"')}<span></span></div>` : ''}
          ${def.color ? `<div class="field"><label for="fC">${t('editor.common.color')}</label><input type="color" id="fC" value="${fp.color}"></div>` : ''}`)
        + (item.type === 'stairs' ? this.stairHtml(item, fp, L, num) : '')
        + this.sec(t('editor.section.position'), `<div class="row2">${num('iX', 'X (m)', item.pos[0])}${num('iZ', 'Z (m)', item.pos[1])}</div>${num('iElevation', t('editor.position.elevation'), app.stage.itemElevation(L.id, type, item.id).toFixed(3), 0.01)}<label><input type="checkbox" id="iAutoElevation" ${automaticPlacement(item, type) ? 'checked' : ''}> ${t('editor.position.automatic')}</label><button class="btn small" data-act="onSurface">${t('editor.position.onSurface')}</button>${rot(item.rot)}`) + vis();
    } else if (type === 'room') {
      const surf = Object.entries(SURFACES).filter(([, v]) => (item.kind === 'outdoor') === !!v.outdoor);
      title(t(item.kind === 'outdoor' ? 'editor.roomKind.outdoor' : 'editor.common.room'));
      h = this.sec(t('editor.section.general'), `<div class="field"><label for="rN">${t('editor.common.name')}</label><input type="text" id="rN" value="${esc(item.name)}"></div>
          <div class="field"><label for="rA">${t('editor.room.haArea')}</label><select id="rA"><option value="">—</option>${app.areas().map((a) => `<option value="${a.area_id}" ${a.area_id === item.area_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>`)
        + this.sec(t('editor.section.appearance'), `<div class="row2"><div class="field"><label for="rK">${t('editor.common.type')}</label><select id="rK">${Object.entries(KIND_ROOM).map(([k, key]) => `<option value="${k}" ${k === item.kind ? 'selected' : ''}>${t(key)}</option>`).join('')}</select></div>
          <div class="field"><label for="rS">${t('editor.room.surface')}</label><select id="rS">${surf.map(([k, v]) => `<option value="${k}" ${k === item.surface ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div></div>
          ${item.kind === 'outdoor' ? `<div class="row2">${num('rR', t('editor.room.raise'), item.raise ?? 0, 0.01)}<span></span></div>` : ''}`)
        + (item.kind !== 'void' ? this.sec(t('editor.common.roof'), `<p class="hint">${t(item.kind === 'room' ? 'editor.room.roofHelpRoom' : 'editor.room.roofHelpOther')}</p><div class="actions"><button class="btn small" data-act="roomRoof">${icon('roof')}${t('editor.room.roofThisRoom')}</button></div>`) : '')
        + this.sec(t('editor.common.shape'), `<p class="hint">${t('editor.room.shapeHelp', { area: formatNumber(polyArea(item.points), { minimumFractionDigits: 1, maximumFractionDigits: 1 }), corners: item.points.length })}</p>`);
    } else if (type === 'opening') {
      const S = app.states(); const width = Math.hypot(item.to[0] - item.from[0], item.to[1] - item.from[1]);
      const covers = Object.keys(S).filter((id) => id.startsWith('cover.')), contacts = Object.keys(S).filter((id) => id.startsWith('binary_sensor.') && ['door', 'window', 'garage_door', 'opening'].includes(S[id].attributes.device_class));
      const room = roomOfOpening(L, item);
      const sortA = (ids) => ids.sort((a, b) => (app.areaOf(b) === room?.area_id) - (app.areaOf(a) === room?.area_id) || app.nameOf(a).localeCompare(app.nameOf(b)));
      const opt = (ids, cur) => `<option value="">—</option>` + sortA(ids).map((id) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(app.nameOf(id))}${app.areaOf(id) ? ' · ' + esc(app.areaName(app.areaOf(id))) : ''}</option>`).join('');
      title(t(OPEN_TYPES[item.type]));
      h = `<div class="kind"><div><b>${t(OPEN_TYPES[item.type])}</b><small>${esc(room?.name || '')} · ${esc(L.name)}</small></div></div>`
        + (item.type === 'window' ? `<div class="field" style="margin-top:8px"><label for="oPre">${t('editor.common.template')}</label><select id="oPre"><option value="">${t('editor.opening.customDimensions')}</option>${Object.entries(WINDOW_PRESETS).map(([k, w]) => `<option value="${k}" ${item.preset === k ? 'selected' : ''}>${t(`editor.windowPreset.${k}`)} (${formatNumber(w.w, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m)</option>`).join('')}</select></div>` : '')
        + (item.type !== 'open' ? this.sec(t('editor.section.link'), `${['window', 'garage'].includes(item.type) ? `<div class="field"><label for="oC">${t(item.type === 'garage' ? 'editor.opening.gateDrive' : 'editor.opening.shutter')}</label><select id="oC">${opt(covers, item.cover)}</select></div>${item.cover ? `<label class="chk"><input type="checkbox" id="oInv" ${item.coverInvert ? 'checked' : ''}> ${t('editor.opening.reversePosition')}</label>` : ''}` : ''}
            <div class="field"><label for="oK">${t('editor.opening.contact')}</label><select id="oK">${opt(contacts, item.contact)}</select></div>`) : '')
        + this.sec(t('editor.section.dimensions'), `<div class="row2"><div class="field"><label for="oT">${t('editor.common.type')}</label><select id="oT">${Object.entries(OPEN_TYPES).map(([k, key]) => `<option value="${k}" ${k === item.type ? 'selected' : ''}>${t(key)}</option>`).join('')}</select></div>${num('oW', t('editor.common.widthMeters'), width.toFixed(2), 0.05, 'min="0.3"')}</div>
          <div class="row2">${item.type === 'window' ? num('oS', t('editor.opening.sill'), item.sill ?? 0.9) : '<span></span>'}${num('oH', t('editor.opening.topEdge'), item.head ?? (item.type === 'garage' ? 2.2 : item.type === 'window' ? 2.2 : 2.1))}</div>
          <p class="hint">${t('editor.opening.distancesHelp')}</p>`);
    } else { app.sel = null; return this.renderInspector(); }
    h += `<div class="actions">${['device', 'furniture'].includes(type) ? `<button class="btn small" data-act="rot90">↻ 90°</button><button class="btn small" data-act="dup">${t('editor.common.duplicate')}</button>` : ''}<button class="btn small danger" data-act="del">${t('editor.common.delete')}</button></div>`;
    box.innerHTML = h;
  }
  async onInspChange(e, live = false) {
    const app = this.app, s = app.sel, p = app.plan, site = p.site; const target = e.target, v = target.value, id = target.id;
    const out = (txt) => { const o = target.previousElementSibling?.querySelector?.('output') || target.closest('.field')?.querySelector('output'); if (o) o.textContent = txt; };
    // files
    if (id === 'ulFile' && target.files?.[0]) return this.uploadUnderlay(target.files[0]);
    if (id === 'backupFile' && target.files?.[0]) return this.importBackup(target.files[0]);
    if (id === 'frFile' && target.files?.[0]) { const found = s && findItem(p, s.id); if (found?.type === 'device') await this.uploadArt(found.item, target.files[0]); return this.renderInspector(); }
    if (id === 'jsonFile' && target.files?.[0]) { try { const plan = migrate(JSON.parse(await target.files[0].text())); if (!plan) throw new Error(t('editor.error.unknownFormat')); app.pushUndo(); app.setPlan(plan, { frame: true }); app.markDirty(); app.toast(t('editor.toast.planLoaded')); } catch (err) { app.toast(t('editor.toast.importFailed', { message: err.message })); } return; }
    if (id === 'sh3dFile' && target.files?.[0]) { try { const { plan, stats } = await importSh3d(target.files[0], p); app.pushUndo(); app.setPlan(plan, { frame: true }); app.markDirty(); app.toast(t('editor.toast.sh3dImported', stats)); } catch (err) { console.error(err); app.toast(t('editor.toast.sh3dImportFailed', { message: err.message })); } return; }
    if (id === 'stKeep') { this.keepRoofType = target.checked; this.renderInspector(); return; }
    if (!live || !this._liveUndo) { app.pushUndo(); this._liveUndo = live; } if (!live) this._liveUndo = false;
    // house
    if (id === 'stName') { p.name = v; app.markDirty(); this.renderLeft(); return; }
    if (id === 'stLat' || id === 'stLon') { site[id === 'stLat' ? 'lat' : 'lon'] = v === '' ? null : +v; app.updateSun(); app.markDirty(); return; }
    if (id === 'stNorth') { site.north = +v; out(`${v}°`); app.updateSun(); if (!live) app.stage.layout(); app.markDirty(); return; }
    if (id === 'faPlinthH') { const h = parseFloat(v); if (Number.isFinite(h) && h >= 0) site.facade.plinthHeight = Math.min(h, 1.5); else delete site.facade.plinthHeight; clearTimeout(this._facT); this._facT = setTimeout(() => app.stage.rebuildAll(), live ? 150 : 0); app.markDirty(); return; }
    if (['faMat', 'faColor', 'faPlinth', 'faFrame'].includes(id)) { site.facade[{ faMat: 'material', faColor: 'color', faPlinth: 'plinth', faFrame: 'frame' }[id]] = v; clearTimeout(this._facT); this._facT = setTimeout(() => { app.stage.rebuildAll(); this.showRoofIfOff(); }, live ? 150 : 0); app.markDirty(); if (!live) this.renderInspector(); return; }
    if (['rfRot', 'rfRotN', 'rfLen', 'rfWid', 'rfCx', 'rfCz'].includes(id)) {
      const r = site.roof; r.rect = { ...this.roofRectNow() }; const R = r.rect;
      if (id === 'rfRot' || id === 'rfRotN') { R.rot = ((+v + 540) % 360) - 180; if (id === 'rfRot') out(`${formatNumber(+v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°`); }
      if (id === 'rfLen') R.length = Math.max(0.5, +v); if (id === 'rfWid') R.width = Math.max(0.5, +v); if (id === 'rfCx') R.cx = +v; if (id === 'rfCz') R.cz = +v;
      clearTimeout(this._roofT); this._roofT = setTimeout(() => { app.stage.layout(); this.roofHandles(); }, live ? 60 : 0); this.dimsDirty = true; app.markDirty(); if (!live) this.renderInspector(); return;
    }
    if (['rfType', 'rfCover', 'rfColor', 'rfPitch', 'rfOh', 'rfRidge', 'rfOhG', 'rfROff', 'rfKnee'].includes(id)) {
      const r = site.roof;
      if (id === 'rfOhG') r.overhangGable = +v; if (id === 'rfROff') r.ridgeOffset = Math.max(-45, Math.min(45, +v)) / 100; if (id === 'rfKnee') r.knee = Math.max(0, +v);
      if (id === 'rfType') { r.type = v; const flat = v === 'flat'; if (!!ROOF_COVERS[r.cover]?.flat !== flat) { r.cover = flat ? 'kies' : 'pfanne'; r.color = ROOF_COVERS[r.cover].color; } }
      if (id === 'rfCover') { r.cover = v; r.color = ROOF_COVERS[v].color; }
      if (id === 'rfColor') r.color = v; if (id === 'rfPitch') r.pitch = +v; if (id === 'rfOh') r.overhang = +v; if (id === 'rfRidge') r.ridge = v || undefined;
      this.showRoofIfOff(); clearTimeout(this._roofT); this._roofT = setTimeout(() => app.stage.layout(), live ? 120 : 0); app.markDirty(); if (!live) this.renderInspector(); this.renderLeft(); return;
    }
    if (['dtSoffit', 'dtRafters', 'dtPurlins', 'dtFly', 'dtBrackets', 'dtBraces', 'dtSpacing', 'dtRh', 'dtPOut', 'dtBarge', 'dtWood'].includes(id)) {
      const D = (site.roof.details = { ...DEFAULT_DETAILS, ...(site.roof.details || {}) }); const c = target.checked;
      ({ dtSoffit: () => (D.soffit = v), dtRafters: () => (D.rafters = c), dtPurlins: () => (D.purlins = c), dtFly: () => (D.flyRafter = c), dtBrackets: () => (D.brackets = c), dtBraces: () => (D.braces = c), dtSpacing: () => (D.spacing = Math.max(0.3, +v)), dtRh: () => (D.rh = Math.max(0.06, +v / 100)), dtPOut: () => (D.purlinOut = Math.max(0, +v)), dtBarge: () => (D.barge = v), dtWood: () => (D.wood = v) })[id]();
      if (id === 'dtSoffit' && v === 'open' && !D.rafters) D.rafters = true;
      this.showRoofIfOff(); clearTimeout(this._roofT); this._roofT = setTimeout(() => app.stage.layout(), live ? 150 : 0); app.markDirty(); if (!live && id !== 'dtWood') this.renderInspector(); return;
    }
    if (s?.type === 'roofitem') return this.roofItemInput(id, v, t, live);
    if (s?.type === 'xroof') {
      const x = (site.roofs || []).find((r) => r.id === s.id); if (!x) return; x.rect ||= { cx: 0, cz: 0, length: 3, width: 3, rot: 0 }; const R = x.rect;
      if (id === 'xrName') { x.name = v; this.renderLeft(); app.markDirty(); return; }
      if (id === 'xrType') { x.type = v; const fl = v === 'flat'; if (!!ROOF_COVERS[x.cover]?.flat !== fl) x.cover = fl ? (x.posts ? 'blech' : 'kies') : 'pfanne'; if (!fl && (x.pitch ?? 0) < 10) x.pitch = 25; }
      if (id === 'xrCover') x.cover = v; if (id === 'xrPitch') x.pitch = +v; if (id === 'xrOh') x.overhang = Math.max(0, +v); if (id === 'xrLevel') x.levelId = v; if (id === 'xrH') x.height = Math.max(1.8, +v); if (id === 'xrPosts') x.posts = target.checked;
      if (id === 'xrLen') R.length = Math.max(0.5, +v); if (id === 'xrWid') R.width = Math.max(0.5, +v); if (id === 'xrCx') R.cx = +v; if (id === 'xrCz') R.cz = +v; if (id === 'xrRot') R.rot = ((+v + 540) % 360) - 180;
      app.stage.layout(); app.markDirty(); if (!live && ['xrType', 'xrPosts', 'xrLevel', 'xrRot'].includes(id)) { this.renderInspector(); this.renderLeft(); } else if (!live) this.renderInspector(); return;
    }
    if (s?.type === 'solar') {
      const a = site.solar.find((x) => x.id === s.id); if (!a) return;
      if (id === 'pvPlane') a.plane = v === 'auto' ? 'auto' : +v; if (id === 'pvRows') a.rows = Math.max(1, Math.round(+v)); if (id === 'pvCols') a.cols = Math.max(1, Math.round(+v)); if (id === 'pvOrient') a.portrait = v === '1';
      if (id === 'pvOu' || id === 'pvOv') { a.offset = a.offset || [0, 0]; a.offset[id === 'pvOu' ? 0 : 1] = +v; } if (id === 'pvEnt') a.entity_id = v || null; if (id === 'pvPeak') a.peak_kw = +v;
      app.stage.layout(); app.markDirty(); this.renderLeft(); app.scheduleUI(); return;
    }
    if (s?.type === 'level') {
      const L = p.levels.find((l) => l.id === s.id); if (!L) return;
      if (id === 'lvName') { L.name = v; app.renderLevels(); this.renderLeft(); this.renderStatus(); app.markDirty(); return; }
      if (id === 'lvFloor') { L.floor_id = v || null; app.markDirty(); return; }
      if (id === 'lvCut') { L.cutHeight = +v; out(`${formatNumber(+v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`); clearTimeout(this._cutT); this._cutT = setTimeout(() => { app.stage.rebuildLevel(L.id); app.markDirty(); }, 120); return; }
      if (id === 'ulOpacity') { L.underlay.opacity = +v; out(`${Math.round(v * 100)} %`); app.stage.updateUnderlay(L.id); app.markDirty(); return; }
      if (id === 'ulShow3d') { L.underlay.show3d = target.checked; app.stage.layout(); app.markDirty(); return; }
      if (id === 'ulX' || id === 'ulZ') { L.underlay[id === 'ulX' ? 'x0' : 'z0'] = +v; app.stage.updateUnderlay(L.id); app.markDirty(); return; }
      if (id === 'lvH') { L.height = Math.max(1.8, +v); L.cutHeight = Math.min(L.cutHeight, L.height); }
      if (id === 'lvSlab') L.slab = Math.max(0, +v);
      if (id === 'lvAuto') L.autoElevation = target.checked ? undefined : false;
      if (id === 'lvElev') { L.elevation = +v; if (p.levels.indexOf(L) > 0) L.autoElevation = false; }
      computeElevations(p); app.stage.rebuildAll(); app.renderLevels(); app.buildLabels(); app.markDirty(); this.renderInspector(); this.renderLeft(); this.renderStatus(); return;
    }
    const f = s && findItem(p, s.id); if (!f) return;
    const { item, level: L, type } = f;
    if (id === 'iAutoElevation') { item.autoElevation = target.checked; if (!target.checked) item.elevation = app.stage.itemElevation(L.id, type, item.id); app.stage.settleItem(L.id, type, item); app.markDirty(); this.renderInspector(); return; }
    if (id === 'iHidden' || id === 'iLocked') { if (target.checked) item[id === 'iHidden' ? 'hidden' : 'locked'] = true; else delete item[id === 'iHidden' ? 'hidden' : 'locked']; if (id === 'iHidden') { app.stage.refreshItem(L.id, type, item); app.stage.select(s); } app.markDirty(); this.renderLeft(); return; }
    if (id === 'iRot') { item.rot = +v; out(`${v}°`); app.stage.moveItem(L.id, type, item); app.markDirty(); return; }
    if (type === 'device') {
      if (id === 'iEnt') item.entity_id = v || undefined; if (id === 'iStyle') { item.style = v; Object.assign(item, deviceDefaults(item.kind, v)); markStandaloneProjectorScreen(item); } if (id === 'iKind') { item.kind = v; delete item.style; delete item.y; Object.assign(item, deviceDefaults(v)); }
      if (id === 'iElevation') { item.elevation = Number.isFinite(+v) ? +v : 0; item.autoElevation = false; } if (id === 'iX') item.pos[0] = +v; if (id === 'iZ') item.pos[1] = +v; if (id === 'iY') { if (v === '') delete item.y; else item.y = +v; } if (id === 'iL') { if (v === '') delete item.length; else item.length = +v; }
      if (id === 'iCurve') item.curve = Math.max(1, +v);
      if (id === 'frSrc') { item.src = v; if (v === 'entity' && !item.entity_id) app.toast(t('editor.frame.linkHint')); }
      if (id === 'frSize' && FRAME_SIZES[v]) { const [, w, h] = FRAME_SIZES[v]; const landscape = (item.fw || 0.5) > (item.fh || 0.7) && v !== 'pano'; item.fw = landscape ? h : w; item.fh = landscape ? w : h; }
      if (id === 'frW') item.fw = Math.max(0.1, +v); if (id === 'frH') item.fh = Math.max(0.1, +v); if (id === 'frStyle') item.frame = v; if (id === 'frPasse') item.passe = target.checked; if (id === 'frInt') item.interval = Math.max(30, +v); if (id === 'frFolder') item.folder = v || undefined;
      app.stage.refreshItem(L.id, type, item);
      if (['iX', 'iZ', 'fW', 'fD', 'fH'].includes(id)) app.stage.settleItem(L.id, type, item);
    } else if (type === 'furniture') {
      if (id === 'stShape') { item.shape = v === 'straight' ? undefined : v; if (v === 'half' && (item.width ?? 1) < 2) item.width = 2.2; if (v === 'quarter' && (item.width ?? 1) < 2) item.width = 2.2; }
      if (id === 'stTurn') item.turn = v; if (id === 'stFw') item.fw = Math.max(0.6, +v); if (id === 'lEnt') item.entity_id = v || undefined;
      if (id === 'iElevation') { item.elevation = Number.isFinite(+v) ? +v : 0; item.autoElevation = false; } if (id === 'iX') item.pos[0] = +v; if (id === 'iZ') item.pos[1] = +v; if (id === 'fLift') item.lift = Number.isFinite(+v) ? +v : 0; if (id === 'fW') item.width = +v; if (id === 'fD') item.depth = +v; if (id === 'fH') item.height = +v; if (id === 'fC') item.color = v; if (id === 'fChairs') item.chairs = +v; if (id === 'fStools') item.stools = +v;
      app.stage.refreshItem(L.id, type, item);
      if (['iX', 'iZ', 'fW', 'fD', 'fH'].includes(id)) app.stage.settleItem(L.id, type, item);
    } else if (type === 'room') {
      if (id === 'rN') item.name = v; if (id === 'rA') item.area_id = v || null; if (id === 'rS') item.surface = v; if (id === 'rR') item.raise = +v;
      if (id === 'rK') { item.kind = v; const outdoor = v === 'outdoor'; if (outdoor !== !!SURFACES[item.surface]?.outdoor) item.surface = outdoor ? 'lawn' : v === 'garage' ? 'concrete' : 'oak'; }
      app.stage.rebuildLevel(L.id); app.buildLabels();
    } else if (type === 'opening') {
      if (id === 'oPre' && WINDOW_PRESETS[v]) { const w = WINDOW_PRESETS[v]; item.preset = v; item.sill = w.sill; item.head = w.head; const cx = (item.from[0] + item.to[0]) / 2, cz = (item.from[1] + item.to[1]) / 2, dx = item.to[0] - item.from[0], dz = item.to[1] - item.from[1], L0 = Math.hypot(dx, dz) || 1; item.from = [r3(cx - dx / L0 * w.w / 2), r3(cz - dz / L0 * w.w / 2)]; item.to = [r3(cx + dx / L0 * w.w / 2), r3(cz + dz / L0 * w.w / 2)]; }
      if (['oS', 'oH', 'oW'].includes(id)) delete item.preset;
      if (id === 'oT') item.type = v; if (id === 'oS') item.sill = +v; if (id === 'oH') item.head = +v; if (id === 'oC') item.cover = v || undefined; if (id === 'oInv') item.coverInvert = target.checked || undefined; if (id === 'oK') item.contact = v || undefined;
      if (id === 'oW') { const w = Math.max(0.3, +v); const cx = (item.from[0] + item.to[0]) / 2, cz = (item.from[1] + item.to[1]) / 2, dx = item.to[0] - item.from[0], dz = item.to[1] - item.from[1], L0 = Math.hypot(dx, dz) || 1; item.from = [r3(cx - dx / L0 * w / 2), r3(cz - dz / L0 * w / 2)]; item.to = [r3(cx + dx / L0 * w / 2), r3(cz + dz / L0 * w / 2)]; }
      app.stage.rebuildLevel(L.id);
    }
    app.stage.select(s); app.markDirty(); app.scheduleUI(true); this.dimsDirty = true; this.markSelection();
    if (['iElevation', 'iX', 'iZ', 'oT', 'oPre', 'iKind', 'iStyle', 'rK', 'iEnt', 'oC', 'oK', 'stShape', 'stTurn', 'frSrc', 'frSize', 'frStyle', 'lEnt'].includes(id)) { this.renderInspector(); this.renderLeft(); }
    else if (['stFw', 'fW', 'fD', 'fH'].includes(id) && item?.type === 'stairs') this.renderInspector();
  }
  showRoofIfOff() { const app = this.app; if (!app.roofOn && app.hasRoof()) app.setLevel('all'); }
  onInspClick(e) {
    const app = this.app, s = app.sel, p = app.plan, L = this.level;
    const sty = e.target.closest('[data-style]'); if (sty) { app.pushUndo(); applyStyle(p.site, sty.dataset.style, { keepType: this.keepRoofType !== false }); this.showRoofIfOff(); app.stage.rebuildAll(); app.stage.layout(); app.markDirty(); this.renderInspector(); app.toast(t('editor.toast.styleApplied', { style: ROOF_STYLES[sty.dataset.style].label })); return; }
    const hd = e.target.closest('[data-head]'); if (hd) { app.pushUndo(); const D = (p.site.roof.details = { ...DEFAULT_DETAILS, ...(p.site.roof.details || {}) }); D.head = hd.dataset.head; if (D.head === 'bracket') D.brackets = true; app.stage.layout(); app.markDirty(); this.renderInspector(); return; }
    const wd = e.target.closest('[data-wood]'); if (wd) { app.pushUndo(); const D = (p.site.roof.details = { ...DEFAULT_DETAILS, ...(p.site.roof.details || {}) }); D.wood = wd.dataset.wood; app.stage.layout(); app.markDirty(); this.renderInspector(); return; }
    const ri = e.target.closest('[data-ritem]'); if (ri) { this.select({ type: 'roofitem', id: ri.dataset.ritem }); return; }
    const fc = e.target.closest('[data-fcol]'); if (fc) { app.pushUndo(); p.site.facade.color = fc.dataset.fcol; app.stage.rebuildAll(); this.showRoofIfOff(); app.markDirty(); this.renderInspector(); return; }
    const so = e.target.closest('[data-solar]'); if (so) { this.showRoof(); return this.select({ type: 'solar', id: so.dataset.solar }); }
    const xb = e.target.closest('[data-xroof]'); if (xb) return this.select({ type: 'xroof', id: xb.dataset.xroof });
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    if (act === 'toolRoof') return this.setTool('roofrect');
    if (act === 'roomRoof' && s?.type === 'room') { const f = findItem(p, s.id); if (f) return this.addExtraRoof(f.item.points, { levelId: f.level.id, room: f.item }); return; }
    if (act === 'xrRot90' || act === 'xrDup') { const x = (p.site.roofs || []).find((r) => r.id === s?.id); if (!x) return; app.pushUndo();
      if (act === 'xrRot90') { x.rect.rot = ((x.rect.rot + 90 + 540) % 360) - 180; const l = x.rect.length; x.rect.length = x.rect.width; x.rect.width = l; app.stage.layout(); app.markDirty(); return this.renderInspector(); }
      const c = structuredClone(x); c.id = newId('xr'); c.name = t('editor.common.copyName', { name: x.name }); c.rect.cx = r3(c.rect.cx + 1); p.site.roofs.push(c); app.stage.layout(); app.markDirty(); return this.select({ type: 'xroof', id: c.id }); }
    if (act === 'frTurn') { const found = findItem(p, s?.id); if (!found) return; app.pushUndo(); const width = found.item.fw || 0.5; found.item.fw = found.item.fh || 0.7; found.item.fh = width; app.stage.refreshItem(found.level.id, 'device', found.item); app.markDirty(); return this.renderInspector(); }
    if (act === 'stFlip' || act === 'stFit') { const f = findItem(p, s?.id); if (!f) return; app.pushUndo(); const it = f.item;
      if (act === 'stFlip') it.rot = (((it.rot || 0) + 180 + 180) % 360) - 180;
      else { const i = p.levels.indexOf(f.level), up = p.levels[i + 1]; if (up) it.height = r3(up.elevation - f.level.elevation); }
      app.stage.refreshItem(f.level.id, 'furniture', it); app.markDirty(); return this.renderInspector(); }
    if (act === 'onSurface') {
      const found = s && findItem(p, s.id); if (!found || !['device', 'furniture'].includes(found.type)) return;
      const elevation = app.stage.supportElevation(found.level.id, found.type, found.item.id);
      app.pushUndo(); app.applyLocal({ op: 'move_item', level_id: found.level.id, item_id: found.item.id, elevation, autoElevation: true });
      this.renderInspector(); return;
    }
    if (act === 'rot90') return this.rotateSel();
    if (act === 'del') return this.deleteSel();
    if (act === 'dup') return this.duplicateSel();
    if (act === 'roofRot') { app.pushUndo(); const r = p.site.roof; r.rect = { ...this.roofRectNow() }; r.rect.rot = ((r.rect.rot + +e.target.closest('[data-deg]').dataset.deg + 540) % 360) - 180; app.stage.layout(); this.roofHandles(); this.dimsDirty = true; app.markDirty(); this.renderInspector(); return; }
    if (act === 'roofFit') { app.pushUndo(); delete p.site.roof.rect; app.stage.layout(); this.roofHandles(); this.dimsDirty = true; app.markDirty(); this.renderInspector(); return; }
    if (act === 'resetAll') {
      if (!confirm(t('editor.confirm.resetAll'))) return;
      this.images?.clear?.(); app.undoStack = []; app.redoStack = []; app.setPlan(emptyPlan(), { frame: true }); app.markDirty(); app.setMode('view'); app._firstRun = true; app.showOnboarding(); return;
    }
    if (act === 'wizard') return app.wizard.open({ levelId: s?.type === 'level' ? s.id : L.id });
    if (act === 'addRoofWin' || act === 'addDormer') {
      app.pushUndo(); const dormer = act === 'addDormer'; const top = [...app.stage.levels.values()].find((o) => o.roof)?.roof;
      const pls = (top?.planes || []).map((pl, i) => ({ pl, i })).filter((x) => !x.pl.flat); const best = pls.sort((a, b) => Math.abs(((a.pl.azimuth ?? 180) - 180 + 540) % 360 - 180) - Math.abs(((b.pl.azimuth ?? 180) - 180 + 540) % 360 - 180))[0];
      const it = { id: newId(dormer ? 'gb' : 'dfw'), kind: dormer ? 'dormer' : 'window', plane: best?.i ?? 0, u: (((p.site.roofItems || []).length % 3) - 1) * 1.6, v: best ? +(best.pl.frame.slope * (dormer ? 0.3 : 0.45)).toFixed(2) : 2, w: dormer ? 1.8 : 0.78, h: dormer ? 1.3 : 1.18, cover: null, contact: null };
      if (dormer) it.dormer = { type: 'gable', h: 1.3 };
      (p.site.roofItems ||= []).push(it); this.showRoof(); app.stage.layout(); app.markDirty(); this.expanded.add('roof:roof'); return this.select({ type: 'roofitem', id: it.id });
    }
    if (act === 'delRoofItem') { app.pushUndo(); p.site.roofItems = (p.site.roofItems || []).filter((x) => x.id !== app.sel?.id); app.stage.layout(); app.markDirty(); return this.select({ type: 'roof', id: 'roof' }); }
    if (act === 'addSolar') { app.pushUndo(); const a = { id: newId('pv'), plane: 'auto', rows: 2, cols: 5, portrait: true, offset: [0, 0], entity_id: null, peak_kw: 4 }; p.site.solar.push(a); this.showRoof(); app.stage.layout(); app.markDirty(); this.expanded.add('roof:roof'); return this.select({ type: 'solar', id: a.id }); }
    if (act === 'delSolar') { app.pushUndo(); p.site.solar = p.site.solar.filter((x) => x.id !== s.id); app.stage.layout(); app.markDirty(); return this.select({ type: 'roof', id: 'roof' }); }
    if (act === 'backupExport') return this.exportBackup();
    if (act === 'export') return this.showModal(t('editor.file.planJsonTitle'), JSON.stringify(p, null, 2));
    if (act === 'demo' || act === 'empty') { app.pushUndo(); app.setPlan(act === 'demo' ? demoPlan() : emptyPlan(), { frame: true }); app.markDirty(); return this.select(null); }
    if (act === 'aiPlan') return app.agent.open(t('editor.ai.detectFloorPlanPrompt'), { image: true });
    if (act === 'calStart') return this.setTool('calibrate');
    if (act === 'calApply') { const real = parseFloat(String(app.$('calReal')?.value).replace(',', '.')); if (real > 0 && this.calib?.measured) { app.pushUndo(); L.underlay.mpp *= real / this.calib.measured; this.calib = null; app.stage.updateUnderlay(L.id); app.markDirty(); this.setTool('select'); this.renderInspector(); app.toast(t('editor.toast.scaleApplied')); } return; }
    if (act === 'ulRemove') { app.pushUndo(); L.underlay = null; app.stage.setUnderlay(L.id, null); app.markDirty(); this.renderInspector(); this.renderBar(); return; }
    if (act === 'addLevel' || act === 'addBasement') {
      app.pushUndo(); const top = p.levels[p.levels.length - 1], bottom = p.levels[0];
      const nl = act === 'addLevel' ? newLevel(p.levels.length === 1 ? t('editor.level.upperFloor') : t('editor.level.numbered', { number: p.levels.length }), top.elevation + top.height + slabThickness({}), { height: DEFAULT_ROOM_HEIGHT }) : newLevel(t('editor.level.basement'), r3(bottom.elevation - DEFAULT_BASEMENT_HEIGHT - slabThickness(bottom)), { height: DEFAULT_BASEMENT_HEIGHT });
      const src = act === 'addLevel' ? top : bottom;
      nl.rooms = src.rooms.filter((r) => r.kind === 'room' || r.kind === 'garage').map((r) => ({ id: newId('r'), name: act === 'addLevel' ? t('editor.level.upperRoomName', { name: r.name }) : t('editor.level.basementRoom'), kind: 'room', surface: act === 'addLevel' ? 'oak' : 'concrete', area_id: null, points: r.points.map((q) => [...q]) }));
      if (act === 'addBasement') { nl.autoElevation = false; bottom.autoElevation = bottom.autoElevation ?? undefined; }
      p.levels.push(nl); computeElevations(p); app.stage.rebuildAll(); app.setLevel(nl.id); app.markDirty(); this.select({ type: 'level', id: nl.id, level: nl.id }); app.toast(t('editor.toast.levelCreated', { name: nl.name, elevation: formatNumber(nl.elevation, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }));
      return;
    }
    if (act === 'delLevel') { app.pushUndo(); p.levels.splice(p.levels.indexOf(L), 1); computeElevations(p); app.stage.rebuildAll(); app.setLevel(p.levels[0].id); app.markDirty(); return this.select(null); }
  }
  rotateSel() {
    const sel = this.selection().filter((s) => ['device', 'furniture'].includes(s.type)); if (!sel.length) return; this.app.pushUndo();
    for (const s of sel) { const f = findItem(this.app.plan, s.id); if (!f || f.item.locked) continue; f.item.rot = (((f.item.rot || 0) + 90 + 180) % 360) - 180; this.app.stage.moveItem(f.level.id, s.type, f.item); }
    this.app.markDirty(); this.renderInspector();
  }
  duplicateSel() {
    if (this.app.sel?.type === 'roofitem') { const app = this.app, src = (app.plan.site.roofItems || []).find((x) => x.id === app.sel.id); if (!src) return; app.pushUndo(); const it = structuredClone(src); it.id = newId('dfw'); it.u = r3((it.u || 0) + it.w + 0.4); it.cover = null; it.contact = null; app.plan.site.roofItems.push(it); app.stage.layout(); app.markDirty(); return this.select({ type: 'roofitem', id: it.id }); }
    const app = this.app, sel = this.selection().filter((s) => ['device', 'furniture'].includes(s.type)); if (!sel.length) return; app.pushUndo(); const out = [];
    for (const s of sel) { const f = findItem(app.plan, s.id); if (!f) continue; const it = structuredClone(f.item); it.id = newId(s.type[0]); it.pos = [r3(it.pos[0] + 0.4), r3(it.pos[1] + 0.4)]; delete it.locked; if (s.type === 'device') delete it.entity_id; f.list.push(it); s.type === 'device' ? app.stage.addDevice(f.level.id, it) : app.stage.addFurniture(f.level.id, it); out.push({ type: s.type, id: it.id, level: f.level.id }); }
    app.markDirty(); this.select(out[0]); out.slice(1).forEach((x) => this.select(x, { add: true }));
  }
  deleteSel() {
    const s = this.app.sel; if (!s) return;
    if (this.multi?.length) {
      this.app.pushUndo();
      for (const x of this.selection()) { const f = findItem(this.app.plan, x.id); if (!f) continue; f.list.splice(f.list.indexOf(f.item), 1); x.type === 'device' ? this.app.stage.removeDevice(f.level.id, x.id) : this.app.stage.removeFurniture(f.level.id, x.id); }
      this.select(null); this.app.markDirty(); this.app.scheduleUI(true); return;
    }
    if (s.type === 'roofitem') { this.app.pushUndo(); this.app.plan.site.roofItems = (this.app.plan.site.roofItems || []).filter((x) => x.id !== s.id); this.app.stage.layout(); this.app.markDirty(); return this.select({ type: 'roof', id: 'roof' }); }
    if (s.type === 'xroof') { this.app.pushUndo(); this.app.plan.site.roofs = (this.app.plan.site.roofs || []).filter((x) => x.id !== s.id); this.app.stage.setMarks(null); this.app.stage.layout(); this.app.markDirty(); this.renderLeft(); return this.select(null); }
    if (s.type === 'solar') { this.app.pushUndo(); this.app.plan.site.solar = this.app.plan.site.solar.filter((x) => x.id !== s.id); this.app.stage.layout(); this.app.markDirty(); return this.select(null); }
    if (!['device', 'furniture', 'room', 'opening'].includes(s.type)) return;
    const f = findItem(this.app.plan, s.id); if (!f) return;
    this.app.pushUndo(); f.list.splice(f.list.indexOf(f.item), 1);
    if (s.type === 'device') this.app.stage.removeDevice(f.level.id, s.id); else if (s.type === 'furniture') this.app.stage.removeFurniture(f.level.id, s.id); else { this.app.stage.rebuildLevel(f.level.id); this.app.buildLabels(); }
    this.select(null); this.app.markDirty(); this.app.scheduleUI(true);
  }
  onKey(e) {
    if (this.app.mode !== 'edit') return;
    const tag = e.composedPath()[0]?.tagName; if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.app.redo() : this.app.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.app.redo(); return; }
    if (e.key === 'v' || e.key === 'V') this.setTool('select');
    if (e.key === 'r' || e.key === 'R') this.rotateSel();
    if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSel();
    if (e.key === 'Escape') { if (this.draw) { this.draw = null; this.app.stage.setPreview(null); this.dimsDirty = true; } else if (this.tool !== 'select') this.setTool('select'); else this.select(null); }
    if (e.key === 'Enter' && this.draw?.poly) this.finishPoly();
  }

  /* ---------------- pointer interaction ---------------- */
  vertices(L) { return L.rooms.flatMap((r) => r.points); }
  pointerDown(e) {
    if (e.button !== 0) return; const app = this.app, st = app.stage, L = this.level;
    if (this.tool === 'rect' || this.tool === 'roofrect') { const p = st.floorPoint(e, L.id); if (!p) return; this.draw = { rect: true, a: snapPoint(p, this.vertices(L)) }; return; }
    if (this.tool !== 'select') return;
    const p = st.pick(e, { furniture: true, handles: true, levelId: L.id });
    if (p?.type === 'handle' && p.room === '__roof') {
      const R = this.roofRectNow(); const c = rectCorners(R); app.pushUndo();
      this.drag = { roofCorner: true, fixed: c[(p.handle + 2) % 4], axes: rectAxes(R), rot: R.rot }; st.controls.enabled = false; return;
    }
    if (p?.type === 'handle') {
      const r = L.rooms.find((x) => x.id === p.room); app.pushUndo();
      if (p.mid) { r.points.splice(p.handle + 1, 0, [...st.floorPoint(e, L.id).map(r3)]); this.drag = { vertex: true, room: r, idx: p.handle + 1 }; }
      else {
        const now = Date.now(); if (this._lastV?.idx === p.handle && now - this._lastV.t < 350 && r.points.length > 3) { r.points.splice(p.handle, 1); st.rebuildLevel(L.id); st.setHandles(L, r); app.markDirty(); this._lastV = null; return; }
        this._lastV = { idx: p.handle, t: now }; this.drag = { vertex: true, room: r, idx: p.handle };
      }
      st.controls.enabled = false; return;
    }
    if (p?.type === 'xroof') { this.select({ type: 'xroof', id: p.id }); this._pendingPick = p; return; }
    if (p?.type === 'solar' || p?.type === 'roofitem') { this.select({ type: p.type, id: p.id }); this._pendingPick = p; if (p.type === 'roofitem') { this.drag = { roofItem: p.id, undo: false }; st.controls.enabled = false; } return; }
    if (p && (p.type === 'device' || p.type === 'furniture')) {
      if (e.shiftKey) { this.select({ type: p.type, id: p.id, level: p.level }, { add: true }); this._pendingPick = { type: 'none' }; return; }
      const inGroup = this.selection().some((x) => x.id === p.id);
      if (!inGroup) this.select({ type: p.type, id: p.id, level: p.level });
      const fp = st.floorPoint(e, L.id); const f = findItem(app.plan, p.id);
      if (f.item.locked || !fp) { this._pendingPick = p; return; }
      const group = this.selection().map((x) => ({ ...x, item: findItem(app.plan, x.id)?.item })).filter((x) => x.item && !x.item.locked && x.item.pos);
      this.drag = { item: f.item, type: p.type, group, start: fp, orig: group.map((x) => [...x.item.pos]), segs: wallSegments(L), moved: false, undo: false }; st.controls.enabled = false; return;
    }
    if (p?.type === 'opening') { this.select({ type: 'opening', id: p.id, level: p.level }); this._pendingPick = p; return; }
    if (p?.type === 'room' && app.sel?.type === 'room' && app.sel.id === p.id && st.topView) {
      const r = L.rooms.find((x) => x.id === p.id); const fp = st.floorPoint(e, L.id); this.drag = { roomMove: true, room: r, start: fp, orig: r.points.map((q) => [...q]), undo: false }; return;
    }
    this._pendingPick = p;
    // In 2D, dragging on empty floor or an unselected room draws a selection rectangle.
    if (st.topView && (!p || p.type === 'room')) { const fp = st.floorPoint(e, L.id); if (fp) this.marquee = { a: fp, b: fp, x: e.clientX, y: e.clientY, active: false, shift: e.shiftKey }; }
  }
  roofItemInput(id, v, t, live) {
    const app = this.app, it = (app.plan.site.roofItems || []).find((x) => x.id === app.sel.id); if (!it) return;
    if (id === 'riKind') { it.kind = v; if (v === 'dormer') { it.w = Math.max(1.4, it.w); it.dormer = it.dormer || { type: 'gable', h: 1.3 }; } else { it.w = 0.78; it.h = 1.18; } }
    if (id === 'riPlane') it.plane = +v; if (id === 'riU') it.u = +v; if (id === 'riV') it.v = Math.max(0.2, +v);
    if (id === 'riSize' && v) [it.w, it.h] = ROOF_WINDOWS[v];
    if (id === 'riW') it.w = Math.max(0.4, +v); if (id === 'riH') it.h = Math.max(0.4, +v);
    if (id === 'riDH') (it.dormer ||= { type: 'gable' }).h = Math.max(0.6, +v); if (id === 'riDType') (it.dormer ||= { h: 1.3 }).type = v;
    if (id === 'riCover') it.cover = v || null; if (id === 'riInv') it.coverInvert = t.checked || undefined; if (id === 'riContact') it.contact = v || null;
    const o = [...app.stage.levels.values()].find((x) => x.roof?.rebuildItem); if (o) o.roof.rebuildItem(it); else app.stage.layout(); app.markDirty(); if (!live) { this.renderInspector(); this.renderLeft(); }
  }
  pointerMove(e) {
    const app = this.app, st = app.stage, L = this.level;
    if (!this._coordT) { this._coordT = requestAnimationFrame(() => { this._coordT = null; }); const fp = st.floorPoint(e, L.id), el = app.$('stCoord'); if (fp && el) el.textContent = `x ${formatNumber(fp[0], { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · z ${formatNumber(fp[1], { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`; }
    if (this.drag?.roofItem) {
      const it = (app.plan.site.roofItems || []).find((x) => x.id === this.drag.roofItem); const rp = it && st.roofPlanePoint(e); if (!rp) return true;
      if (!this.drag.undo) { app.pushUndo(); this.drag.undo = true; }
      it.plane = rp.plane; it.u = r3(Math.max(-rp.width / 2 + it.w / 2 + 0.2, Math.min(rp.width / 2 - it.w / 2 - 0.2, snap(rp.u))));
      it.v = r3(Math.max(0.3, Math.min(rp.slope - (it.kind === 'dormer' ? 0.8 : it.h), snap(rp.v))));
      if (!this._rh) this._rh = requestAnimationFrame(() => { this._rh = null; const o = [...st.levels.values()].find((x) => x.roof?.rebuildItem); o ? o.roof.rebuildItem(it) : st.layout(); }); return true;
    }
    if (this.drag?.roofCorner) {
      const T = st.topLevel(); const fp0 = st.floorPoint(e, T.id); if (!fp0) return true; const fp = [snap(fp0[0]), snap(fp0[1])];
      const d = this.drag, o = d.fixed, dx = fp[0] - o[0], dz = fp[1] - o[1];
      const length = Math.max(0.5, Math.abs(dx * d.axes.X[0] + dz * d.axes.X[1])), width = Math.max(0.5, Math.abs(dx * d.axes.Z[0] + dz * d.axes.Z[1]));
      app.plan.site.roof.rect = { cx: r3((fp[0] + o[0]) / 2), cz: r3((fp[1] + o[1]) / 2), length: r3(length), width: r3(width), rot: d.rot };
      this.dimsDirty = true; if (!this._rh) this._rh = requestAnimationFrame(() => { this._rh = null; this.roofHandles(); if (!st.topView) app.stage.layout(); }); return true;
    }
    if (this.drag) {
      const fp = st.floorPoint(e, L.id); if (!fp) return true;
      if (this.drag.vertex) { const others = this.vertices(L).filter((q) => q !== this.drag.room.points[this.drag.idx]); const prev = this.drag.room.points[(this.drag.idx - 1 + this.drag.room.points.length) % this.drag.room.points.length]; this.drag.room.points[this.drag.idx] = snapPoint(fp, others, prev); this.throttleRebuild(L, this.drag.room); return true; }
      if (this.drag.roomMove) { if (!this.drag.undo) { app.pushUndo(); this.drag.undo = true; } const dx = snap(fp[0] - this.drag.start[0]), dz = snap(fp[1] - this.drag.start[1]); this.drag.room.points = this.drag.orig.map(([x, z]) => [r3(x + dx), r3(z + dz)]); this.throttleRebuild(L, this.drag.room); return true; }
      if (this.drag.item) {
        if (!this.drag.undo) { app.pushUndo(); this.drag.undo = true; }
        const d = this.drag, dx = snap(fp[0] - d.start[0]), dz = snap(fp[1] - d.start[1]);
        d.group.forEach((g, i) => { g.item.pos = [r3(d.orig[i][0] + dx), r3(d.orig[i][1] + dz)]; if (d.group.length === 1) placeItem(L, g.type, g.item, d.segs); st.moveItem(L.id, g.type, g.item); });
        d.moved = true; return true;
      }
    }
    if (this.marquee) {
      const m = this.marquee; if (!m.active && Math.hypot(e.clientX - m.x, e.clientY - m.y) > 6) m.active = true;
      if (m.active) { const fp = st.floorPoint(e, L.id); if (fp) { m.b = fp; st.setPreview([[m.a[0], m.a[1]], [m.b[0], m.a[1]], m.b, [m.a[0], m.b[1]]], L.id, true); } return true; }
    }
    if (this.draw?.rect) { const fp = st.floorPoint(e, L.id); if (!fp) return true; const b = snapPoint(fp, this.vertices(L)); this.draw.b = b; const [a0, a1] = this.draw.a; st.setPreview([[a0, a1], [b[0], a1], b, [a0, b[1]]], L.id, true); return true; }
    if (this.draw?.poly) { const fp = st.floorPoint(e, L.id); if (!fp) return true; const pts = this.draw.points; const c = snapPoint(fp, [...this.vertices(L), pts[0]], pts[pts.length - 1]); st.setPreview([...pts, c], L.id); return true; }
    if (this.calib?.a && !this.calib.measured) { const fp = st.floorPoint(e, L.id); if (fp) st.setPreview([this.calib.a, fp], L.id); return true; }
    if (['door', 'window', 'garage', 'open'].includes(this.tool)) { const fp = st.floorPoint(e, L.id); this.setHover(fp ? this.openingCandidate(fp, this.tool) : null); return true; }
    return false;
  }
  throttleRebuild(L, room) {
    this.dimsDirty = true; if (this._rb) return; this._rb = requestAnimationFrame(() => { this._rb = null; this.app.stage.rebuildLevel(L.id); this.app.stage.setHandles(L, room); });
  }
  pointerUp(e, moved) {
    const app = this.app, st = app.stage, L = this.level; st.controls.enabled = !st.topView;
    if (this.marquee) {
      const m = this.marquee; this.marquee = null;
      if (m.active) {
        st.setPreview(null); this._pendingPick = null;
        const x0 = Math.min(m.a[0], m.b[0]), x1 = Math.max(m.a[0], m.b[0]), z0 = Math.min(m.a[1], m.b[1]), z1 = Math.max(m.a[1], m.b[1]);
        const hits = [...L.devices.map((d) => ({ type: 'device', it: d })), ...L.furniture.map((f) => ({ type: 'furniture', it: f }))]
          .filter(({ it }) => !it.hidden && !it.locked && it.pos[0] >= x0 && it.pos[0] <= x1 && it.pos[1] >= z0 && it.pos[1] <= z1).map(({ type, it }) => ({ type, id: it.id, level: L.id }));
        if (!m.shift || !this.selection().length) { this.select(hits[0] || null); hits.slice(1).forEach((h) => this.select(h, { add: true })); }
        else hits.forEach((h) => this.select(h, { add: true }));
        if (hits.length) app.toast(t('editor.selection.selectedCount', { count: hits.length }));
        return;
      }
    }
    if (this.drag?.roofCorner) { this.drag = null; app.stage.layout(); this.roofHandles(); app.markDirty(); this.renderInspector(); return; }
    if (this.drag) {
      const d = this.drag; this.drag = null;
      if (d.vertex || d.roomMove) { cancelAnimationFrame(this._rb); this._rb = null; st.rebuildLevel(L.id); st.setHandles(L, d.room); app.buildLabels(); app.markDirty(); app.scheduleUI(true); this.renderInspector(); }
      if (d.item && d.moved) { app.markDirty(); this.renderInspector(); app.scheduleUI(true); this.renderLeft(); }
      if (d.roofItem) { if (d.undo) { app.markDirty(); this.renderInspector(); this.renderLeft(); } }
      return;
    }
    if (this.draw?.rect) {
      const { a, b } = this.draw; this.draw = null; st.setPreview(null);
      if (b && Math.abs(b[0] - a[0]) > 0.3 && Math.abs(b[1] - a[1]) > 0.3) {
        const x = Math.min(a[0], b[0]), z = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), dd = Math.abs(b[1] - a[1]); const id = newId('r');
        if (this.tool === 'roofrect') return this.addExtraRoof(rectPoints(x, z, w, dd), { levelId: L.id });
        app.pushUndo(); app.applyLocal({ op: 'add_room', level_id: L.id, id, name: t('editor.room.numbered', { number: L.rooms.length + 1 }), rect: [x, z, w, dd] }); this.select({ type: 'room', id, level: L.id });
      }
      return;
    }
    if (moved) return;
    const fp = st.floorPoint(e, L.id);
    if (this.tool === 'poly' && fp) {
      if (!this.draw?.poly) { this.draw = { poly: true, points: [snapPoint(fp, this.vertices(L))] }; return; }
      const pts = this.draw.points; const c = snapPoint(fp, [...this.vertices(L), pts[0]], pts[pts.length - 1]);
      if (pts.length >= 3 && Math.hypot(c[0] - pts[0][0], c[1] - pts[0][1]) < 0.2) return this.finishPoly();
      pts.push(c); st.setPreview(pts, L.id); return;
    }
    if (['door', 'window', 'garage', 'open'].includes(this.tool) && fp) return this.placeOpening(fp, this.tool);
    if (this.tool === 'calibrate' && fp) {
      if (!this.calib?.a || this.calib.measured) { this.calib = { a: fp }; return; }
      this.calib.b = fp; this.calib.measured = Math.hypot(fp[0] - this.calib.a[0], fp[1] - this.calib.a[1]); st.setPreview([this.calib.a, fp], L.id); this.select({ type: 'level', id: L.id, level: L.id }); setTimeout(() => app.$('calReal')?.focus(), 0); return;
    }
    if (this.tool === 'select') {
      const p = this._pendingPick; this._pendingPick = null;
      if (p?.type === 'room') this.select({ type: 'room', id: p.id, level: p.level });
      else if (p) { /* opening, device, furniture or solar: already selected on pointer down */ }
      else { const op = fp && this.nearestOpening(L, fp); this.select(op ? { type: 'opening', id: op.id, level: L.id } : null); }
    }
  }
  finishPoly() {
    const pts = this.draw.points; this.draw = null; this.app.stage.setPreview(null); if (pts.length < 3) return;
    const L = this.level, id = newId('r'); this.app.pushUndo(); this.app.applyLocal({ op: 'add_room', level_id: L.id, id, name: t('editor.room.numbered', { number: L.rooms.length + 1 }), points: pts }); this.select({ type: 'room', id, level: L.id });
  }
  nearestOpening(L, p) { let best = null, bd = 0.35; for (const o of L.openings) { const d = distToSeg(p, o.from, o.to); if (d < bd) { bd = d; best = o; } } return best; }
  // Nearest wall edge to p and where an opening of this type would land on it.
  openingCandidate(p, type) {
    const L = this.level; let best = null, bd = 0.6 / Math.max(0.6, this.app.stage.topView ? Math.min(2, this.app.stage.ortho.zoom) : 1);
    for (const r of L.rooms.filter((x) => x.kind !== 'outdoor')) for (const [a, b] of edges(r.points)) { const d = distToSeg(p, a, b); if (d < bd) { bd = d; best = [a, b]; } }
    if (!best) return null;
    const [a, b] = best; const { t, len } = projectOnSeg(p, a, b);
    const w = Math.max(0.3, Math.min(type === 'window' ? WINDOW_PRESETS[this.windowPreset || 'std'].w : { door: 0.9, garage: 2.5, open: 1.0 }[type], len - 0.1));
    const c = Math.round(Math.min(len - w / 2 - 0.05, Math.max(w / 2 + 0.05, t * len)) / 0.05) * 0.05; const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const from = [r3(a[0] + ux * (c - w / 2)), r3(a[1] + uz * (c - w / 2))], to = [r3(a[0] + ux * (c + w / 2)), r3(a[1] + uz * (c + w / 2))];
    return { a, b, len, from, to, w, left: c - w / 2, right: len - c - w / 2 };
  }
  setHover(c) {
    this.hover = c; this.dimsDirty = true;
    this.app.stage.setMarks(c ? this.level : null, c ? [{ a: c.a, b: c.b, color: '#79a6ff', width: 0.34, opacity: 0.55 }, { a: c.from, b: c.to, color: '#ffb35c', width: 0.42, opacity: 0.95 }] : []);
  }
  placeOpening(p, type) {
    const L = this.level; const cand = this.openingCandidate(p, type);
    if (!cand) return this.app.toast(t('editor.toast.clickNearWall'));
    const { from, to } = cand; this.setHover(null);
    const id = newId('o'); this.app.pushUndo();
    this.app.applyLocal({ op: 'add_opening', level_id: L.id, id, type, from, to, ...(type === 'window' ? { sill: WINDOW_PRESETS[this.windowPreset || 'std'].sill, head: WINDOW_PRESETS[this.windowPreset || 'std'].head, preset: this.windowPreset || 'std' } : type === 'garage' ? { head: 2.2 } : {}) });
    this.select({ type: 'opening', id, level: L.id });
  }

  /* ---------------- dimensions ---------------- */
  // Wall edge (of any indoor room on the level) that carries this opening.
  hostEdge(L, o) {
    for (const r of L.rooms.filter((x) => x.kind !== 'outdoor')) for (const [a, b] of edges(r.points)) if (distToSeg(o.from, a, b) < 0.03 && distToSeg(o.to, a, b) < 0.03) return [a, b];
    return null;
  }
  // Outward offset point for a label next to edge a→b of polygon pts.
  edgeLabelPos(pts, a, b, off = 0.35) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s = pts && pointInPolygon([m[0] + nx * 0.05, m[1] + nz * 0.05], pts) ? -1 : 1;
    return [m[0] + s * nx * off, m[1] + s * nz * off];
  }
  dimSpecs() {
    const L = this.level, out = [], app = this.app; if (!L) return out;
    const sel = app.sel && app.sel.level === L.id ? findItem(app.plan, app.sel.id) : null;
    if (this.draw?.rect && this.draw.b) {
      const [a0, a1] = this.draw.a, b = this.draw.b; const pts = [[a0, a1], [b[0], a1], b, [a0, b[1]]];
      out.push({ ghost: true, pos: () => this.edgeLabelPos(pts, pts[0], pts[1]), text: () => fmt(Math.abs(b[0] - a0)) }, { ghost: true, pos: () => this.edgeLabelPos(pts, pts[1], pts[2]), text: () => fmt(Math.abs(b[1] - a1)) });
    }
    if (this.draw?.poly && this.draw.points.length) { const pts = this.draw.points; for (let i = 0; i < pts.length - 1; i++) out.push({ ghost: true, pos: () => this.edgeLabelPos(null, pts[i], pts[i + 1]), text: () => fmt(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])) }); }
    if (this.hover) {
      const c = this.hover;
      out.push({ ghost: true, pos: () => this.edgeLabelPos(null, c.a, c.b, 0.55), text: () => t('editor.dimensions.wallLength', { length: fmt(c.len) }) });
      out.push({ ghost: true, pos: () => this.edgeLabelPos(null, c.from, c.to, -0.55), text: () => `${fmt(c.left)} · ${fmt(c.w)} · ${fmt(c.right)}` });
    }
    if (app.levelSel === 'roof' && app.plan.site.roof.type !== 'none' && ['roof', 'solar', 'roofitem'].includes(app.sel?.type)) {
      const cur = () => rectCorners(this.roofRectNow());
      const setDim = (k) => (v) => { app.pushUndo(); const r = app.plan.site.roof; r.rect = { ...this.roofRectNow(), [k]: v }; app.stage.layout(); this.roofHandles(); app.markDirty(); this.renderInspector(); this.dimsDirty = true; };
      out.push({ key: 'roof:l', pos: () => { const c = cur(); return this.edgeLabelPos(c, c[0], c[1], 0.6); }, text: () => fmt(this.roofRectNow().length), commit: setDim('length') });
      out.push({ key: 'roof:w', pos: () => { const c = cur(); return this.edgeLabelPos(c, c[1], c[2], 0.6); }, text: () => fmt(this.roofRectNow().width), commit: setDim('width') });
    }
    if (sel?.type === 'room' && !this.draw) {
      const r = sel.item;
      r.points.forEach((_, i) => out.push({
        key: `${r.id}:${i}`, pos: () => { const a = r.points[i], b = r.points[(i + 1) % r.points.length]; return a && b ? this.edgeLabelPos(r.points, a, b) : null; },
        text: () => { const a = r.points[i], b = r.points[(i + 1) % r.points.length]; return a && b ? fmt(Math.hypot(b[0] - a[0], b[1] - a[1])) : ''; },
        commit: (v) => this.setEdgeLength(L, r, i, v),
      }));
    }
    if (sel?.type === 'opening' && !this.hover) {
      const o = sel.item; const host = this.hostEdge(L, o);
      if (host) {
        const geo = () => { const [a, b] = host; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len; const t1 = (o.from[0] - a[0]) * ux + (o.from[1] - a[1]) * uz, t2 = (o.to[0] - a[0]) * ux + (o.to[1] - a[1]) * uz; return { a, b, len, ux, uz, t0: Math.min(t1, t2), t1: Math.max(t1, t2) }; };
        const at = (distance) => { const g = geo(); return [g.a[0] + g.ux * distance, g.a[1] + g.uz * distance]; };
        const lbl = (t0, t1) => () => this.edgeLabelPos(null, at(t0()), at(t1()), 0.55);
        out.push({ key: `${o.id}:l`, pos: lbl(() => 0, () => geo().t0), text: () => fmt(geo().t0), commit: (v) => this.setOpeningSpan(L, o, host, v, null, null) });
        out.push({ key: `${o.id}:w`, pos: () => this.edgeLabelPos(null, at(geo().t0), at(geo().t1), -0.55), text: () => fmt(geo().t1 - geo().t0), commit: (v) => this.setOpeningSpan(L, o, host, null, v, null) });
        out.push({ key: `${o.id}:r`, pos: lbl(() => geo().t1, () => geo().len), text: () => fmt(geo().len - geo().t1), commit: (v) => this.setOpeningSpan(L, o, host, null, null, v) });
      }
    }
    return out;
  }
  placeDims() {
    const app = this.app, box = app.$('dims'), st = app.stage, L = this.planLevel(); if (!L) return;
    if (this.dimsDirty || this.draw) {
      this.dimsDirty = false; const editing = this._editingKey;
      this._dims = this.dimSpecs();
      const keep = editing ? [...box.children].find((el) => el.dataset.key === editing) : null;
      box.replaceChildren(...(keep ? [keep] : []));
      for (const d of this._dims) {
        if (keep && d.key === editing) { d.el = keep; continue; }
        const el = document.createElement('div'); el.className = `dim${d.ghost ? ' ghost' : ''}`; if (d.key) el.dataset.key = d.key;
        if (d.commit) { el.title = t('editor.dimensions.enterLength'); el.addEventListener('pointerdown', (e) => e.stopPropagation()); el.addEventListener('click', (e) => { e.stopPropagation(); this.editDim(d, el); }); }
        box.appendChild(el); d.el = el;
      }
    }
    const y = st.displayY(L) + L.height + 0.2;
    for (const d of this._dims || []) {
      const p = d.pos(); if (!p) { d.el.hidden = true; continue; }
      const [x, yy, z] = st.project(p[0], y, p[1]); d.el.hidden = z > 1;
      d.el.style.transform = `translate(${x}px, ${yy}px) translate(-50%, -50%)`;
      if (!d.el.classList.contains('editing')) { const text = d.text(); if (d.el.textContent !== text) d.el.textContent = text; }
    }
  }
  editDim(d, el) {
    if (el.classList.contains('editing')) return;
    this._editingKey = d.key; el.classList.add('editing');
    const cur = parseFloat(d.text().replace(',', '.'));
    el.innerHTML = `<input type="text" inputmode="decimal" value="${formatNumber(cur, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}" aria-label="${t('editor.dimensions.lengthMeters')}">`;
    const inp = el.querySelector('input'); inp.focus(); inp.select();
    const done = (ok) => {
      if (!this._editingKey) return; this._editingKey = null; el.classList.remove('editing');
      const v = parseFloat(inp.value.replace(',', '.'));
      if (ok && Number.isFinite(v) && v > 0 && Math.abs(v - cur) > 0.0005) d.commit(r3(v));
      this.dimsDirty = true;
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); if (e.key === 'Tab') { e.preventDefault(); done(true); this.focusNextDim(d.key); } });
    inp.addEventListener('blur', () => done(true));
  }
  focusNextDim(key) {
    setTimeout(() => { const list = (this._dims || []).filter((x) => x.commit); const i = list.findIndex((x) => x.key === key); const n = list[(i + 1) % list.length]; if (n?.el) this.editDim(n, n.el); }, 30);
  }
  // Sets edge i of the room to len by moving its end vertex and the following vertex along
  // the edge direction. Vertices of neighbouring rooms at the same spots move along, so
  // shared walls stay joined; openings on the shifted edge move too.
  setEdgeLength(L, room, i, len) {
    const pts = room.points, n = pts.length, a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    const L0 = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L0 < 0.01) return;
    const ux = (b[0] - a[0]) / L0, uz = (b[1] - a[1]) / L0, dx = (len - L0) * ux, dz = (len - L0) * uz;
    const moving = [[...b]]; if (n > 3 && c !== a) moving.push([...c]);
    const same = (p, q) => Math.abs(p[0] - q[0]) < 0.002 && Math.abs(p[1] - q[1]) < 0.002;
    this.app.pushUndo();
    for (const o of L.openings) { if (moving.length === 2 && distToSeg(o.from, moving[0], moving[1]) < 0.03 && distToSeg(o.to, moving[0], moving[1]) < 0.03) { o.from = [r3(o.from[0] + dx), r3(o.from[1] + dz)]; o.to = [r3(o.to[0] + dx), r3(o.to[1] + dz)]; } }
    for (const r of L.rooms) for (const p of r.points) if (moving.some((m) => same(p, m))) { p[0] = r3(p[0] + dx); p[1] = r3(p[1] + dz); }
    this.afterGeometryEdit(L);
  }
  // Repositions an opening on its wall by distance-from-start, width (centered) or distance-to-end.
  setOpeningSpan(L, o, [a, b], left, width, right) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const t1 = (o.from[0] - a[0]) * ux + (o.from[1] - a[1]) * uz, t2 = (o.to[0] - a[0]) * ux + (o.to[1] - a[1]) * uz;
    let s = Math.min(t1, t2), w = Math.abs(t2 - t1);
    if (width != null) { const c = s + w / 2; w = Math.min(width, len); s = c - w / 2; }
    if (left != null) s = left;
    if (right != null) s = len - right - w;
    s = Math.max(0, Math.min(len - w, s));
    this.app.pushUndo();
    o.from = [r3(a[0] + ux * s), r3(a[1] + uz * s)]; o.to = [r3(a[0] + ux * (s + w)), r3(a[1] + uz * (s + w))];
    this.afterGeometryEdit(L);
  }
  afterGeometryEdit(L) {
    const app = this.app; app.stage.rebuildLevel(L.id); app.buildLabels(); app.markDirty(); app.scheduleUI(true);
    const s = app.sel; app.stage.select(s); app.stage.setHandles(L, s?.type === 'room' ? L.rooms.find((r) => r.id === s.id) : null);
    this.markSelection(); this.renderInspector(); this.dimsDirty = true;
  }
  markSelection() {
    const app = this.app, s = app.sel; if (this.hover) return;
    const f = s && s.type === 'opening' ? findItem(app.plan, s.id) : null;
    if (!f || !app.stage.topView) return app.stage.setMarks(null);
    app.stage.setMarks(f.level, [{ a: f.item.from, b: f.item.to, color: '#79a6ff', width: 0.45, opacity: 0.95 }]);
  }

  /* ---------------- underlay ---------------- */
  // Full backup: plan + floor-plan images (data URLs) + per-browser view settings.
  async exportBackup() {
    const app = this.app, plan = structuredClone(app.plan), images = {};
    for (const L of plan.levels) for (const device of L.devices) if (device.kind === 'frame' && device.artV) {
      try { const r = await app.hass.fetchWithAuth(`/api/hometwin/underlay/art_${device.id}`); if (r.ok) { const blob = await r.blob(); images[`art_${device.id}`] = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); }); } } catch { /* image missing */ }
    }
    for (const L of plan.levels) {
      if (!L.underlay) continue;
      try { const r = await app.hass.fetchWithAuth(`/api/hometwin/underlay/${L.id}`); if (!r.ok) continue; const b = await r.blob(); images[L.id] = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); } catch { /* image missing */ }
    }
    const settings = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^(hometwin|raumwerk)-/.test(k) && !/plan/.test(k)) settings[k] = localStorage.getItem(k); } } catch { /* storage blocked */ }
    const data = { format: 'hometwin-backup', version: 1, created: new Date().toISOString(), app_version: app.version || null, plan, images, settings };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `hometwin-backup-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    app.toast(t('editor.toast.backupExported', { size: formatNumber(blob.size / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), images: Object.keys(images).length }));
  }
  async importBackup(file) {
    const app = this.app;
    try {
      const data = JSON.parse(await file.text());
      const plan = migrate(data.format === 'hometwin-backup' ? data.plan : data); if (!plan) throw new Error(t('editor.error.unknownFormat'));
      if (!confirm(t('editor.confirm.importBackup'))) return;
      app.pushUndo(); let n = 0;
      for (const [lid, url] of Object.entries(data.images || {})) { try { const blob = await (await fetch(url)).blob(); const r = await app.hass.fetchWithAuth(`/api/hometwin/underlay/${lid}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'image/jpeg' } }); if (r.ok) n++; } catch { /* skip image */ } }
      try { for (const [k, v] of Object.entries(data.settings || {})) localStorage.setItem(k.replace(/^raumwerk-/, 'hometwin-'), v); } catch { /* storage blocked */ }
      this.images?.clear?.(); app.setPlan(plan, { frame: true }); app.markDirty(); this.loadUnderlays();
      app.toast(t('editor.toast.backupImported', { levels: plan.levels.length, images: n }));
    } catch (err) { app.toast(t('editor.toast.importFailed', { message: err.message })); }
  }
  async uploadUnderlay(file) {
    const app = this.app, L = this.level;
    try {
      const bmp = await createImageBitmap(file); const max = 3000, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
      const resp = await app.hass.fetchWithAuth(`/api/hometwin/underlay/${L.id}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      app.pushUndo();
      const indoor = L.rooms.filter((r) => r.kind !== 'outdoor'); const b = indoor.length ? bbox(indoor.flatMap((r) => r.points)) : null;
      L.underlay = { x0: b ? b.minX : 0, z0: b ? b.minZ : 0, mpp: b ? Math.max(b.w, 4) / c.width : 0.01, wpx: c.width, hpx: c.height, opacity: 0.6, v: Date.now() };
      const img = await createImageBitmap(c); this.images.set(L.id, img); app.stage.setUnderlay(L.id, img);
      app.markDirty(); this.select({ type: 'level', id: L.id, level: L.id }); this.setTool('calibrate'); app.toast(t('editor.toast.imageLoaded'));
    } catch (err) { app.toast(t('editor.toast.imageSaveFailed', { message: err.message })); }
  }
  async loadUnderlays() {
    for (const L of this.app.plan.levels) {
      if (!L.underlay) continue;
      try {
        let img = this.images.get(L.id);
        if (!img) { const r = await this.app.hass.fetchWithAuth(`/api/hometwin/underlay/${L.id}?v=${L.underlay.v || 0}`); if (!r.ok) continue; img = await createImageBitmap(await r.blob()); this.images.set(L.id, img); }
        this.app.stage.setUnderlay(L.id, img);
      } catch (e) { console.warn('hometwin: underlay', e); }
    }
  }
}
