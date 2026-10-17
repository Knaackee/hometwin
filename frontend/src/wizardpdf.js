// Floor-plan wizard: geometry of the image pipeline (source → rotation → crop) and the use of
// vector PDF data (text labels, line segments) for exact scale, region proposal and model context.
// Pure functions where possible; no assumptions about country, units or sheet layout.
import { mergeTextItems, estimateScale, classifyLabel, resolveReadings, labelCentre } from './dimtext.js';

const PT_M = 0.0254 / 72; // one PDF point in metres on paper

// Point in the source canvas → point in the canvas rotated by deg around its centre (as rotateCanvas does).
export function rotFrame(srcW, srcH, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const w = Math.round(srcW * Math.abs(c) + srcH * Math.abs(s)), h = Math.round(srcW * Math.abs(s) + srcH * Math.abs(c));
  const fwd = ([x, y]) => { const dx = x - srcW / 2, dy = y - srcH / 2; return [c * dx - s * dy + w / 2, s * dx + c * dy + h / 2]; };
  const inv = ([x, y]) => { const dx = x - w / 2, dy = y - h / 2; return [c * dx + s * dy + srcW / 2, -s * dx + c * dy + srcH / 2]; };
  return { w, h, fwd, inv, a };
}

const isRectQ = (q) => Math.abs(q[0][1] - q[1][1]) < 1 && Math.abs(q[2][1] - q[3][1]) < 1 && Math.abs(q[0][0] - q[3][0]) < 1 && Math.abs(q[1][0] - q[2][0]) < 1;
function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) { const den = dx1 * dy2 - dx2 * dy1; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}
// Rotated-canvas point → output image point for the crop quad (rect: offset; else inverse homography to ow×oh).
export function quadMap(q, ow, oh) {
  if (isRectQ(q)) { const x = Math.min(q[0][0], q[3][0]), y = Math.min(q[0][1], q[1][1]); return ([px, py]) => [px - x, py - y]; }
  const [a, b, c, d, e, f, g, h] = squareToQuad(q);
  // inverse of [[a b c][d e f][g h 1]]
  const A = e - f * h, B = c * h - b, C = b * f - c * e, D = f * g - d, E = a - c * g, F = c * d - a * f, G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  return ([x, y]) => { const w = G * x + H * y + I; return [((A * x + B * y + C) / w) * ow, ((D * x + E * y + F) / w) * oh]; };
}

// Region of the rotated canvas that covers the quad, as a rectangle in source pixels (for re-rendering a PDF).
export function quadSourceRect(q, rf) {
  const pts = q.map(rf.inv); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

// Re-renders a rectangular crop of a vector PDF page sharply at outMax px (instead of cropping the
// already rasterised page). Returns { canvas, k } with k = output px per rotated-canvas px, or null.
export async function renderCrop(pdf, pageIndex, unitsPerSrcPx, rf, q, outMax = 3200) {
  if (!isRectQ(q)) return null;
  const x = Math.min(q[0][0], q[3][0]), y = Math.min(q[0][1], q[1][1]), w = Math.max(q[1][0], q[2][0]) - x, h = Math.max(q[2][1], q[3][1]) - y;
  const k = Math.min(outMax / Math.max(w, h), 6);
  if (k < 1.15) return null; // not worth it
  const sr = quadSourceRect(q, rf), pad = 4;
  const r = { x: (sr.x - pad) * unitsPerSrcPx, y: (sr.y - pad) * unitsPerSrcPx, w: (sr.w + 2 * pad) * unitsPerSrcPx, h: (sr.h + 2 * pad) * unitsPerSrcPx };
  const pxPerUnit = k / unitsPerSrcPx; // wanted output px per page unit
  const { canvas: reg, scale } = await pdf.region(pageIndex, r, Math.max(r.w, r.h) * pxPerUnit);
  const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(w * k)); out.height = Math.max(1, Math.round(h * k));
  const g = out.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
  // region px → units → source px → rotated px → output px
  const s = 1 / scale / unitsPerSrcPx, c = Math.cos(rf.a), sn = Math.sin(rf.a);
  const ox = r.x / unitsPerSrcPx, oy = r.y / unitsPerSrcPx; // source px of region origin
  // rotated = R·(src − srcC) + rotC ; src = reg·s + o
  const p0 = rf.fwd([ox, oy]);
  g.setTransform(k * c * s, k * sn * s, -k * sn * s, k * c * s, k * (p0[0] - x), k * (p0[1] - y));
  g.drawImage(reg, 0, 0);
  return { canvas: out, k };
}

// Analysed page (units) → helpers in output-image pixels.
export function pageModel(page, unitsPerSrcPx, rf, q, k, ow, oh) {
  const qm = quadMap(q, ow / k, oh / k);
  const toImg = ([ux, uy]) => { const r = rf.fwd([ux / unitsPerSrcPx, uy / unitsPerSrcPx]); const p = qm(r); return [p[0] * k, p[1] * k]; };
  const pxPerUnit = (() => { const a = toImg([0, 0]), b = toImg([100, 0]), c = toImg([0, 100]); return (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - a[0], c[1] - a[1])) / 200; })();
  const items = mergeTextItems(page.items).map((it) => {
    const p = toImg([it.x, it.y]); const a = (it.angle * Math.PI) / 180; const e = toImg([it.x + Math.cos(a) * it.w, it.y + Math.sin(a) * it.w]);
    return { ...it, x: p[0], y: p[1], w: Math.hypot(e[0] - p[0], e[1] - p[1]), h: it.h * pxPerUnit, angle: Math.round((Math.atan2(e[1] - p[1], e[0] - p[0]) * 1800) / Math.PI) / 10 };
  });
  const inside = ([x, y]) => x >= -2 && y >= -2 && x <= ow + 2 && y <= oh + 2;
  const segments = [];
  for (const s of page.segments) { const a = toImg([s.x1, s.y1]), b = toImg([s.x2, s.y2]); if (inside(a) || inside(b)) segments.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] }); }
  return { items: items.filter((it) => inside([it.x, it.y])), segments, pxPerUnit };
}

// Scale of the output image in metres per pixel: printed scale text, checked against drawn dimensions.
// Returns { mpp, source: 'pdf-verified' | 'pdf-dimensions' | 'pdf-printed', ratio?, support? } or null.
export function pdfScale(model, allItems) {
  const est = estimateScale(model.items, model.segments);
  const printed = [...new Set(allItems.map((it) => classifyLabel(it)).filter((c) => c.kind === 'scale').map((c) => c.ratio))];
  const fromPrinted = printed.map((ratio) => ({ ratio, mpp: (PT_M * ratio) / model.pxPerUnit }));
  if (est) {
    const mpp = est.mPerUnit;
    // a printed scale that agrees with one of the well-supported candidates decides (also between cm and mm readings)
    for (const c of [est, ...(est.candidates || [])]) {
      const match = fromPrinted.find((p) => Math.abs(p.mpp / c.mPerUnit - 1) < 0.02);
      if (match && c.support >= Math.min(est.support, 3)) return { mpp: match.mpp, source: 'pdf-verified', ratio: match.ratio, support: c.support };
    }
    if (est.support >= 5) return { mpp, source: 'pdf-dimensions', support: est.support, printed: fromPrinted.map((p) => p.ratio) };
  }
  if (fromPrinted.length === 1) return { mpp: fromPrinted[0].mpp, source: 'pdf-printed', ratio: fromPrinted[0].ratio };
  return null;
}

const SUP = ['\u2070', '\u00b9', '\u00b2', '\u00b3', '\u2074', '\u2075', '\u2076', '\u2077', '\u2078', '\u2079'];
export const labelText = (it) => {
  if (!it.stacked) return it.str + (it.sup ? SUP[it.sup] : '');
  const [a, b] = it.str.split('/'); return `${a}${it.sup ? SUP[it.sup] : ''}/${b}${it.sup2 ? SUP[it.sup2] : ''}`;
};
const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

// Compact label table for the model, in model-image pixels (k = image px per model px).
export function labelsForModel(model, mpp, k, max = 400) {
  const resolved = mpp ? resolveReadings(model.items, model.segments, mpp) : model.items.map((it) => ({ ...it, label: classifyLabel(it) }));
  const rows = [];
  for (const it of resolved) {
    const c = it.label; if (c.kind === 'unknown' || c.kind === 'scale') continue;
    const [cx, cy] = labelCentre(it);
    let interp = '';
    if (c.kind === 'length') interp = it.reading ? `length ${fmt(it.reading.m)} m` : `length ${c.readings.map((r) => `${fmt(r.m)} m`).join(' or ')}`;
    else if (c.kind === 'pair') interp = `opening ${c.w.map((r) => fmt(r.m)).join('|')} x ${c.h.map((r) => fmt(r.m)).join('|')} m (width x height)`;
    else if (c.kind === 'area') interp = `area ${fmt(c.m2)} m2`;
    else if (c.kind === 'level') interp = `level ${c.m >= 0 ? '+' : ''}${fmt(c.m)} m`;
    else if (c.kind === 'sill') interp = `sill ${c.readings.map((r) => fmt(r.m)).join(' or ')} m`;
    else interp = 'name';
    const row = { id: `t${rows.length + 1}`, text: labelText(it).slice(0, 40), x: Math.round(cx / k), y: Math.round(cy / k), angle: Math.round(it.angle), interp, kind: c.kind };
    // numbers the backend may use directly: printed opening size (first reading in a sensible range)
    const pick = (rs, lo, hi) => rs.find((r) => r.m >= lo && r.m <= hi)?.m;
    if (c.kind === 'pair') { row.w = pick(c.w, 0.3, 6); row.h = pick(c.h, 0.3, 3.2); }
    if (c.kind === 'length') { const m = it.reading?.m ?? (c.readings.length === 1 ? c.readings[0].m : undefined); if (m != null) row.m = m; if (m != null && m >= 0.4 && m <= 3) row.w = m; }
    rows.push(row);
    if (rows.length >= max) break;
  }
  return rows;
}

// Expands an AI-proposed box (rotated-canvas px) so that dimension labels just outside it are included,
// then adds a small margin. Labels further away than 25 % of the box size are ignored.
export function snapRegion(box, items, W, H) {
  let [x0, y0, x1, y1] = box; const bw = x1 - x0, bh = y1 - y0, mx = bw * 0.25, my = bh * 0.25;
  for (const it of items) {
    const c = classifyLabel(it); if (c.kind !== 'length' && c.kind !== 'pair') continue;
    const [cx, cy] = labelCentre(it);
    if (cx < box[0] - mx || cx > box[2] + mx || cy < box[1] - my || cy > box[3] + my) continue;
    x0 = Math.min(x0, cx - it.h); y0 = Math.min(y0, cy - it.h); x1 = Math.max(x1, cx + it.h); y1 = Math.max(y1, cy + it.h);
  }
  const m = 0.03 * Math.max(x1 - x0, y1 - y0);
  return [Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(W, x1 + m), Math.min(H, y1 + m)];
}
