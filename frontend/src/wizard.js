// Floor-plan wizard: source → align → scale → recognise → review & apply, in one dialog.
import { icon } from './icons.js';
import { esc } from './panel.js';
import { newId, fitNewLevel } from './plan.js';
import { area as polyArea, bbox, pointInPolygon, distToSeg, projectOnSeg } from './geometry.js';
import { newExtraRoof, rectOfPoints } from './roof.js';
import { t, getLanguage, formatNumber } from './i18n.js';

const steps = () => ['source', 'align', 'scale', 'recognize', 'review'].map((key) => t(`assistant.wizard.step.${key}`));
const COLORS = ['#79a6ff', '#ffb35c', '#7fd18b', '#e57fd1', '#5fd3d0', '#f2d35b', '#ff7f7f', '#a68bff', '#9ad26a', '#ff9fcb'];
const r3 = (v) => Math.round(v * 1000) / 1000;
const OPEN_COL = { door: '#ffb35c', window: '#5fd3d0', garage: '#e57fd1', open: '#f2d35b' };
const openingLabels = () => ({ door: t('assistant.wizard.opening.door'), window: t('assistant.wizard.opening.window'), garage: t('assistant.wizard.opening.garage'), open: t('assistant.wizard.opening.open') });
const OPEN_W = { door: 0.885, window: 1.26, garage: 2.5, open: 1.0 };
const localizedDecimal = (value) => getLanguage() === 'de' ? String(value).replace('.', ',') : String(value);
// Rooms (not outdoor) without any door, passage or garage door on their outline.
function roomsWithoutDoor(res) {
  return res.rooms.filter((r) => r.kind !== 'outdoor' && !res.openings.some((o) => o.type !== 'window' && r.points.some((p, i) => { const q = r.points[(i + 1) % r.points.length], m = [(o.from[0] + o.to[0]) / 2, (o.from[1] + o.to[1]) / 2]; return distToSeg(m, p, q) < 0.3; })));
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- image helpers ---------------- */
function canvasOf(src, w = src.width, h = src.height) { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, 0, 0, w, h); return c; }
function limit(src, max) { const k = Math.min(1, max / Math.max(src.width, src.height)); return k < 1 ? canvasOf(src, Math.round(src.width * k), Math.round(src.height * k)) : canvasOf(src); }
function rotateCanvas(src, deg) {
  if (!deg) return src;
  const a = (deg * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = Math.round(src.width * c + src.height * s), h = Math.round(src.width * s + src.height * c);
  const out = document.createElement('canvas'); out.width = w; out.height = h; const g = out.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.translate(w / 2, h / 2); g.rotate(a); g.drawImage(src, -src.width / 2, -src.height / 2); return out;
}
// Homography that maps the unit square corners (0,0),(1,0),(1,1),(0,1) to quad q.
function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) { const den = dx1 * dy2 - dx2 * dy1; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}
const isRect = (q) => Math.abs(q[0][1] - q[1][1]) < 1 && Math.abs(q[2][1] - q[3][1]) < 1 && Math.abs(q[0][0] - q[3][0]) < 1 && Math.abs(q[1][0] - q[2][0]) < 1;
// Cuts the quad out of src and straightens it (perspective correction).
function warp(src, q) {
  if (isRect(q)) { const x = Math.min(q[0][0], q[3][0]), y = Math.min(q[0][1], q[1][1]); const w = Math.max(q[1][0], q[2][0]) - x, h = Math.max(q[2][1], q[3][1]) - y; const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); c.getContext('2d').drawImage(src, -x, -y); return c; }
  const W = Math.round((dist(q[0], q[1]) + dist(q[3], q[2])) / 2), H = Math.round((dist(q[0], q[3]) + dist(q[1], q[2])) / 2);
  const k = Math.min(1, 3200 / Math.max(W, H)), ow = Math.max(1, Math.round(W * k)), oh = Math.max(1, Math.round(H * k));
  const [a, b, c, d, e, f, g, h] = squareToQuad(q);
  const sd = src.getContext('2d').getImageData(0, 0, src.width, src.height).data, sw = src.width, sh = src.height;
  const out = document.createElement('canvas'); out.width = ow; out.height = oh; const og = out.getContext('2d'); const od = og.createImageData(ow, oh);
  for (let y = 0; y < oh; y++) {
    const v = (y + 0.5) / oh;
    for (let x = 0; x < ow; x++) {
      const u = (x + 0.5) / ow, den = g * u + h * v + 1; const sx = (a * u + b * v + c) / den, sy = (d * u + e * v + f) / den;
      const ix = clamp(sx | 0, 0, sw - 1), iy = clamp(sy | 0, 0, sh - 1), si = (iy * sw + ix) * 4, di = (y * ow + x) * 4;
      od.data[di] = sd[si]; od.data[di + 1] = sd[si + 1]; od.data[di + 2] = sd[si + 2]; od.data[di + 3] = 255;
    }
  }
  og.putImageData(od, 0, 0); return out;
}
// Contrast / black-and-white enhancement for pale plans.
function enhance(src, { bw, contrast }) {
  if (!bw && !contrast) return src;
  const c = canvasOf(src); const g = c.getContext('2d'); const im = g.getImageData(0, 0, c.width, c.height); const d = im.data;
  const k = 1 + contrast / 25, mid = 200;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], gg = d[i + 1], b = d[i + 2];
    if (bw) r = gg = b = 0.3 * r + 0.59 * gg + 0.11 * b;
    if (contrast) { r = clamp((r - mid) * k + mid, 0, 255); gg = clamp((gg - mid) * k + mid, 0, 255); b = clamp((b - mid) * k + mid, 0, 255); }
    d[i] = r; d[i + 1] = gg; d[i + 2] = b;
  }
  g.putImageData(im, 0, 0); return c;
}
function grayMap(c) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const m = new Uint8Array(c.width * c.height); for (let i = 0; i < m.length; i++) m[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0; return m; }
function inside(p, pts) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi + 1e-12) + xi) c = !c; } return c; }
function overlap(a, b, step = 0.08) {
  const A = bbox(a), B = bbox(b); const x0 = Math.max(A.minX, B.minX), x1 = Math.min(A.maxX, B.maxX), z0 = Math.max(A.minZ, B.minZ), z1 = Math.min(A.maxZ, B.maxZ);
  if (x1 - x0 < step || z1 - z0 < step) return 0; let n = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) if (inside([x, z], a) && inside([x, z], b)) n++;
  return n * step * step;
}

// Clear floor area: polygon minus half the wall thickness along every edge (interior 5.5 cm, exterior 12 cm).
function sharesEdge(a, b, poly) {
  const L = dist(a, b); if (L < 1e-6) return false; const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i], d = poly[(i + 1) % poly.length];
    if (Math.abs((c[0] - a[0]) * uz - (c[1] - a[1]) * ux) > 0.03 || Math.abs((d[0] - a[0]) * uz - (d[1] - a[1]) * ux) > 0.03) continue;
    const t1 = (c[0] - a[0]) * ux + (c[1] - a[1]) * uz, t2 = (d[0] - a[0]) * ux + (d[1] - a[1]) * uz;
    if (Math.min(Math.max(t1, t2), L) - Math.max(Math.min(t1, t2), 0) > 0.3) return true;
  }
  return false;
}
function netArea(room, rooms) {
  const pts = room.points; let a = polyArea(pts); if (room.kind === 'outdoor') return a;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; const shared = rooms.some((o) => o !== room && o.kind !== 'outdoor' && sharesEdge(p, q, o.points)); a -= dist(p, q) * (shared ? 0.055 : 0.12); }
  return Math.max(0, a + pts.length * 0.01);
}

// Visual centre of a polygon (point inside with the largest distance to the edges), good for L-shapes.
function pole(pts) {
  const b = bbox(pts); let best = [b.cx, b.cz], bd = -1;
  const segD = (p, a, c) => { const dx = c[0] - a[0], dz = c[1] - a[1], L2 = dx * dx + dz * dz || 1; const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2, 0, 1); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t); };
  for (let i = 1; i < 12; i++) for (let k = 1; k < 12; k++) { const p = [b.minX + (b.w * i) / 12, b.minZ + (b.d * k) / 12]; if (!inside(p, pts)) continue; let d = Infinity; for (let j = 0; j < pts.length; j++) d = Math.min(d, segD(p, pts[j], pts[(j + 1) % pts.length])); if (d > bd) { bd = d; best = p; } }
  return best;
}
// Trims a rectangular outdoor area so it no longer runs under walled rooms; keeps the largest part.
function trimRect(room, rooms) {
  if (!room || room.kind !== 'outdoor' || room.points.length !== 4) return null;
  let b = bbox(room.points); if (Math.abs(polyArea(room.points) - b.w * b.d) > 0.05) return null;
  let changed = false;
  for (const w of rooms) {
    if (w === room || w.kind === 'outdoor' || overlap(room.points, w.points) < 0.3) continue;
    const o = bbox(w.points);
    const opts = [[b.minX, b.minZ, Math.min(b.maxX, o.minX), b.maxZ], [Math.max(b.minX, o.maxX), b.minZ, b.maxX, b.maxZ], [b.minX, b.minZ, b.maxX, Math.min(b.maxZ, o.minZ)], [b.minX, Math.max(b.minZ, o.maxZ), b.maxX, b.maxZ]]
      .filter(([x0, z0, x1, z1]) => x1 - x0 > 0.3 && z1 - z0 > 0.3).sort((p, q) => (q[2] - q[0]) * (q[3] - q[1]) - (p[2] - p[0]) * (p[3] - p[1]));
    if (!opts.length) continue; const [x0, z0, x1, z1] = opts[0]; b = { minX: x0, minZ: z0, maxX: x1, maxZ: z1, w: x1 - x0, d: z1 - z0 }; changed = true;
  }
  return changed ? [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]].map((p) => p.map(r3)) : null;
}

/* ---------------- zoomable canvas ---------------- */
class PlanView {
  constructor(canvas, wrap) {
    this.c = canvas; this.wrap = wrap; this.g = canvas.getContext('2d'); this.img = null; this.s = 1; this.tx = 0; this.ty = 0; this.ptrs = new Map();
    this.overlay = null; this.onDown = null; this.onMove = null; this.onUp = null; this.onHover = null;
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => this._down(e)); canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e)); canvas.addEventListener('pointercancel', (e) => this._up(e));
    canvas.addEventListener('pointerleave', () => this.onHover?.(null));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(wrap); this.resize();
  }
  destroy() { this.ro.disconnect(); }
  resize() { const r = this.wrap.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; this.c.width = Math.max(1, r.width * dpr); this.c.height = Math.max(1, r.height * dpr); this.c.style.width = `${r.width}px`; this.c.style.height = `${r.height}px`; this.dpr = dpr; if (!this._fitted && this.img) this.fit(); this.draw(); }
  setImage(img) { this.img = img; this._fitted = false; this.fit(); }
  fit() { if (!this.img) return; const r = this.wrap.getBoundingClientRect(); const W = r.width, H = r.height; if (!(W > 2 && H > 2)) return; this.s = Math.min(W / this.img.width, H / this.img.height) * 0.94; this.tx = (W - this.img.width * this.s) / 2; this.ty = (H - this.img.height * this.s) / 2; this._fitted = true; this.draw(); }
  zoomAt(x, y, k) { const ns = clamp(this.s * k, 0.02, 40); const ix = (x - this.tx) / this.s, iy = (y - this.ty) / this.s; this.s = ns; this.tx = x - ix * ns; this.ty = y - iy * ns; this.draw(); }
  zoom(k) { this.zoomAt(this.c.width / this.dpr / 2, this.c.height / this.dpr / 2, k); }
  toImg(e) { const r = this.c.getBoundingClientRect(); return [(e.clientX - r.left - this.tx) / this.s, (e.clientY - r.top - this.ty) / this.s]; }
  toScr(p) { return [p[0] * this.s + this.tx, p[1] * this.s + this.ty]; }
  _down(e) {
    this.c.setPointerCapture(e.pointerId); this.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (this.ptrs.size === 2) { this.pinch = { d: dist(...this.ptrs.values()), s: this.s }; this.drag = null; return; }
    const handled = e.button === 0 && this.onDown?.(this.toImg(e), e);
    this.drag = handled ? { tool: true } : { pan: true, x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
  }
  _move(e) {
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (this.pinch && this.ptrs.size === 2) { const [p, q] = [...this.ptrs.values()]; const r = this.c.getBoundingClientRect(); const k = (dist(p, q) / this.pinch.d) * this.pinch.s / this.s; this.zoomAt((p[0] + q[0]) / 2 - r.left, (p[1] + q[1]) / 2 - r.top, k); return; }
    if (this.drag?.pan) { this.tx = this.drag.tx + e.clientX - this.drag.x; this.ty = this.drag.ty + e.clientY - this.drag.y; this.draw(); return; }
    if (this.drag?.tool) { this.onMove?.(this.toImg(e), e); return; }
    this.onHover?.(this.toImg(e), e);
  }
  _up(e) { this.ptrs.delete(e.pointerId); if (this.ptrs.size < 2) this.pinch = null; if (this.drag?.tool) this.onUp?.(this.toImg(e), e); this.drag = null; }
  draw() {
    const g = this.g, dpr = this.dpr || 1; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.c.width, this.c.height); g.fillStyle = '#0d121c'; g.fillRect(0, 0, this.c.width, this.c.height);
    if (!this.img) return;
    g.setTransform(dpr * this.s, 0, 0, dpr * this.s, dpr * this.tx, dpr * this.ty); g.imageSmoothingQuality = 'high';
    g.globalAlpha = this.imgAlpha ?? 1; g.drawImage(this.img, 0, 0); g.globalAlpha = 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); this.overlay?.(g, this);
  }
}

/* ---------------- the wizard ---------------- */
export class PlanWizard {
  constructor(app) { this.app = app; }

  open({ levelId } = {}) {
    const app = this.app;
    const lv = app.plan.levels.find((l) => l.id === (levelId || app.activeLevelId)); const busyLevel = lv && lv.rooms.some((r) => r.kind !== 'void');
    this.st = { step: 0, src: null, srcName: '', pdf: null, page: 0, levelId: levelId === '__new' || busyLevel ? '__new' : levelId || app.activeLevelId, newLevel: '', rot90: 0, fine: 0, quad: null, bw: false, contrast: 0, img: null,
      measure: { a: null, b: null, m: '' }, check: { a: null, b: null, m: '' }, mpp: null, dims: null,
      opts: { openings: true, stairs: true, names: true }, hints: '', result: null, sel: null, busy: false, mode: 'replace', keepUnderlay: true, mapAreas: true, overlayAlpha: 0.55, err: null };
    this.meas = null; this.rubber = null; this.gray = null; this._key2 = null; this.openTool = null;
    this.root = app.$('wizard'); this.root.hidden = false; this.root.innerHTML = '';
    this._paste = (e) => { const it = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/')); if (it && this.st.step === 0) { e.preventDefault(); this.loadFile(it.getAsFile(), t('assistant.wizard.clipboard')); } };
    window.addEventListener('paste', this._paste);
    this._key = (e) => { if (this.st.step === 2) this._key2?.(e);
      if (this.st.step === 4 && !e.target.closest?.('input,textarea,select')) { if ((e.key === 'Delete' || e.key === 'Backspace') && this.st.selOpen != null) { this.st.result.openings.splice(this.st.selOpen, 1); this.st.selOpen = null; this.render(); return; } if (e.key === 'Escape' && (this.openTool || this.st.selOpen != null)) { this.openTool = null; this.st.selOpen = null; this.render(); return; } }
      if (e.key === 'Escape' && !e.wzHandled && !this.root.hidden) this.close(); };
    window.addEventListener('keydown', this._key);
    this.pending = null; this.detectRun = null; this.stopTicker?.();
    app.hass.callWS({ type: 'hometwin/agent/info' }).then((i) => { this.ai = i; if (this.st.step >= 2) this.render(); if (i.configured) this.checkPendingJob(); }).catch(() => { this.ai = { configured: false }; });
    this.render();
  }
  close() { if (this.pendingRise) { const id = this.pendingRise; this.pendingRise = null; setTimeout(() => this.app.stage.riseLevel(id), 350); }
    this.detectRun = null; this.stopTicker(); this.view?.destroy(); this.view = null; this.root.hidden = true; this.root.innerHTML = ''; window.removeEventListener('paste', this._paste); window.removeEventListener('keydown', this._key); }

  /* ---------- frame ---------- */
  render() {
    if (this._rendering) return; this._rendering = true; try { this._render(); } finally { this._rendering = false; }
  }
  _render() {
    const st = this.st;
    this.view?.destroy(); this.view = null;
    this.root.innerHTML = `<div class="wz" role="dialog" aria-modal="true" aria-label="${t('assistant.wizard.title')}">
      <header class="wz-head"><h2>${icon('image')}${t('assistant.wizard.title')}</h2>
        <ol class="wz-steps">${steps().map((s, i) => `<li class="${i === st.step ? 'cur' : i < st.step ? 'done' : ''}"><span>${i < st.step ? '✓' : i + 1}</span>${s}</li>`).join('')}</ol>
        <button class="ibtn" data-wz="close" title="${t('assistant.common.close')}" aria-label="${t('assistant.common.close')}">${icon('x')}</button></header>
      <div class="wz-body">${this[`step${st.step}`]()}</div>
      <footer class="wz-foot"><span class="wz-msg" id="wzMsg">${st.err ? `<span class="err">${esc(st.err)}</span>` : ''}</span>
        ${st.step > 0 && st.step !== 3 ? `<button class="btn" data-wz="back">${t('assistant.common.back')}</button>` : ''}
        ${this.nextButton()}</footer></div>`;
    this.root.querySelector('[data-wz="close"]').onclick = () => this.close();
    this.root.querySelector('[data-wz="back"]')?.addEventListener('click', () => this.go(st.step - 1));
    this.root.querySelector('[data-wz="next"]')?.addEventListener('click', () => this.next());
    this[`wire${st.step}`]?.();
    this.root.querySelectorAll('[data-act="cancelDetect"]').forEach((b) => b.addEventListener('click', () => this.cancelJob()));
    this.updateProgress();
  }
  nextButton() {
    const s = this.st;
    if (s.step === 0) return `<button class="btn primary" data-wz="next" ${s.src ? '' : 'disabled'}>${t('assistant.common.next')}</button>`;
    if (s.step === 1) return `<button class="btn primary" data-wz="next">${t('assistant.wizard.nextToScale')}</button>`;
    if (s.step === 2) return `<button class="btn primary" data-wz="next" ${s.mpp || (this.ai?.configured && !s.busy) ? '' : 'disabled'}>${this.ai?.configured ? t(s.mpp ? 'assistant.wizard.recognizeRooms' : 'assistant.wizard.recognizeRoomsAndScale') : t('assistant.common.next')}</button>`;
    if (s.step === 3) return '';
    return `<button class="btn primary" data-wz="next" ${s.result?.rooms.length ? '' : 'disabled'}>${t('assistant.common.apply')}</button>`;
  }
  go(step) { this.st.err = null; this.st.step = step; this.render(); }
  msg(t, err = false) { const m = this.root.querySelector('#wzMsg'); if (m) m.innerHTML = t ? `<span class="${err ? 'err' : ''}">${esc(t)}</span>` : ''; }
  async next() {
    const s = this.st;
    if (s.step === 0) { await this.prepareAlign(); return this.go(1); }
    if (s.step === 1) { this.msg(t('assistant.wizard.preparingImage')); await new Promise((r) => setTimeout(r, 20)); this.process(); return this.go(2); }
    if (s.step === 2) { this.go(3); if (this.ai?.configured) this.detect(); return; }
    if (s.step === 4) return this.apply();
  }

  /* ---------- step 1: source ---------- */
  step0() {
    const s = this.st, levels = this.app.plan.levels;
    return `<div class="wz-two">
      <div class="wz-drop" id="wzDrop" tabindex="0">
        ${s.src ? `<img alt="${t('assistant.wizard.preview')}" src="${limit(s.src, 900).toDataURL('image/jpeg', 0.8)}">` : `${icon('upload')}<strong>${t('assistant.wizard.dropPlan')}</strong><span>${t('assistant.common.or')}</span>`}
        <div class="actions">
          <label class="btn small">${icon('image')}${t('assistant.wizard.chooseFile')}<input type="file" id="wzFile" accept="image/*,application/pdf,.pdf" hidden></label>
          <button class="btn small" data-act="paste">${t('assistant.wizard.fromClipboard')}</button>
          <label class="btn small mobile-only">${t('assistant.wizard.takePhoto')}<input type="file" id="wzCam" accept="image/*" capture="environment" hidden></label>
        </div>
        <small>${t('assistant.wizard.fileFormats')}${s.src ? ` · ${esc(s.srcName)} (${s.src.width}×${s.src.height} px)` : ''}</small>
      </div>
      <div class="wz-side">
        ${this.pending ? `<div class="wz-resume"><strong>${this.pending.status === 'running' ? t('assistant.wizard.detectionStillRunning') : t('assistant.wizard.lastDetectionFinished', { rooms: this.pending.result?.rooms ? t('assistant.wizard.roomCountSuffix', { count: this.pending.result.rooms.length }) : '' })}</strong><span>${t('assistant.wizard.startedMinutesAgo', { minutes: Math.max(1, Math.round((Date.now() / 1000 - this.pending.started) / 60)) })}</span><div class="actions"><button class="btn primary small" data-act="resume">${t(this.pending.status === 'running' ? 'assistant.wizard.showProgress' : 'assistant.wizard.openResult')}</button><button class="btn small" data-act="dismissJob">${t('assistant.common.discard')}</button></div></div>` : ''}
        ${s.pdf ? `<div class="field"><span class="lbl">${t('assistant.wizard.pdfPage')}</span><div class="wz-pages" id="wzPages">${Array.from({ length: s.pdf.pages }, (_, i) => `<button data-page="${i}" aria-pressed="${i === s.page}"><span>${t('assistant.wizard.pageNumber', { number: i + 1 })}</span></button>`).join('')}</div></div>` : ''}
        <div class="field"><label for="wzLevel">${t('assistant.wizard.chooseLevel')}</label><select id="wzLevel">${levels.map((l) => `<option value="${l.id}" ${l.id === s.levelId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}<option value="__new" ${s.levelId === '__new' ? 'selected' : ''}>${t('assistant.wizard.newLevelOption')}</option></select></div>
        ${s.levelId === '__new' ? `<div class="field"><label for="wzNewLevel">${t('assistant.wizard.newLevelName')}</label><input id="wzNewLevel" value="${esc(s.newLevel || '')}" placeholder="${t('assistant.wizard.newLevelPlaceholder')}"></div>` : `<p class="hint">${t('assistant.wizard.existingLevelHint')}</p>`}
        <p class="hint">${t('assistant.wizard.onePlanPerLevel')}</p>
      </div></div>`;
  }
  wire0() {
    const R = this.root, s = this.st;
    const drop = R.querySelector('#wzDrop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files?.[0]; if (f) this.loadFile(f); });
    for (const id of ['wzFile', 'wzCam']) R.querySelector(`#${id}`)?.addEventListener('change', (e) => e.target.files?.[0] && this.loadFile(e.target.files[0]));
    R.querySelector('[data-act="paste"]').onclick = async () => {
      try { const items = await navigator.clipboard.read(); for (const it of items) { const type = it.types.find((x) => x.startsWith('image/')); if (type) return this.loadFile(await it.getType(type), t('assistant.wizard.clipboard')); } this.msg(t('assistant.wizard.clipboardNoImage'), true); }
      catch { this.msg(t('assistant.wizard.clipboardDenied'), true); }
    };
    R.querySelector('[data-act="resume"]')?.addEventListener('click', () => this.resumeJob());
    R.querySelector('[data-act="dismissJob"]')?.addEventListener('click', () => { const j = this.pending; this.pending = null; this.app.hass.callWS({ type: 'hometwin/agent/job_consume', job_id: j.id }).catch(() => {}); this.render(); });
    R.querySelector('#wzLevel').onchange = (e) => { s.levelId = e.target.value; this.render(); };
    R.querySelector('#wzNewLevel')?.addEventListener('input', (e) => { s.newLevel = e.target.value; s.newLevelTouched = true; });
    R.querySelector('#wzPages')?.addEventListener('click', async (e) => { const b = e.target.closest('[data-page]'); if (!b) return; s.page = +b.dataset.page; this.msg(t('assistant.wizard.loadingPage')); s.src = await s.pdf.render(s.page); this.render(); });
    if (s.pdf) this.pdfThumbs();
  }
  async pdfThumbs() { const s = this.st; for (let i = 0; i < Math.min(s.pdf.pages, 12); i++) { const c = await s.pdf.thumb(i); const b = this.root.querySelector(`[data-page="${i}"]`); if (b && !b.querySelector('img')) b.insertAdjacentHTML('afterbegin', `<img alt="" src="${c.toDataURL('image/jpeg', 0.7)}">`); } }
  async loadFile(file, name) {
    const s = this.st; this.msg(t('assistant.common.loading'));
    try {
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
        this.msg(t('assistant.wizard.openingPdf')); const { openPdf } = await import('./pdfload.js');
        s.pdf = await openPdf(file); s.page = 0; s.src = await s.pdf.render(0);
      } else { s.pdf = null; const bmp = await createImageBitmap(file); s.src = limit(bmp, 4000); }
      s.srcName = name || file.name || t('assistant.wizard.image'); s.quad = null; s.rot90 = 0; s.fine = 0; s.mpp = null; s.measure = { a: null, b: null, m: '' }; s.check = { a: null, b: null, m: '' }; s.result = null;
      this.render();
    } catch (e) { console.error(e); this.msg(t('assistant.wizard.fileOpenFailed', { error: e.message || e }), true); }
  }

  /* ---------- step 2: align ---------- */
  async prepareAlign() { const s = this.st; this.rotated = rotateCanvas(s.src, s.rot90 * 90 + s.fine); if (!s.quad) s.quad = this.fullQuad(); }
  fullQuad() { const w = this.rotated.width, h = this.rotated.height; return [[0, 0], [w, 0], [w, h], [0, h]]; }
  step1() {
    const s = this.st;
    return `<div class="wz-two"><div class="wz-canvas" id="wzWrap"><canvas id="wzCv"></canvas><div class="wz-zoom"><button class="ibtn" data-z="in" title="${t('assistant.common.zoomIn')}">+</button><button class="ibtn" data-z="out" title="${t('assistant.common.zoomOut')}">−</button><button class="ibtn" data-z="fit" title="${t('assistant.common.fit')}">⤢</button></div></div>
      <div class="wz-side">
        <p class="hint">${t('assistant.wizard.alignHint')}</p>
        <div class="field"><span class="lbl">${t('assistant.wizard.rotate')}</span><div class="actions"><button class="btn small" data-rot="-1">⟲ 90°</button><button class="btn small" data-rot="1">⟳ 90°</button></div></div>
        <div class="field"><label for="wzFine">${t('assistant.wizard.fineAlignment')} <output>${s.fine.toFixed(1)}°</output></label><input type="range" id="wzFine" min="-10" max="10" step="0.1" value="${s.fine}"></div>
        <label class="chk"><input type="checkbox" id="wzBw" ${s.bw ? 'checked' : ''}> ${t('assistant.wizard.blackAndWhite')}</label>
        <div class="field"><label for="wzCon">${t('assistant.wizard.increaseContrast')} <output>${s.contrast}</output></label><input type="range" id="wzCon" min="0" max="100" step="5" value="${s.contrast}"></div>
        <div class="actions"><button class="btn small" data-act="resetQuad">${t('assistant.wizard.resetCrop')}</button></div>
      </div></div>`;
  }
  wire1() {
    const R = this.root, s = this.st;
    const v = this.mkView(); const preview = () => { const k = Math.min(1, 1600 / Math.max(this.rotated.width, this.rotated.height)); this.prevK = k; this.prev = enhance(limit(this.rotated, 1600), s); v.setImage(this.prev); };
    preview();
    v.overlay = (g) => {
      const q = s.quad.map((p) => v.toScr([p[0] * this.prevK, p[1] * this.prevK]));
      g.fillStyle = 'rgba(5,8,14,.55)'; g.beginPath(); g.rect(0, 0, v.c.width, v.c.height); g.moveTo(...q[0]); for (const p of q.slice(1).reverse()) g.lineTo(...p); g.lineTo(...q[0]); g.fill('evenodd');
      g.strokeStyle = '#79a6ff'; g.lineWidth = 2; g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); g.stroke();
      for (const p of q) { g.fillStyle = '#fff'; g.strokeStyle = '#79a6ff'; g.lineWidth = 3; g.beginPath(); g.arc(p[0], p[1], 9, 0, 7); g.fill(); g.stroke(); }
    };
    v.onDown = (p) => { const q = s.quad.map((x) => [x[0] * this.prevK, x[1] * this.prevK]); const i = q.findIndex((x) => dist(v.toScr(x), v.toScr(p)) < 22); if (i < 0) return false; this.dragI = i; return true; };
    v.onMove = (p) => { if (this.dragI == null) return; s.quad[this.dragI] = [clamp(p[0] / this.prevK, 0, this.rotated.width), clamp(p[1] / this.prevK, 0, this.rotated.height)]; v.draw(); };
    v.onUp = () => { this.dragI = null; };
    v.onHover = (p) => { if (!p) return; const q = s.quad.map((x) => [x[0] * this.prevK, x[1] * this.prevK]); v.c.style.cursor = q.some((x) => dist(v.toScr(x), v.toScr(p)) < 22) ? 'grab' : 'default'; };
    R.querySelectorAll('[data-rot]').forEach((b) => (b.onclick = () => { s.rot90 = (s.rot90 + +b.dataset.rot + 4) % 4; this.rotated = rotateCanvas(s.src, s.rot90 * 90 + s.fine); s.quad = this.fullQuad(); preview(); }));
    let t; R.querySelector('#wzFine').oninput = (e) => { s.fine = +e.target.value; e.target.previousElementSibling.querySelector('output').textContent = `${s.fine.toFixed(1)}°`; clearTimeout(t); t = setTimeout(() => { this.rotated = rotateCanvas(s.src, s.rot90 * 90 + s.fine); s.quad = this.fullQuad(); preview(); }, 120); };
    R.querySelector('#wzBw').onchange = (e) => { s.bw = e.target.checked; preview(); };
    R.querySelector('#wzCon').oninput = (e) => { s.contrast = +e.target.value; e.target.previousElementSibling.querySelector('output').textContent = s.contrast; clearTimeout(t); t = setTimeout(preview, 120); };
    R.querySelector('[data-act="resetQuad"]').onclick = () => { s.quad = this.fullQuad(); v.draw(); };
  }
  process() { const s = this.st; s.img = enhance(warp(this.rotated, s.quad), s); this.gray = null; this.meas = null; this.rubber = null; s.autoScaled = false; s.mpp = null; s.measure = { a: null, b: null, m: s.measure.m }; s.check = { a: null, b: null, m: '' }; s.dims = null; }

  /* ---------- step 3: scale ---------- */
  step2() {
    const s = this.st, m = s.measure, c = s.check;
    const px = (l) => (l.a && l.b ? dist(l.a, l.b) : 0);
    const dev = s.mpp && c.a && c.b && +c.m > 0 ? ((px(c) * s.mpp) / +c.m - 1) * 100 : null;
    return `<div class="wz-two"><div class="wz-canvas" id="wzWrap"><canvas id="wzCv"></canvas><canvas class="wz-loupe" id="wzLoupe" width="150" height="150" hidden></canvas><div class="wz-stephint" id="wzStepHint"></div>
        <div class="wz-zoom"><button class="ibtn" data-z="in" title="${t('assistant.common.zoomIn')}">+</button><button class="ibtn" data-z="out" title="${t('assistant.common.zoomOut')}">−</button><button class="ibtn" data-z="fit" title="${t('assistant.common.fit')}">⤢</button></div></div>
      <div class="wz-side">
        ${this.ai?.configured ? `<p class="wz-tip">${t('assistant.wizard.aiScaleTip')}</p>` : ''}${s.scaleSearching ? this.progressHtml(t('assistant.wizard.aiSearchingDimensions')) : ''}<p class="hint">${t('assistant.wizard.manualMeasureHint')}</p>
        <div class="field"><label for="wzLen">${t('assistant.wizard.blueLineLength')}</label><input type="text" inputmode="decimal" id="wzLen" placeholder="${t('assistant.wizard.lengthExample')}" value="${esc(m.m)}" ${m.a && m.b ? '' : 'disabled'}></div>
        ${s.mpp ? `<p class="ok">${t('assistant.wizard.scaleSummary', { pixels: (1 / s.mpp).toFixed(1), width: (s.img.width * s.mpp).toFixed(2), height: (s.img.height * s.mpp).toFixed(2) })}</p>` : ''}
        ${s.mpp ? `<details ${c.a ? 'open' : ''}><summary>${t('assistant.wizard.checkDistance')}</summary>
          <p class="hint">${t('assistant.wizard.checkDistanceHint')}</p>
          <div class="actions"><button class="btn small" data-act="check">${t(c.a ? 'assistant.wizard.measureAgain' : 'assistant.wizard.measureCheckDistance')}</button></div>
          ${c.a && c.b ? `<div class="field"><label for="wzCheck">${t('assistant.wizard.planLength')}</label><input type="text" inputmode="decimal" id="wzCheck" value="${esc(c.m)}" placeholder="${(px(c) * s.mpp).toFixed(2)}"></div>` : ''}
          ${dev != null ? `<p class="${Math.abs(dev) < 2 ? 'ok' : 'warn'}">${t(Math.abs(dev) < 2 ? 'assistant.wizard.deviationFits' : 'assistant.wizard.deviationRemeasure', { deviation: `${dev > 0 ? '+' : ''}${dev.toFixed(1)}` })}</p>` : ''}
        </details>` : ''}
        ${this.ai?.configured ? `<div class="field"><span class="lbl">${t('assistant.wizard.aiHelp')}</span><button class="btn small" data-act="aiScale" ${s.busy ? 'disabled' : ''}>${icon('sparkle')}${t('assistant.wizard.findDimensions')}</button>${s.dims ? (s.dims.length ? `<div class="wz-dims">${s.dims.map((d, i) => `<button class="btn small" data-dim="${i}">${esc(d.label || d.meters)} → ${d.meters} m</button>`).join('')}</div><p class="hint">${t('assistant.wizard.tapToUseDistance')}</p>` : `<p class="hint">${t('assistant.wizard.noDimensions')}</p>`) : ''}</div>` : ''}
        <div class="actions"><button class="btn small" data-act="remeasure">${icon('ruler')}${t('assistant.wizard.remeasureDistance')}</button></div>
      </div></div>`;
  }
  wire2() {
    const R = this.root, s = this.st; const v = this.mkView(); v.setImage(s.img);
    if (!this.gray) this.gray = grayMap(s.img);
    // Measuring state machine: phase 'p1' = waiting for the first point, 'p2' = first point set,
    // waiting for the second (rubber band follows the pointer), null = nothing to place.
    if (!this.meas) this.meas = { which: 'main', phase: s.measure.b ? null : 'p1' };
    const M = this.meas; const line = () => (M.which === 'check' ? s.check : s.measure);
    const snap = (p, other, e) => {
      let q = [clamp(p[0], 0, s.img.width - 1), clamp(p[1], 0, s.img.height - 1)];
      if (!e?.altKey) {
        const r = Math.max(2, Math.round(8 / v.s)); let best = null, bs = 1e9; const W = s.img.width;
        for (let y = Math.max(0, Math.floor(q[1] - r)); y <= Math.min(s.img.height - 1, q[1] + r); y++) for (let x = Math.max(0, Math.floor(q[0] - r)); x <= Math.min(W - 1, q[0] + r); x++) {
          const gv = this.gray[y * W + x]; if (gv > 140) continue; const sc = gv + (Math.hypot(x - q[0], y - q[1]) / r) * 90; if (sc < bs) { bs = sc; best = [x + 0.5, y + 0.5]; }
        }
        if (best) q = best;
      }
      if (other && !e?.altKey) { const dx = q[0] - other[0], dy = q[1] - other[1]; if (Math.abs(dy) < Math.abs(dx) * 0.05) q[1] = other[1]; else if (Math.abs(dx) < Math.abs(dy) * 0.05) q[0] = other[0]; }
      return q;
    };
    const loupe = R.querySelector('#wzLoupe'), lg = loupe.getContext('2d');
    const showLoupe = (p, e) => {
      if (!p || !e) { loupe.hidden = true; return; }
      loupe.hidden = false; const sz = 150, z = Math.max(4, v.s * 4), half = sz / 2 / z;
      lg.imageSmoothingEnabled = false; lg.fillStyle = '#fff'; lg.fillRect(0, 0, sz, sz); lg.drawImage(s.img, p[0] - half, p[1] - half, half * 2, half * 2, 0, 0, sz, sz);
      lg.strokeStyle = '#ff3d71'; lg.lineWidth = 1; lg.beginPath(); lg.moveTo(sz / 2, 0); lg.lineTo(sz / 2, sz); lg.moveTo(0, sz / 2); lg.lineTo(sz, sz / 2); lg.stroke();
      const r = v.c.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; loupe.style.left = `${x + 24 + sz > r.width ? x - sz - 24 : x + 24}px`; loupe.style.top = `${y - sz - 24 < 0 ? y + 24 : y - sz - 24}px`;
    };
    const drawLine = (g, l, col, label, preview) => {
      if (!l.a) return; const a = v.toScr(l.a), bb = l.b || preview; const b = bb ? v.toScr(bb) : a;
      g.lineCap = 'round'; g.setLineDash(l.b ? [] : [8, 6]);
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 7; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
      g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); g.setLineDash([]);
      for (const p of [a, bb ? b : null].filter(Boolean)) { g.fillStyle = '#fff'; g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(p[0], p[1], 8, 0, 7); g.fill(); g.stroke(); }
      const txt = label || (bb ? `${Math.round(dist(l.a, bb))} px` : '');
      if (txt && bb) { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; g.font = '600 13px system-ui, sans-serif'; const w = g.measureText(txt).width + 14; g.fillStyle = col; g.beginPath(); g.roundRect(mx - w / 2, my - 30, w, 22, 6); g.fill(); g.fillStyle = '#0b0f17'; g.fillText(txt, mx - w / 2 + 7, my - 14); }
    };
    v.overlay = (g) => {
      (s.dims || []).forEach((d) => { const a = v.toScr(d.from), b = v.toScr(d.to); g.setLineDash([6, 5]); g.strokeStyle = '#7fd18b'; g.lineWidth = 2; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); g.setLineDash([]); });
      drawLine(g, s.measure, '#79a6ff', s.measure.b && s.measure.m ? `${s.measure.m} m` : '', M.which === 'main' && M.phase === 'p2' ? this.rubber : null);
      drawLine(g, s.check, '#ffb35c', s.check.b && s.mpp ? `${(dist(s.check.a, s.check.b) * s.mpp).toFixed(2)} m` : '', M.which === 'check' && M.phase === 'p2' ? this.rubber : null);
    };
    const hint = R.querySelector('#wzStepHint');
    const setHint = () => {
      const distance = t(M.which === 'check' ? 'assistant.wizard.checkDistanceNoun' : 'assistant.wizard.distanceNoun');
      hint.innerHTML = M.phase === 'p1' ? t('assistant.wizard.measureStepStart', { distance }) : M.phase === 'p2' ? t('assistant.wizard.measureStepEnd', { distance }) : s.mpp ? t('assistant.wizard.measureDone') : t('assistant.wizard.measureStepLength');
      hint.classList.toggle('active', !!M.phase);
    };
    const finish = () => { M.phase = null; this.rubber = null; loupe.hidden = true; this.recalc(); this.render(); setTimeout(() => this.root.querySelector(M.which === 'check' ? '#wzCheck' : '#wzLen')?.focus(), 30); };
    let press = null;
    v.onDown = (p, e) => {
      for (const l of [s.measure, s.check]) for (const k of ['a', 'b']) if (l[k] && l.b && dist(v.toScr(l[k]), v.toScr(p)) < 16) { press = { handle: { l, k } }; return true; }
      if (M.phase === 'p1') { const L = line(); L.a = snap(p, null, e); L.b = null; M.phase = 'p2'; this.rubber = L.a; press = { first: true, x: e.clientX, y: e.clientY }; setHint(); v.draw(); return true; }
      if (M.phase === 'p2') { press = { second: true }; this.rubber = snap(p, line().a, e); v.draw(); return true; }
      return false; // pan
    };
    v.onMove = (p, e) => {
      if (!press) return;
      if (press.handle) { const { l, k } = press.handle; l[k] = snap(p, l[k === 'a' ? 'b' : 'a'], e); this.recalc(); v.draw(); showLoupe(l[k], e); return; }
      if (press.first && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) press.dragging = true;
      if (press.dragging || press.second) { this.rubber = snap(p, line().a, e); v.draw(); showLoupe(this.rubber, e); }
    };
    v.onUp = () => {
      const pr = press; press = null; if (!pr) return;
      if (pr.handle) { loupe.hidden = true; this.render(); return; }
      if (pr.first && !pr.dragging) return; // simple click: wait for the second point
      const L = line(); if (!this.rubber || dist(v.toScr(L.a), v.toScr(this.rubber)) < 12) { this.msg(t('assistant.wizard.distanceTooShort'), true); return; }
      L.b = this.rubber; finish();
    };
    v.onHover = (p, e) => {
      if (!p) return showLoupe(null);
      const near = [s.measure, s.check].some((l) => l.b && ['a', 'b'].some((k) => dist(v.toScr(l[k]), v.toScr(p)) < 16));
      v.c.style.cursor = near ? 'grab' : M.phase ? 'crosshair' : 'grab';
      if (M.phase === 'p2') { this.rubber = snap(p, line().a, e); v.draw(); showLoupe(this.rubber, e); }
      else if (M.phase === 'p1') showLoupe(snap(p, null, e), e); else showLoupe(null);
    };
    this._key2 = (e) => { if (e.key === 'Escape' && M.phase === 'p2') { e.wzHandled = true; line().a = null; M.phase = 'p1'; this.rubber = null; setHint(); v.draw(); } };
    const num = (t) => parseFloat(String(t).replace(',', '.'));
    const len = R.querySelector('#wzLen');
    len?.addEventListener('input', (e) => { s.measure.m = e.target.value; this.recalc(); R.querySelector('[data-wz="next"]').disabled = !s.mpp; setHint(); v.draw(); });
    len?.addEventListener('change', () => this.render());
    len?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && num(s.measure.m) > 0) e.target.blur(); });
    R.querySelector('#wzCheck')?.addEventListener('change', (e) => { s.check.m = e.target.value; this.render(); });
    R.querySelector('[data-act="check"]')?.addEventListener('click', () => { s.check = { a: null, b: null, m: '' }; M.which = 'check'; M.phase = 'p1'; setHint(); v.draw(); });
    R.querySelector('[data-act="remeasure"]').onclick = () => { s.measure = { a: null, b: null, m: s.measure.m }; s.mpp = null; M.which = 'main'; M.phase = 'p1'; this.render(); };
    R.querySelector('[data-act="aiScale"]')?.addEventListener('click', () => this.aiScale());
    R.querySelector('.wz-dims')?.addEventListener('click', (e) => { const b = e.target.closest('[data-dim]'); if (!b) return; const d = s.dims[+b.dataset.dim]; s.measure = { a: d.from, b: d.to, m: localizedDecimal(d.meters) }; M.which = 'main'; M.phase = null; this.recalc(); this.render(); });
    setHint();
    if (s.scaleSearching) { hint.innerHTML = t('assistant.wizard.aiSearchingDimensionsInPlan'); hint.classList.add('active'); }
  }
  recalc() { const s = this.st, m = s.measure; const len = parseFloat(String(m.m).replace(',', '.')); s.mpp = m.a && m.b && len > 0 && dist(m.a, m.b) > 5 ? len / dist(m.a, m.b) : null; }
  // Model image with the current reading drawn on top (numbered polygons) for the self-check pass.
  overlayImage(im, rooms) {
    const c = document.createElement('canvas'); c.width = im.w; c.height = im.h; const g = c.getContext('2d');
    g.drawImage(limit(this.st.img, 1600), 0, 0); g.lineWidth = Math.max(2, im.w / 500); g.font = `bold ${Math.round(Math.max(14, im.w / 70))}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    rooms.forEach((r, i) => { const col = COLORS[i % COLORS.length]; g.beginPath(); r.points.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.globalAlpha = 0.18; g.fillStyle = col; g.fill(); g.globalAlpha = 1; g.strokeStyle = col; g.stroke();
      const cx = r.points.reduce((a, p) => a + p[0], 0) / r.points.length, cy = r.points.reduce((a, p) => a + p[1], 0) / r.points.length; g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, g.lineWidth * 6, 0, 7); g.fill(); g.fillStyle = '#000'; g.fillText(String(r.nr), cx, cy); });
    return c.toDataURL('image/jpeg', 0.8);
  }
  // 1568 px is the largest side Claude reads without resampling; Gemini and GPT handle it as well.
  modelImage() { const s = this.st; const img = limit(s.img, 1568); return { url: img.toDataURL('image/jpeg', 0.8), w: img.width, h: img.height, k: s.img.width / img.width }; }
  // Runs a recognition job on the server and polls it; survives reconnects and closed dialogs.
  async runJob(req) {
    const app = this.app; const run = (this.detectRun = { id: null }); this.detectStart = Date.now(); this.job = { stage: 'upload', elapsed: 0 };
    this.startTicker();
    const { job_id } = await app.hass.callWS({ type: 'hometwin/agent/detect_start', ...req, level_id: this.st.levelId });
    run.id = job_id; this.jobId = job_id;
    let fails = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1200));
      if (this.detectRun !== run) throw Object.assign(new Error('cancelled'), { cancelled: true });
      let job;
      try { ({ job } = await app.hass.callWS({ type: 'hometwin/agent/job', job_id })); fails = 0; }
      catch (e) { if (++fails > 25) throw new Error(t('assistant.wizard.noHomeAssistantConnection')); continue; } // reconnecting
      if (!job) throw new Error(t('assistant.wizard.jobMissing'));
      this.job = job; this.updateProgress();
      if (job.status === 'done') { app.hass.callWS({ type: 'hometwin/agent/job_consume', job_id }).catch(() => {}); return job.result; }
      if (job.status === 'error') throw new Error(job.error);
    }
  }
  startTicker() { clearInterval(this._tick); this._tick = setInterval(() => this.updateProgress(), 500); }
  stopTicker() { clearInterval(this._tick); this._tick = null; }
  // Renders the live status into whatever progress elements are on screen.
  updateProgress() {
    const R = this.root; if (!R || R.hidden) return;
    const j = this.job || {}; const sec = Math.round((Date.now() - (this.detectStart || Date.now())) / 1000);
    const order = ['upload', 'queued', 'sent', 'reading', 'parsing', 'fitting'];
    const at = Math.max(0, order.indexOf(j.stage === 'chars' ? 'reading' : j.stage));
    const lines = [
      ['upload', t('assistant.wizard.progressUpload')],
      ['sent', t('assistant.wizard.progressSent', { size: j.kb ? ` (${j.kb} KB)` : '' })],
      ['reading', j.chars ? t('assistant.wizard.progressReading', { chars: j.chars.toLocaleString(getLanguage() === 'de' ? 'de-DE' : 'en-US'), result: j.rooms ? t('assistant.wizard.progressReadResult', { count: j.rooms, item: t(this.scaleOnly ? 'assistant.wizard.dimensions' : 'assistant.wizard.rooms') }) : '' }) : t('assistant.wizard.progressModelReading')],
      ...(this.scaleOnly ? [] : [['parsing', t('assistant.wizard.progressParsing')], ['fitting', t('assistant.wizard.progressFitting')]]),
    ];
    const html = lines.map(([k, l]) => { const i = order.indexOf(k); return i > at ? '' : `<li class="${i === at || (k === 'reading' && at === order.indexOf('reading')) ? 'cur' : 'done'}">${l}</li>`; }).join('');
    for (const el of R.querySelectorAll('[data-prog]')) el.innerHTML = html;
    for (const el of R.querySelectorAll('[data-time]')) el.textContent = `${sec} s`;
    for (const el of R.querySelectorAll('[data-slow]')) el.hidden = sec < 75;
  }
  progressHtml(title) {
    return `<div class="wz-live"><h3>${title} <span class="wz-time" data-time>0 s</span></h3><ol class="wz-progress" data-prog></ol>
      <p class="hint" data-slow hidden>${t('assistant.wizard.slowDetectionHint')}</p>
      <div class="actions"><button class="btn small" data-act="cancelDetect">${t('assistant.common.cancel')}</button></div></div>`;
  }
  cancelJob() { this.detectRun = null; this.stopTicker(); this.st.busy = false; this.st.scaleSearching = false; this.st.err = t('assistant.common.cancelled'); this.render(); }
  async aiScale() {
    const s = this.st; if (s.busy) return; s.busy = true; s.scaleSearching = true; this.scaleOnly = true; s.err = null; this.render();
    try {
      const im = this.modelImage();
      const res = await this.runJob({ mode: 'scale', image: im.url, width: im.w, height: im.h });
      s.dims = (res.dimensions || []).map((d) => ({ ...d, from: [d.from[0] * im.k, d.from[1] * im.k], to: [d.to[0] * im.k, d.to[1] * im.k] }));
      if (s.dims.length && !s.measure.b) { const d = [...s.dims].sort((a, b) => b.meters - a.meters)[0]; s.measure = { a: d.from, b: d.to, m: localizedDecimal(d.meters) }; this.meas = null; this.recalc(); }
      if (!s.dims.length) s.err = t('assistant.wizard.noReadableDimensions');
    } catch (e) { if (e.cancelled) return; s.err = t('assistant.wizard.aiHelpFailed', { error: e.message || e.code || e }); }
    this.stopTicker(); s.busy = false; s.scaleSearching = false; this.scaleOnly = false; if (s.step === 2) this.render();
    if (s.mpp) this.msg(t('assistant.wizard.scaleAppliedFromDimension', { length: s.measure.m }));
  }

  /* ---------- step 4: recognise ---------- */
  step3() {
    const s = this.st;
    if (!this.ai?.configured) return `<div class="wz-center"><h3>${t('assistant.wizard.aiNotConfigured')}</h3>
      <p>${t('assistant.wizard.manualWithoutAi')}</p>
      <p class="hint">${t('assistant.wizard.aiSetupHint')}</p>
      <div class="actions"><button class="btn" data-wz="back2">${t('assistant.common.back')}</button><button class="btn primary" data-act="manual">${t('assistant.wizard.useAsTemplate')}</button></div></div>`;
    return `<div class="wz-two"><div class="wz-canvas scanning" id="wzWrap"><canvas id="wzCv"></canvas>${s.busy ? '<div class="wz-scan"></div>' : ''}</div>
      <div class="wz-side">
        ${s.busy ? this.progressHtml(this.passTitle || t(s.opts.refine !== false ? 'assistant.wizard.firstPassRecognizing' : 'assistant.wizard.recognizingRooms')) : `<h3>${t('assistant.wizard.recognition')}</h3>${s.err ? `<p class="warn">${esc(s.err)}</p>${this.jobId ? `<div class="actions"><button class="btn small" data-act="copyRaw">${icon('code')}${t('assistant.wizard.copyModelAnswer')}</button></div><textarea class="wz-raw" id="wzRaw" rows="6" readonly hidden></textarea>` : ''}` : ''}<p class="hint">${t('assistant.wizard.modelRecommendation', { model: esc(this.ai?.model || '–'), scale: s.mpp ? '' : t('assistant.wizard.scaleReadDuringRecognition') })}</p>`}
        <fieldset ${s.busy ? 'disabled' : ''}><legend class="lbl">${t('assistant.wizard.whatToRecognize')}</legend>
          <label class="chk"><input type="checkbox" checked disabled> ${t('assistant.wizard.roomsAndOutdoor')}</label>
          <label class="chk"><input type="checkbox" id="wzOpen" ${s.opts.openings ? 'checked' : ''}> ${t('assistant.wizard.doorsAndWindows')}</label>
          <label class="chk"><input type="checkbox" id="wzStairs" ${s.opts.stairs ? 'checked' : ''}> ${t('assistant.wizard.stairs')}</label>
          <label class="chk"><input type="checkbox" id="wzRefine" ${s.opts.refine !== false ? 'checked' : ''}> ${t('assistant.wizard.secondPassOption')}</label></fieldset>
        <div class="field"><label for="wzHints">${t('assistant.wizard.aiHints')}</label><textarea id="wzHints" rows="3" placeholder="${t('assistant.wizard.aiHintsPlaceholder')}" ${s.busy ? 'disabled' : ''}>${esc(s.hints)}</textarea></div>
        <div class="actions"><button class="btn small" data-wz="back2" ${s.busy ? 'disabled' : ''}>${t('assistant.wizard.backToScale')}</button><button class="btn primary small" data-act="detect" ${s.busy ? 'disabled' : ''}>${icon('sparkle')}${t(s.err ? 'assistant.common.tryAgain' : 'assistant.common.recognize')}</button></div>
      </div></div>`;
  }
  wire3() {
    const R = this.root, s = this.st;
    R.querySelector('[data-wz="back2"]')?.addEventListener('click', () => this.go(2));
    R.querySelector('[data-act="manual"]')?.addEventListener('click', () => this.manual());
    if (!this.ai?.configured) return;
    const v = this.mkView(); v.setImage(s.img);
    R.querySelector('#wzOpen').onchange = (e) => (s.opts.openings = e.target.checked);
    R.querySelector('#wzStairs').onchange = (e) => (s.opts.stairs = e.target.checked);
    R.querySelector('#wzRefine').onchange = (e) => (s.opts.refine = e.target.checked);
    R.querySelector('#wzHints').oninput = (e) => (s.hints = e.target.value);
    R.querySelector('[data-act="detect"]').onclick = () => this.detect();
    R.querySelector('[data-act="copyRaw"]')?.addEventListener('click', () => this.copyRaw());

  }
  // Diagnostics for failed recognitions: model, error and the raw model answer (copied and shown).
  async copyRaw() {
    const box = this.root.querySelector('#wzRaw'); if (!box) return;
    let text;
    try {
      const { job } = await this.app.hass.callWS({ type: 'hometwin/agent/job', job_id: this.jobId, with_raw: true });
      text = `HomeTwin ${t('assistant.wizard.recognition')}\nmodel: ${job?.model || this.ai?.model || '?'}\nstatus: ${job?.status}\nerror: ${job?.error || this.st.err || ''}\nrooms: ${job?.rooms_raw ?? '?'} → ${job?.rooms_used ?? '?'} ${JSON.stringify(job?.dropped || {})}\n\n${job?.raw || t('assistant.wizard.noModelAnswer')}`;
    } catch (e) { text = String(e.message || e); }
    box.value = text; box.hidden = false; box.select();
    try { await navigator.clipboard.writeText(text); this.msg(t('assistant.wizard.modelAnswerCopied')); } catch { /* selection stays for manual copy */ }
  }
  async detect({ keepLocked = false } = {}) {
    const s = this.st; if (s.busy) return;
    s.busy = true; s.err = null; this.scaleOnly = false; if (s.step !== 3 && !keepLocked) s.step = 3; this.render();
    const locked = keepLocked ? (s.result?.rooms || []).filter((r) => r.locked) : [];
    try {
      const im = this.modelImage();
      const res = await this.runJob({ mode: 'rooms', image: im.url, width: im.w, height: im.h, mpp: s.mpp ? s.mpp * im.k : null, x0: 0, z0: 0,
        options: s.opts, hints: s.hints || undefined, language: getLanguage(), locked: locked.map((r) => ({ name: r.name, points: r.points })) });
      if (!res?.rooms?.length && !locked.length) throw new Error(t('assistant.wizard.noRoomsReturned'));
      const t0 = this.detectStart; let out = res;
      if (s.opts.refine !== false && res.rooms?.length) { // pass 2: the model checks its own reading on an overlay
        this.passTitle = t('assistant.wizard.secondPassChecking'); this.render();
        try {
          const mppM = res.mpp || s.mpp * im.k, px = (p) => [Math.round(p[0] / mppM), Math.round(p[1] / mppM)];
          const current = { rooms: res.rooms.map((r, i) => ({ nr: i + 1, name: r.name, kind: r.kind, points: r.points.map(px), label_area_m2: r.label_area ?? undefined })), openings: (res.openings || []).map((o) => ({ type: o.type, from: px(o.from), to: px(o.to) })), stairs: (res.stairs || []).map((t) => ({ points: t.points.map(px), up_from: t.up_from && px(t.up_from), up_to: t.up_to && px(t.up_to) })) };
          const ref = await this.runJob({ mode: 'refine', image: im.url, overlay: this.overlayImage(im, current.rooms), current, width: im.w, height: im.h, mpp: mppM, x0: 0, z0: 0, options: s.opts, hints: s.hints || undefined, language: getLanguage() });
          // accept pass 2 only if it is not worse: same overall size, area errors vs. the printed m² not larger
          const err = (x) => { const v = (x.rooms || []).filter((r) => r.label_area > 0.5 && r.net_area > 0).map((r) => Math.min(1, Math.abs(r.net_area / r.label_area - 1))); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
          const size = (x) => { const b = bbox((x.rooms || []).flatMap((r) => r.points)); return Math.sqrt(b.w * b.d); };
          const ratio = ref?.rooms?.length ? size(ref) / size(res) : 0, e1 = err(res), e2 = ref?.rooms ? err(ref) : 1;
          if (ref?.rooms?.length && (ratio < 0.92 || ratio > 1.08 || e2 > e1 + 0.02)) out = { ...res, adjusted: [...(res.adjusted || []), t('assistant.wizard.secondPassRejected', { secondError: Math.round(e2 * 100), firstError: Math.round(e1 * 100), ratio: ratio.toFixed(2) })] };
          else if (ref?.rooms?.length >= Math.max(1, res.rooms.length * 0.6)) out = { ...ref, mpp: res.mpp, scale_source: res.scale_source, level: ref.level || res.level, roof: ref.roof || res.roof, adjusted: [t('assistant.wizard.secondPassAccepted'), ...(ref.adjusted || [])] };
          else out = { ...res, adjusted: [...(res.adjusted || []), t('assistant.wizard.secondPassUnusable')] };
        } catch (e) { if (e.cancelled) { this.passTitle = null; return; } out = { ...res, adjusted: [...(res.adjusted || []), t('assistant.wizard.secondPassFailed', { error: e.message || e })] }; }
      }
      this.passTitle = null; this.detectStart = t0;
      this.stopTicker(); this.useResult(out, im.k, locked, Math.round((Date.now() - t0) / 1000));
    } catch (e) { this.passTitle = null; if (e.cancelled) return; this.stopTicker(); s.busy = false;
      // go() clears the error, so set it afterwards: a failed recognition must never look like an empty result.
      const err = t('assistant.wizard.recognitionFailed', { error: e.message || e.code || e }); this.go(keepLocked ? 4 : 3); s.err = err; this.render(); this.msg(err, true); }
  }
  // Takes a recognition result (metres; model image scale k) into the review step.
  useResult(res, k = 1, locked = [], seconds = null) {
    const s = this.st;
    if (!res?.rooms?.length && !locked.length) { s.busy = false; this.go(3); s.err = t('assistant.wizard.noRoomsReturned'); this.render(); return; }
    if (!s.mpp && res.mpp) { s.mpp = res.mpp / k; s.measure = { a: null, b: null, m: '' }; s.scaleFromDims = true; }
    const rooms = res.rooms.map((r, i) => ({ ...r, id: newId('wr'), color: COLORS[(locked.length + i) % COLORS.length] }));
    const sc = res.scale_check && Math.abs(res.scale_check.factor - 1) > 0.025 ? res.scale_check : null;
    s.result = { level: res.level || s.result?.level || null, roof: res.roof || s.result?.roof || null, rooms: [...locked, ...rooms], openings: s.opts.openings ? res.openings || [] : [], stairs: s.opts.stairs ? res.stairs || [] : [], notes: res.notes || '', adjusted: [...(res.scale_source === 'dimensions' ? [t('assistant.wizard.scaleReadFromDimensions')] : []), ...(res.adjusted || [])], serverProblems: res.problems || [], scale: sc, seconds };
    s.busy = false; s.sel = null; this.go(4);
  }
  // Offers the result of a recognition that finished (or still runs) while the dialog was closed.
  async checkPendingJob() {
    let job; try { ({ job } = await this.app.hass.callWS({ type: 'hometwin/agent/job' })); } catch { return; }
    if (!job || job.mode !== 'rooms' || job.consumed || job.status === 'error' || Date.now() / 1000 - job.started > 3600 || this.st.step !== 0 || this.st.src) return;
    this.pending = job; this.render();
  }
  async resumeJob() {
    const s = this.st, job = this.pending; this.pending = null; if (!job) return;
    try {
      const { job: full } = await this.app.hass.callWS({ type: 'hometwin/agent/job', job_id: job.id, with_image: true }); this.jobId = full.id;
      const img = new Image(); img.src = full.image; await img.decode(); s.img = canvasOf(img); s.src = s.img; s.srcName = t('assistant.wizard.lastDetection'); this.rotated = s.img; s.quad = [[0, 0], [s.img.width, 0], [s.img.width, s.img.height], [0, s.img.height]];
      if (full.level_id && this.app.plan.levels.some((l) => l.id === full.level_id)) s.levelId = full.level_id;
      if (full.status === 'running') { s.step = 3; s.busy = true; this.render(); const run = (this.detectRun = { id: full.id }); this.detectStart = Date.now() - full.elapsed * 1000; this.job = full; this.startTicker();
        for (;;) { await new Promise((r) => setTimeout(r, 1200)); if (this.detectRun !== run) return; const { job: j } = await this.app.hass.callWS({ type: 'hometwin/agent/job', job_id: full.id }); this.job = j; if (j.status === 'done') { this.stopTicker(); this.app.hass.callWS({ type: 'hometwin/agent/job_consume', job_id: full.id }).catch(() => {}); return this.useResult(j.result, 1, [], Math.round(j.elapsed)); } if (j.status === 'error') { this.stopTicker(); s.busy = false; this.go(3); s.err = j.error; return this.render(); } } }
      this.app.hass.callWS({ type: 'hometwin/agent/job_consume', job_id: full.id }).catch(() => {});
      this.useResult(full.result, 1, [], Math.round(full.elapsed));
    } catch (e) { this.msg(t('assistant.wizard.resultLoadFailed', { error: e.message || e }), true); }
  }
  async manual() { const id = await this.targetLevel(); await this.saveUnderlay(id); this.app.markDirty(); this.close(); const ed = this.app.editor; this.app.setMode('edit'); this.app.setLevel(id); ed.setView2d(true); ed.setTool('rect'); this.app.toast(t('assistant.wizard.manualTemplateToast')); }

  /* ---------- step 5: review ---------- */
  problems() {
    const R = this.st.result?.rooms || []; const out = [];
    const walled = R.filter((r) => r.kind !== 'outdoor');
    for (let i = 0; i < walled.length; i++) for (let k = i + 1; k < walled.length; k++) { const ov = overlap(walled[i].points, walled[k].points); if (ov > 0.05) out.push({ ids: [walled[i].id, walled[k].id], text: t('assistant.wizard.roomsOverlap', { first: walled[i].name, second: walled[k].name, area: ov.toFixed(2) }) }); }
    for (const o of R.filter((r) => r.kind === 'outdoor')) { const hit = walled.map((w) => [w, overlap(o.points, w.points)]).filter(([, ov]) => ov > 0.3); if (hit.length) out.push({ ids: [o.id, ...hit.map(([w]) => w.id)], trim: o.id, text: t('assistant.wizard.outdoorOverlap', { name: o.name, rooms: hit.map(([w]) => `“${w.name}”`).join(', '), area: hit.reduce((sum, [, ov]) => sum + ov, 0).toFixed(1) }) }); }
    for (const r of R) { const n = netArea(r, R); if (r.label_area && Math.abs(n / r.label_area - 1) > 0.08 && Math.abs(n - r.label_area) > 0.4) out.push({ ids: [r.id], text: t('assistant.wizard.areaMismatch', { name: r.name, actual: n.toFixed(1), planned: r.label_area }) }); }
    for (const problem of this.st.result?.serverProblems || []) if (/Plan-Maß|Maß |plan dimension|dimension/i.test(problem)) { const r = R.find((x) => problem.includes(`„${x.name}“`) || problem.includes(`“${x.name}”`)); out.push({ ids: [r?.id || ''], text: problem }); }
    return out;
  }
  step4() {
    const s = this.st, R = s.result; const probs = this.problems();
    const levelName = s.levelId === '__new' ? (s.newLevelTouched && s.newLevel) || R.level?.name || s.newLevel || t('assistant.wizard.defaultNewLevel') : this.app.plan.levels.find((l) => l.id === s.levelId)?.name;
    const hasRooms = s.levelId !== '__new' && this.app.plan.levels.find((l) => l.id === s.levelId)?.rooms.length;
    return `<div class="wz-two"><div class="wz-canvas" id="wzWrap"><canvas id="wzCv"></canvas>
        <div class="wz-zoom"><button class="ibtn" data-z="in" title="${t('assistant.common.zoomIn')}">+</button><button class="ibtn" data-z="out" title="${t('assistant.common.zoomOut')}">−</button><button class="ibtn" data-z="fit" title="${t('assistant.common.fit')}">⤢</button></div>
        <div class="wz-blend"><span>${t('assistant.wizard.plan')}</span><input type="range" id="wzAlpha" min="0" max="1" step="0.05" value="${s.overlayAlpha}" aria-label="${t('assistant.wizard.blend')}"><span>${t('assistant.wizard.rooms')}</span></div></div>
      <div class="wz-side wz-review">
        <div class="wz-sum">${t('assistant.wizard.reviewSummary', { rooms: R.rooms.length, openings: R.openings.length, stairs: R.stairs.length ? t('assistant.wizard.stairCountSuffix', { count: R.stairs.length }) : '', area: R.rooms.reduce((a, r) => a + (r.kind === 'outdoor' ? 0 : netArea(r, R.rooms)), 0).toFixed(1), duration: R.seconds ? t('assistant.wizard.recognitionDurationSuffix', { seconds: R.seconds }) : '' })}</div>
        ${(R.adjusted || []).length ? `<p class="ok">✓ ${R.adjusted.map(esc).join(' · ')}</p>` : ''}
        ${R.scale ? `<div class="wz-probs"><button class="warn" data-act="fixScale">${t('assistant.wizard.scaleMismatch', { percent: ((R.scale.factor - 1) * 100).toFixed(1) })}</button></div>` : ''}
        ${probs.length ? `<div class="wz-probs">${probs.map((p) => `<div class="wz-prob"><button class="warn" data-psel="${p.ids[0]}">⚠ ${esc(p.text)}</button>${p.trim && trimRect(R.rooms.find((r) => r.id === p.trim), R.rooms) ? `<button class="btn small" data-trim="${p.trim}">${t('assistant.wizard.trim')}</button>` : ''}</div>`).join('')}${probs.filter((p) => p.trim).length > 1 ? `<button class="btn small" data-trim="*">${t('assistant.wizard.trimAllOutdoor')}</button>` : ''}</div>` : `<p class="ok">${t('assistant.wizard.noOverlaps')}</p>`}
        ${R.notes ? `<p class="hint">${t('assistant.wizard.aiNote', { note: esc(R.notes) })}</p>` : ''}
        <ul class="wz-rooms">${R.rooms.map((r) => `<li data-rid="${r.id}" class="${s.sel === r.id ? 'sel' : ''}"><i style="background:${r.color}"></i>
          <input value="${esc(r.name)}" data-name="${r.id}" aria-label="${t('assistant.common.name')}">
          <select data-kind="${r.id}" aria-label="${t('assistant.common.type')}"><option value="room" ${r.kind === 'room' ? 'selected' : ''}>${t('assistant.wizard.room')}</option><option value="garage" ${r.kind === 'garage' ? 'selected' : ''}>${t('assistant.wizard.garage')}</option><option value="outdoor" ${r.kind === 'outdoor' ? 'selected' : ''}>${t('assistant.wizard.outdoor')}</option></select>
          <small title="${t('assistant.wizard.clearAreaTitle', { planned: r.label_area ? t('assistant.wizard.plannedAreaSuffix', { area: r.label_area }) : '' })}">${netArea(r, R.rooms).toFixed(1)} m²${r.label_area ? `<br><span class="${Math.abs(netArea(r, R.rooms) / r.label_area - 1) <= 0.08 ? 'ok' : 'warn'}">${t('assistant.wizard.planArea', { area: r.label_area })}</span>` : ''}</small>
          <button class="ibtn" data-lock="${r.id}" title="${t(r.locked ? 'assistant.wizard.unlockRecognition' : 'assistant.wizard.lockRecognition')}" aria-pressed="${!!r.locked}">${icon(r.locked ? 'lock' : 'unlock')}</button>
          <button class="ibtn" data-del="${r.id}" title="${t('assistant.wizard.removeRoom')}">${icon('x')}</button></li>`).join('')}</ul>
        <div class="actions"><button class="btn small" data-act="addRect">${icon('square')}${t('assistant.wizard.addRoom')}</button></div>
        ${this.openingsHtml()}
        <details><summary>${t('assistant.wizard.recognizeAgain')}</summary>
          <p class="hint">${t('assistant.wizard.recognizeAgainHint')}</p>
          <textarea id="wzHints2" rows="2" placeholder="${t('assistant.wizard.recognizeAgainPlaceholder')}">${esc(s.hints)}</textarea>
          <div class="actions"><button class="btn small" data-act="redetect" ${s.busy ? 'disabled' : ''}>${icon('sparkle')}${t(s.busy ? 'assistant.wizard.recognizing' : 'assistant.wizard.recognizeUnlocked')}</button></div></details>
        ${s.levelId === '__new' ? this.heightsHtml() : ''}
        <fieldset class="wz-apply"><legend class="lbl">${t('assistant.wizard.applyToLevel', { name: esc(levelName) })}</legend>
          ${hasRooms ? `<label class="chk"><input type="radio" name="wzMode" value="replace" ${s.mode === 'replace' ? 'checked' : ''}> ${t('assistant.wizard.replaceRooms')}</label><label class="chk"><input type="radio" name="wzMode" value="add" ${s.mode === 'add' ? 'checked' : ''}> ${t('assistant.common.add')}</label>` : ''}
          <label class="chk"><input type="checkbox" id="wzKeep" ${s.keepUnderlay ? 'checked' : ''}> ${t('assistant.wizard.keepTemplate')}</label>
          <label class="chk"><input type="checkbox" id="wzMap" ${s.mapAreas ? 'checked' : ''}> ${t('assistant.wizard.mapAreas')}</label></fieldset>
        <p class="hint">${t('assistant.wizard.reviewEditHint')}</p>
      </div></div>`;
  }
  wire4() {
    const R = this.root, s = this.st, res = s.result; const v = this.mkView(); v.setImage(s.img); v.imgAlpha = 1;
    const toPx = (p) => [p[0] / s.mpp, p[1] / s.mpp], toM = (p) => [p[0] * s.mpp, p[1] * s.mpp];
    const probs = new Set(this.problems().flatMap((p) => p.ids));
    v.overlay = (g) => {
      const a = s.overlayAlpha; const labels = [];
      for (const r of res.rooms) {
        const q = r.points.map((p) => v.toScr(toPx(p)));
        g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath();
        g.globalAlpha = a * (r.kind === 'outdoor' ? 0.35 : 0.55); g.fillStyle = r.color; g.fill(); g.globalAlpha = Math.min(1, 0.4 + a);
        g.lineWidth = s.sel === r.id ? 3 : 2; g.strokeStyle = probs.has(r.id) ? '#ff5c5c' : s.sel === r.id ? '#fff' : r.color; g.stroke(); g.globalAlpha = 1;
        labels.push({ r, c: v.toScr(toPx(pole(r.points))) });
        if (s.sel === r.id) for (const p of q) { g.fillStyle = '#fff'; g.strokeStyle = r.color; g.lineWidth = 3; g.beginPath(); g.arc(p[0], p[1], 7, 0, 7); g.fill(); g.stroke(); }
      }
      if (a > 0.15) { // two-line labels at the visual centre, nudged so they do not overlap
        const boxes = []; g.textAlign = 'center';
        for (const { r, c } of labels.sort((x, y) => polyArea(y.r.points) - polyArea(x.r.points))) {
          g.font = '600 11.5px system-ui, sans-serif'; const t1 = r.name, t2 = `${netArea(r, res.rooms).toFixed(1)} m²`;
          const w = Math.max(g.measureText(t1).width, g.measureText(t2).width) + 12, h = 32;
          let y = c[1]; for (const dy of [0, 18, -18, 36, -36, 54, -54]) { const b = [c[0] - w / 2, c[1] + dy - h / 2, w, h]; if (!boxes.some((o) => b[0] < o[0] + o[2] && o[0] < b[0] + b[2] && b[1] < o[1] + o[3] && o[1] < b[1] + b[3])) { y = c[1] + dy; break; } }
          const b = [c[0] - w / 2, y - h / 2, w, h]; boxes.push(b);
          g.fillStyle = 'rgba(11,15,23,.82)'; g.beginPath(); g.roundRect(b[0], b[1], b[2], b[3], 5); g.fill();
          g.fillStyle = '#fff'; g.fillText(t1, c[0], y - 2); g.font = '500 10.5px system-ui, sans-serif'; g.fillStyle = '#c9d3e6'; g.fillText(t2, c[0], y + 11);
        }
        g.textAlign = 'start';
      }
      g.lineWidth = 4; g.lineCap = 'round';
      res.openings.forEach((o, i) => { const a1 = v.toScr(toPx(o.from)), b1 = v.toScr(toPx(o.to)); const sel = s.selOpen === i;
        if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 9; g.beginPath(); g.moveTo(...a1); g.lineTo(...b1); g.stroke(); g.lineWidth = 4; }
        g.strokeStyle = OPEN_COL[o.type] || '#fff'; g.beginPath(); g.moveTo(...a1); g.lineTo(...b1); g.stroke();
        if (sel) for (const p of [a1, b1]) { g.fillStyle = '#fff'; g.beginPath(); g.arc(p[0], p[1], 6, 0, 7); g.fill(); } });
      for (const st of res.stairs) { const q = st.points.map((p) => v.toScr(toPx(p))); g.setLineDash([5, 4]); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); g.stroke(); g.setLineDash([]); }
      if (this.newRect) { const a1 = v.toScr(toPx(this.newRect.a)), b1 = v.toScr(toPx(this.newRect.b)); g.strokeStyle = '#fff'; g.setLineDash([6, 4]); g.strokeRect(a1[0], a1[1], b1[0] - a1[0], b1[1] - a1[1]); g.setLineDash([]); }
    };
    const snapM = (m, skip) => { // grid + flush with other rooms' coordinates
      const xs = [], zs = []; for (const r of res.rooms) if (r.id !== skip) for (const p of r.points) { xs.push(p[0]); zs.push(p[1]); }
      const tol = Math.max(0.08, 12 / v.s * s.mpp);
      const near = (val, arr) => arr.reduce((b, w) => (Math.abs(w - val) < Math.abs(b - val) ? w : b), Infinity);
      const nx = near(m[0], xs), nz = near(m[1], zs);
      return [Math.abs(nx - m[0]) < tol ? nx : r3(Math.round(m[0] / 0.05) * 0.05), Math.abs(nz - m[1]) < tol ? nz : r3(Math.round(m[1] / 0.05) * 0.05)];
    };
    const edgeAt = (m) => { let best = null; for (const r of res.rooms) r.points.forEach((a, i) => { const b = r.points[(i + 1) % r.points.length], d = distToSeg(m, a, b); if (!best || d < best.d) best = { d, a, b }; }); return best; };
    const openAt = (p) => { let bi = -1, bd = 9; res.openings.forEach((o, i) => { const d = distToSeg(p, v.toScr(toPx(o.from)), v.toScr(toPx(o.to))); if (d < bd) { bd = d; bi = i; } }); return bi; };
    v.onDown = (p) => {
      if (this.adding) { this.newRect = { a: snapM(toM(p)), b: snapM(toM(p)) }; return true; }
      const so = res.openings[s.selOpen];
      if (so) { for (const k of ['from', 'to']) if (dist(v.toScr(toPx(so[k])), v.toScr(p)) < 11) { this.dragO = { o: so, k }; return true; } }
      if (this.openTool) { const m = toM(p), e = edgeAt(m); const tol = Math.max(0.4, 14 / v.s * s.mpp);
        if (!e || e.d > tol) { this.msg(t('assistant.wizard.clickNearRoomEdge'), true); return true; }
        const pr = projectOnSeg(m, e.a, e.b), L = pr.len, ww = Math.min(OPEN_W[this.openTool], L - 0.1), t0 = Math.max(ww / 2, Math.min(L - ww / 2, pr.t * L)), ux = (e.b[0] - e.a[0]) / L, uz = (e.b[1] - e.a[1]) / L;
        res.openings.push({ type: this.openTool, from: [r3(e.a[0] + ux * (t0 - ww / 2)), r3(e.a[1] + uz * (t0 - ww / 2))], to: [r3(e.a[0] + ux * (t0 + ww / 2)), r3(e.a[1] + uz * (t0 + ww / 2))] });
        s.selOpen = res.openings.length - 1; this.render(); return true; }
      const oi = openAt(p); if (oi >= 0) { s.selOpen = oi; this.render(); return true; }
      if (s.selOpen != null) { s.selOpen = null; this.render(); return true; }
      const sel = res.rooms.find((r) => r.id === s.sel);
      if (sel) { const i = sel.points.findIndex((q) => dist(v.toScr(toPx(q)), v.toScr(p)) < 14); if (i >= 0) { this.dragV = { r: sel, i }; return true; } }
      const m = toM(p); const hit = [...res.rooms].reverse().find((r) => inside(m, r.points));
      if (hit) { s.sel = hit.id; this.pickOnly = true; v.draw(); this.syncList(); return true; }
      return false;
    };
    v.onMove = (p) => {
      if (this.dragO) { const { o, k } = this.dragO, other = o[k === 'from' ? 'to' : 'from'], m = toM(p); const dx = o.to[0] - o.from[0], dz = o.to[1] - o.from[1], L0 = Math.hypot(dx, dz) || 1, ux = dx / L0, uz = dz / L0;
        const t = (m[0] - other[0]) * (k === 'to' ? ux : -ux) + (m[1] - other[1]) * (k === 'to' ? uz : -uz), len = Math.max(0.3, Math.round(t / 0.05) * 0.05);
        o[k] = [r3(other[0] + (k === 'to' ? ux : -ux) * len), r3(other[1] + (k === 'to' ? uz : -uz) * len)]; v.draw(); return; }
      if (this.newRect) { this.newRect.b = snapM(toM(p)); v.draw(); return; }
      if (this.dragV) { this.dragV.r.points[this.dragV.i] = snapM(toM(p), this.dragV.r.id); v.draw(); }
    };
    v.onUp = () => {
      if (this.newRect) { const { a, b } = this.newRect; this.newRect = null; this.adding = false; v.c.style.cursor = 'default';
        if (Math.abs(b[0] - a[0]) > 0.4 && Math.abs(b[1] - a[1]) > 0.4) { const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]); const r = { id: newId('wr'), name: t('assistant.wizard.defaultNewRoom'), kind: 'room', points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], color: COLORS[res.rooms.length % COLORS.length] }; res.rooms.push(r); s.sel = r.id; }
        this.render(); return; }
      if (this.dragV) { this.dragV = null; this.render(); return; }
      if (this.dragO) { this.dragO = null; this.render(); return; }
      if (this.pickOnly) { this.pickOnly = false; }
    };
    v.onHover = (p) => { if (!p) return; const sel = res.rooms.find((r) => r.id === s.sel); v.c.style.cursor = this.adding || this.openTool ? 'crosshair' : sel && sel.points.some((q) => dist(v.toScr(toPx(q)), v.toScr(p)) < 14) ? 'grab' : 'default'; };
    R.querySelector('#wzAlpha').oninput = (e) => { s.overlayAlpha = +e.target.value; v.draw(); };
    R.querySelector('[data-act="fixScale"]')?.addEventListener('click', () => { const f = res.scale.factor; s.mpp *= f; const sc = (p) => [r3(p[0] * f), r3(p[1] * f)]; for (const r of res.rooms) r.points = r.points.map(sc); for (const stair of res.stairs) stair.points = stair.points.map(sc); for (const o of res.openings) { o.from = sc(o.from); o.to = sc(o.to); } res.scale = null; this.render(); this.msg(t('assistant.wizard.scaleApplied')); });
    const list = R.querySelector('.wz-rooms');
    list.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]'); if (del) { res.rooms = res.rooms.filter((r) => r.id !== del.dataset.del); if (s.sel === del.dataset.del) s.sel = null; return this.render(); }
      const lk = e.target.closest('[data-lock]'); if (lk) { const r = res.rooms.find((x) => x.id === lk.dataset.lock); r.locked = !r.locked; return this.render(); }
      const li = e.target.closest('[data-rid]'); if (li && !e.target.closest('input,select')) { s.sel = li.dataset.rid; this.syncList(); v.draw(); }
    });
    list.addEventListener('input', (e) => { const id = e.target.dataset.name; if (id) { res.rooms.find((r) => r.id === id).name = e.target.value; v.draw(); } });
    list.addEventListener('change', (e) => { const id = e.target.dataset.kind; if (id) { res.rooms.find((r) => r.id === id).kind = e.target.value; this.render(); } });
    list.addEventListener('focusin', (e) => { const li = e.target.closest('[data-rid]'); if (li) { s.sel = li.dataset.rid; this.syncList(); v.draw(); } });
    R.querySelector('.wz-probs')?.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-trim]');
      if (tb) { const ids = tb.dataset.trim === '*' ? res.rooms.filter((r) => r.kind === 'outdoor').map((r) => r.id) : [tb.dataset.trim]; let n = 0; for (const id of ids) { const r = res.rooms.find((x) => x.id === id); const trimmed = r && trimRect(r, res.rooms); if (trimmed) { r.points = trimmed; n++; } } this.render(); this.msg(t(n ? 'assistant.wizard.outdoorTrimmed' : 'assistant.wizard.nothingToTrim', { count: n })); return; }
      const b = e.target.closest('[data-psel]'); if (b) { s.sel = b.dataset.psel; this.syncList(); v.draw(); } });
    const op = R.querySelector('.wz-open');
    op.addEventListener('click', (e) => {
      const tool = e.target.closest('[data-otool]'); if (tool) { this.openTool = this.openTool === tool.dataset.otool ? null : tool.dataset.otool; s.selOpen = null; this.render(); if (this.openTool) this.msg(t('assistant.wizard.openingToolHint', { type: openingLabels()[this.openTool] })); return; }
      if (e.target.closest('[data-odel]')) { res.openings.splice(s.selOpen, 1); s.selOpen = null; return this.render(); }
      const b = e.target.closest('[data-psel]'); if (b) { s.sel = b.dataset.psel; this.syncList(); v.draw(); }
    });
    op.querySelector('[data-otype]')?.addEventListener('change', (e) => { res.openings[s.selOpen].type = e.target.value; this.render(); });
    op.querySelector('[data-owidth]')?.addEventListener('change', (e) => { const o = res.openings[s.selOpen], w = Math.max(0.3, +e.target.value), c = [(o.from[0] + o.to[0]) / 2, (o.from[1] + o.to[1]) / 2], dx = o.to[0] - o.from[0], dz = o.to[1] - o.from[1], L0 = Math.hypot(dx, dz) || 1;
      o.from = [r3(c[0] - dx / L0 * w / 2), r3(c[1] - dz / L0 * w / 2)]; o.to = [r3(c[0] + dx / L0 * w / 2), r3(c[1] + dz / L0 * w / 2)]; this.render(); });
    R.querySelector('[data-act="addRect"]').onclick = () => { this.adding = true; v.c.style.cursor = 'crosshair'; this.msg(t('assistant.wizard.drawRectangle')); };
    R.querySelector('#wzHints2').oninput = (e) => (s.hints = e.target.value);
    R.querySelector('[data-act="redetect"]').onclick = () => this.detect({ keepLocked: true });
    R.querySelectorAll('[name="wzMode"]').forEach((x) => (x.onchange = () => (s.mode = x.value)));
    for (const [sel, key] of [['#wzLvH', 'lvH'], ['#wzLvSlab', 'lvSlab']]) R.querySelector(sel)?.addEventListener('input', (e) => { const v = parseFloat(e.target.value); s[key] = Number.isFinite(v) ? v : undefined; this.updateHeights(); });
    R.querySelector('#wzKeep').onchange = (e) => (s.keepUnderlay = e.target.checked);
    R.querySelector('#wzMap').onchange = (e) => (s.mapAreas = e.target.checked);
    this._v4 = v;
  }
  openingsHtml() {
    const s = this.st, R = s.result; const cnt = (t) => R.openings.filter((o) => o.type === t).length; const noDoor = roomsWithoutDoor(R);
    const o = R.openings[s.selOpen]; const w = o ? Math.hypot(o.to[0] - o.from[0], o.to[1] - o.from[1]) : 0;
    const labels = openingLabels();
    return `<div class="wz-open"><div class="lbl">${t('assistant.wizard.doorsAndWindows')}</div>
      <p class="hint">${t('assistant.wizard.openingsSummary', { doors: cnt('door'), windows: cnt('window'), garages: cnt('garage') ? t('assistant.wizard.garageCountSuffix', { count: cnt('garage') }) : '', passages: cnt('open') ? t('assistant.wizard.passageCountSuffix', { count: cnt('open') }) : '' })}</p>
      <div class="actions">${['door', 'window', 'garage', 'open'].map((type) => `<button class="btn small" data-otool="${type}" aria-pressed="${this.openTool === type}"><i class="sw" style="background:${OPEN_COL[type]}"></i>${labels[type]}</button>`).join('')}</div>
      ${noDoor.length ? `<div class="wz-probs">${noDoor.map((r) => `<button class="warn" data-psel="${r.id}">${t('assistant.wizard.roomHasNoDoor', { name: esc(r.name) })}</button>`).join('')}</div>` : ''}
      ${o ? `<div class="wz-osel"><select data-otype aria-label="${t('assistant.common.type')}">${Object.entries(labels).map(([key, value]) => `<option value="${key}" ${o.type === key ? 'selected' : ''}>${value}</option>`).join('')}</select><input type="number" data-owidth step="0.05" min="0.3" value="${w.toFixed(2)}" aria-label="${t('assistant.wizard.widthMeters')}"><span>m</span><button class="ibtn" data-odel title="${t('assistant.wizard.deleteOpening')}">${icon('x')}</button></div>` : ''}</div>`;
  }
  syncList() { this.root.querySelectorAll('.wz-rooms li').forEach((li) => li.classList.toggle('sel', li.dataset.rid === this.st.sel)); this.root.querySelector(`.wz-rooms li[data-rid="${this.st.sel}"]`)?.scrollIntoView({ block: 'nearest' }); }

  // Height of the new storey: plan values when plausible, otherwise defaults the user can correct.
  levelFit() {
    const s = this.st, li = s.result?.level || {};
    const fit = fitNewLevel(this.app.plan, { elevation: li.floor_elevation_m, height: s.lvH ?? li.room_height_m, slab: s.lvSlab ?? li.slab_thickness_m });
    if (s.lvH !== undefined && fit.source.height === 'plan') fit.source.height = 'manual';
    if (s.lvSlab !== undefined && fit.source.slab === 'plan') fit.source.slab = 'manual';
    return fit;
  }
  heightsHtml() {
    const fit = this.levelFit(), stacked = this.app.plan.levels.length > 0;
    const tag = (k) => `<small class="wz-src ${fit.source[k]}">${t(`assistant.wizard.heightSource.${fit.source[k]}`)}</small>`;
    return `<div class="wz-heights"><div class="lbl">${t('assistant.wizard.heights')}</div>
      <div class="row2"><div class="field"><label for="wzLvH">${t('assistant.wizard.roomHeight')}</label><input type="number" id="wzLvH" step="0.05" min="1.9" max="4.5" value="${fit.height}">${tag('height')}</div>
      ${stacked ? `<div class="field"><label for="wzLvSlab">${t('assistant.wizard.slabThickness')}</label><input type="number" id="wzLvSlab" step="0.01" min="0" max="0.6" value="${fit.slab}">${tag('slab')}</div>` : '<span></span>'}</div>
      <div class="wz-elev">${t('assistant.wizard.floorElevation')} <output id="wzLvElev">${this.elevText(fit)}</output></div>
      <p class="hint" id="wzLvNote">${this.heightsNote(fit)}</p></div>`;
  }
  elevText(fit) { return `${fit.elevation > 0 ? '+' : fit.elevation < 0 ? '−' : '±'}${formatNumber(Math.abs(fit.elevation), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`; }
  heightsNote(fit) {
    const li = this.st.result?.level || {};
    if (fit.mismatch) return t('assistant.wizard.heightsMismatch', { plan: formatNumber(li.floor_elevation_m, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), elevation: this.elevText(fit) });
    if (Object.values(fit.source).includes('default')) return t('assistant.wizard.heightsDefaultHint');
    return t(fit.position === 'below' ? 'assistant.wizard.heightsBelowHint' : 'assistant.wizard.heightsStackHint');
  }
  updateHeights() {
    const fit = this.levelFit(), R = this.root;
    const el = R.querySelector('#wzLvElev'); if (el) el.textContent = this.elevText(fit);
    const note = R.querySelector('#wzLvNote'); if (note) note.textContent = this.heightsNote(fit);
    for (const [sel, k] of [['#wzLvH', 'height'], ['#wzLvSlab', 'slab']]) { const tag = R.querySelector(sel)?.parentElement.querySelector('.wz-src'); if (tag) { tag.className = `wz-src ${fit.source[k]}`; tag.textContent = t(`assistant.wizard.heightSource.${fit.source[k]}`); } }
  }

  /* ---------- apply ---------- */
  async targetLevel() {
    const s = this.st, app = this.app;
    if (s.levelId !== '__new') return s.levelId;
    const id = newId('l'); const li = s.result?.level || {};
    let name = (s.newLevelTouched && s.newLevel) || li.name || s.newLevel || t('assistant.wizard.defaultNewLevel');
    if (app.plan.levels.some((l) => l.name === name)) { let n = 2; while (app.plan.levels.some((l) => l.name === `${name} ${n}`)) n++; name = `${name} ${n}`; }
    // Storeys are stacked without gaps: floor = floor below + its room height + this slab.
    const fit = this.levelFit();
    const op = { op: 'add_level', id, name, elevation: fit.elevation, height: fit.height };
    if (fit.source.slab !== 'default') op.slab = fit.slab;
    if (fit.autoElevation === false) op.autoElevation = false;
    app.apply([op]); s.levelId = id; return id;
  }
  async saveUnderlay(levelId, offset = [0, 0]) {
    const s = this.st, app = this.app; const L = app.plan.levels.find((l) => l.id === levelId); if (!L) return;
    const img = limit(s.img, 3000); const k = s.img.width / img.width;
    const blob = await new Promise((r) => img.toBlob(r, 'image/jpeg', 0.88));
    const resp = await app.hass.fetchWithAuth(`/api/hometwin/underlay/${levelId}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
    if (!resp.ok) throw new Error(t('assistant.wizard.imageSaveFailed', { status: resp.status }));
    L.underlay = { x0: r3(offset[0]), z0: r3(offset[1]), mpp: s.mpp * k, wpx: img.width, hpx: img.height, opacity: 0.5, v: Date.now() };
    const bmp = await createImageBitmap(img); app.editor.images.set(levelId, bmp); app.stage.setUnderlay(levelId, bmp);
  }
  async apply() {
    for (const input of this.root.querySelectorAll('#wzLvH, #wzLvSlab')) {
      if (input.validity.rangeUnderflow || input.validity.rangeOverflow || input.validity.badInput) { input.reportValidity(); return; }
    }
    const s = this.st, app = this.app, res = s.result; this.msg(t('assistant.common.applying'));
    try {
      app.pushUndo();
      const levelId = await this.targetLevel(); const L = app.plan.levels.find((l) => l.id === levelId);
      // keep existing devices in place: when replacing, align the new rooms with the old footprint
      let off = [0, 0];
      const old = L.rooms.filter((r) => r.kind !== 'outdoor' && r.kind !== 'void');
      const nb = bbox(res.rooms.filter((r) => r.kind !== 'outdoor').flatMap((r) => r.points).concat(res.rooms.length ? [] : [[0, 0]]));
      if (old.length) { const ob = bbox(old.flatMap((r) => r.points)); off = [r3(ob.minX - nb.minX), r3(ob.minZ - nb.minZ)]; }
      else { // new storey: line its main building up with the storey below (user can shift it later)
        const below = [...app.plan.levels].filter((l) => l.id !== levelId && l.elevation < L.elevation).pop();
        const bRooms = below?.rooms.filter((r) => r.kind === 'room') || [], nRooms = res.rooms.filter((r) => r.kind === 'room');
        if (bRooms.length && nRooms.length) { const ob = bbox(bRooms.flatMap((r) => r.points)), b2 = bbox(nRooms.flatMap((r) => r.points)); off = [r3(ob.minX - b2.minX), r3(ob.minZ - b2.minZ)]; }
      }
      this.lastOff = off;
      const mv = (p) => [r3(p[0] + off[0]), r3(p[1] + off[1])];
      const ops = [];
      if (s.mode === 'replace' || !old.length) { for (const r of L.rooms.filter((x) => x.kind !== 'void')) ops.push({ op: 'delete_item', item_id: r.id }); for (const o of L.openings) ops.push({ op: 'delete_item', item_id: o.id }); }
      const areas = app.areas(); const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
      const areaFor = (name) => { if (!s.mapAreas) return null; const n = norm(name); const a = areas.find((x) => norm(x.name) === n) || areas.find((x) => n && (norm(x.name).includes(n) || n.includes(norm(x.name)))); return a?.area_id || null; };
      const surface = (r) => (r.kind === 'outdoor' ? (/terras|balkon|terrace|balcony/i.test(r.name) ? 'terrace' : 'lawn') : r.kind === 'garage' ? 'concrete' : /bad|wc|dusche|bath|toilet|küche|kueche|kitchen|hwr|technik|keller|abstell/i.test(r.name) ? 'tile' : 'oak');
      for (const r of res.rooms) ops.push({ op: 'add_room', level_id: levelId, name: r.name || t('assistant.wizard.room'), kind: r.kind, surface: surface(r), area_id: areaFor(r.name), points: r.points.map(mv) });
      // openings: put both ends onto the nearest room edge
      const edges = res.rooms.filter((r) => r.kind !== 'outdoor').flatMap((r) => r.points.map((p, i) => [mv(p), mv(r.points[(i + 1) % r.points.length])]));
      const onEdge = (p) => { let best = null, bd = 0.45; for (const [a, b] of edges) { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1; const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2, 0, 1); const q = [a[0] + dx * t, a[1] + dz * t]; const d = dist(p, q); if (d < bd) { bd = d; best = { q, a, b }; } } return best; };
      for (const o of res.openings) {
        const f = onEdge(mv(o.from)), t = onEdge(mv(o.to)); if (!f || !t) continue; const len = dist(f.q, t.q); if (len < 0.4 || len > 6) continue;
        const op = { op: 'add_opening', level_id: levelId, type: o.type, from: f.q.map(r3), to: t.q.map(r3) };
        if (o.type === 'window') Object.assign(op, { sill: 0.9, head: 2.2 });
        ops.push(op);
      }
      for (const st of res.stairs) { // the stairs model rises towards its local -z
        const b = bbox(st.points.map(mv)); let rot = b.d >= b.w ? 0 : 90, width = Math.min(b.w, b.d), depth = Math.max(b.w, b.d);
        if (st.up_from && st.up_to) { const a = mv(st.up_from), c = mv(st.up_to), dx = c[0] - a[0], dz = c[1] - a[1]; rot = Math.round((Math.atan2(-dx, -dz) * 180) / Math.PI); const run = Math.hypot(dx, dz); if (run > 1) depth = Math.max(run, Math.abs(dx) > Math.abs(dz) ? b.w : b.d); width = st.width || (Math.abs(dx) > Math.abs(dz) ? b.d : b.w); }
        ops.push({ op: 'place_furniture', level_id: levelId, type: 'stairs', pos: [r3(b.cx), r3(b.cz)], rot, width: r3(width), depth: r3(depth) });
      }
      const out = app.apply(ops, { undo: false }); const bad = out.filter((x) => !x.ok);
      if (s.keepUnderlay) await this.saveUnderlay(levelId, off); else delete L.underlay;
      app.markDirty(); app.setLevel(levelId); app.editor?.renderLeft?.(); this.pendingRise = levelId;
      const nRooms = res.rooms.length;
      this.root.querySelector('.wz-body').innerHTML = `<div class="wz-center"><h3>${icon('sparkle')} ${t('assistant.wizard.roomsApplied', { count: nRooms })}</h3>
        ${bad.length ? `<p class="warn">${t('assistant.wizard.elementsFailed', { count: bad.length })}</p>` : ''}
        <p>${t('assistant.wizard.importCreated')}</p>
        <div class="wz-tip">${icon('eye')}<div>${t('assistant.wizard.reviewImportTip')}<div class="actions" style="margin-top:6px"><button class="btn small" data-act="review">${t('assistant.wizard.reviewTopView')}</button></div></div></div>
        <p><strong>${t('assistant.wizard.nextSteps')}</strong></p>
        <div class="actions"><button class="btn primary" data-act="nextLevel">${icon('plus')}${t('assistant.wizard.addAnotherLevel')}</button><button class="btn" data-act="roof">${icon('roof')}${t('assistant.wizard.configureRoof')}</button>${this.ai?.configured ? `<button class="btn" data-act="devices">${t('assistant.wizard.assignDevices')}</button>` : ''}<button class="btn" data-act="done">${t('assistant.common.done')}</button></div></div>`;
      this.root.querySelector('.wz-foot').innerHTML = '';
      this.root.querySelector('[data-act="done"]').onclick = () => { this.close(); app.stage.frame(levelId); };
      this.root.querySelector('[data-act="review"]').onclick = () => { this.close(); app.setMode('edit'); app.setLevel(levelId); app.editor?.setView2d(true); const st = app.plan.levels.find((l) => l.id === levelId)?.furniture.find((f) => f.type === 'stairs'); if (st) app.editor?.select({ type: 'furniture', id: st.id, level: levelId }); app.toast(t('assistant.wizard.reviewToolsToast')); };
      this.root.querySelector('[data-act="nextLevel"]').onclick = () => { const i = app.plan.levels.findIndex((l) => l.id === levelId); const nxt = app.plan.levels[i + 1]; this.open({ levelId: nxt ? nxt.id : '__new' }); };
      this.root.querySelector('[data-act="roof"]').onclick = () => this.roofStep(levelId);
      this.root.querySelector('[data-act="devices"]')?.addEventListener('click', () => { this.close(); app.setMode('edit'); app.agent.open(t('assistant.wizard.assignDevicesPrompt', { name: L.name })); });
    } catch (e) { console.error(e); this.msg(t('assistant.wizard.applyFailed', { error: e.message || e }), true); }
  }

  /* ---------- roof ---------- */
  roofStep() {
    const app = this.app, site = app.plan.site, hint = this.st.result?.roof || {};
    const top = [...app.plan.levels].reverse().find((l) => l.rooms.some((r) => r.kind === 'room' || r.kind === 'garage'));
    const r = { type: hint.type || (site.roof.type === 'none' ? 'gable' : site.roof.type), pitch: hint.pitch ?? site.roof.pitch ?? 35, overhang: site.roof.overhang ?? 0.5, ridge: hint.ridge || 'auto', mainOnly: true };
    const extras = app.plan.levels.flatMap((l) => l.rooms.filter((x) => x.kind === 'garage' || (x.kind === 'outdoor' && /carport|überdach|vordach/i.test(x.name || ''))).map((x) => ({ ...x, levelId: l.id })))
      .filter((x) => !(site.roofs || []).some((q) => q.rect && q.levelId === x.levelId && pointInPolygon([q.rect.cx, q.rect.cz], x.points)));
    const types = { none: t('assistant.wizard.roof.none'), flat: t('assistant.wizard.roof.flat'), shed: t('assistant.wizard.roof.shed'), gable: t('assistant.wizard.roof.gable'), hip: t('assistant.wizard.roof.hip'), pyramid: t('assistant.wizard.roof.pyramid') };
    const body = this.root.querySelector('.wz-body');
    const draw = () => {
      body.innerHTML = `<div class="wz-center wz-roof"><h3>${icon('roof')} ${t('assistant.wizard.roofOverLevel', { name: esc(top?.name || t('assistant.wizard.topLevel')) })}</h3>
        ${hint.type ? `<p class="ok">${t('assistant.wizard.roofReadFromPlan', { type: esc(types[hint.type] || hint.type), pitch: hint.pitch ? `, ${hint.pitch}°` : '', ridge: hint.ridge ? t('assistant.wizard.roofRidgeSuffix', { direction: t(hint.ridge === 'x' ? 'assistant.wizard.horizontal' : 'assistant.wizard.vertical') }) : '' })}</p>` : `<p class="hint">${t('assistant.wizard.noRoofInPlan')}</p>`}
        <div class="field"><label for="wzRType">${t('assistant.wizard.roofShape')}</label><select id="wzRType">${Object.entries(types).map(([k, v]) => `<option value="${k}" ${r.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${!['none', 'flat'].includes(r.type) ? `<div class="row2"><div class="field"><label for="wzRPitch">${t('assistant.wizard.roofPitch')}</label><input id="wzRPitch" type="number" min="3" max="60" value="${r.pitch}"></div><div class="field"><label for="wzROh">${t('assistant.wizard.roofOverhang')}</label><input id="wzROh" type="number" step="0.05" min="0" max="1.5" value="${r.overhang}"></div></div>
        <div class="field"><label for="wzRRidge">${t('assistant.wizard.ridgeDirection')}</label><select id="wzRRidge"><option value="auto" ${r.ridge === 'auto' ? 'selected' : ''}>${t('assistant.wizard.ridgeAuto')}</option><option value="x" ${r.ridge === 'x' ? 'selected' : ''}>${t('assistant.wizard.ridgeHorizontal')}</option><option value="z" ${r.ridge === 'z' ? 'selected' : ''}>${t('assistant.wizard.ridgeVertical')}</option></select></div>` : ''}
        <label class="chk"><input type="checkbox" id="wzRMain" ${r.mainOnly ? 'checked' : ''}> ${t('assistant.wizard.mainHouseOnly', { extras: extras.length ? t('assistant.wizard.extraFlatRoofs', { names: esc(extras.map((x) => x.name).join(', ')), carport: extras.some((x) => x.kind === 'outdoor') ? t('assistant.wizard.carportPosts') : '' }) : '' })}</label>
        <p class="hint">${t('assistant.wizard.moreRoofsHint')}</p>
        <div class="actions"><button class="btn" data-act="roofBack">${t('assistant.common.back')}</button><button class="btn primary" data-act="roofApply">${t('assistant.wizard.applyRoof')}</button></div></div>`;
      body.querySelector('#wzRType').onchange = (e) => { r.type = e.target.value; draw(); };
      body.querySelector('#wzRPitch')?.addEventListener('input', (e) => (r.pitch = +e.target.value));
      body.querySelector('#wzROh')?.addEventListener('input', (e) => (r.overhang = +e.target.value));
      body.querySelector('#wzRRidge')?.addEventListener('change', (e) => (r.ridge = e.target.value));
      body.querySelector('#wzRMain').onchange = (e) => (r.mainOnly = e.target.checked);
      body.querySelector('[data-act="roofBack"]').onclick = () => { this.close(); };
      body.querySelector('[data-act="roofApply"]').onclick = () => {
        app.pushUndo(); const roof = site.roof; roof.type = r.type; if (!['none', 'flat'].includes(r.type)) { roof.pitch = r.pitch; roof.overhang = r.overhang; roof.overhangGable = r.overhang; }
        if (r.type === 'flat') roof.cover = 'kies';
        const rooms = (top?.rooms || []).filter((x) => x.kind === 'room' || (!r.mainOnly && x.kind === 'garage'));
        const outline = rooms.flatMap((x) => x.points); // from the living rooms – the model's outline often includes garage/carport
        if (outline.length >= 3) { const b = bbox(outline); const alongX = r.ridge === 'auto' ? b.w >= b.d : r.ridge === 'x'; roof.rect = { cx: r3(b.cx), cz: r3(b.cz), length: r3(alongX ? b.w : b.d), width: r3(alongX ? b.d : b.w), rot: alongX ? 0 : 90 }; }
        roof.garageFlat = r.mainOnly;
        if (r.mainOnly) for (const x of extras) { const L = app.plan.levels.find((l) => l.id === x.levelId); const carport = x.kind === 'outdoor'; const xr = newExtraRoof(app.plan, { levelId: x.levelId, rect: rectOfPoints(x.points), name: t('assistant.wizard.extraRoofName', { name: x.name }), type: 'flat', posts: carport, height: carport ? 2.3 : L?.height });
          if (!carport) { xr.rect.length = r3(xr.rect.length + 0.24); xr.rect.width = r3(xr.rect.width + 0.24); } (site.roofs ||= []).push(xr); }
        app.stage.layout(); app.markDirty(); app.setLevel('all'); this.close(); app.toast(t('assistant.wizard.roofAppliedToast'));
      };
    };
    draw(); this.root.querySelector('.wz-foot').innerHTML = '';
  }

  /* ---------- shared ---------- */
  mkView() {
    const R = this.root; const v = new PlanView(R.querySelector('#wzCv'), R.querySelector('#wzWrap')); this.view = v;
    R.querySelector('.wz-zoom')?.addEventListener('click', (e) => { const z = e.target.closest('[data-z]')?.dataset.z; if (z === 'in') v.zoom(1.4); if (z === 'out') v.zoom(1 / 1.4); if (z === 'fit') v.fit(); });
    return v;
  }
}
