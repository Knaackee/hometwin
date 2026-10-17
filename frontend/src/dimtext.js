// Plan text understanding without assumptions about country or drawing style.
// - parseLength: all plausible readings of a printed length (m, cm, mm, ft-in)
// - classifyLabel: what a printed text is (length, width/height pair, area, level mark, scale, name)
// - mergeTextItems: joins raised half-unit digits and stacked width/height labels
// - estimateScale: metres per drawing unit by voting printed lengths against drawn lines
// The caller decides between readings by consistency (one scale for all labels), never by country.

const NUM = /^[+-]?\d{1,3}(?:[.,\s']\d{3})*(?:[.,]\d+)?$|^[+-]?\d+(?:[.,]\d+)?$/;
const INCH = 0.0254, FOOT = 0.3048;

const num = (s) => {
  // "3,40" "3.40" "1.250,5" "1,250.5" "3 400" → number; the last separator followed by 1–2 or ≥4 digits is the decimal mark
  const t = s.replace(/\s/g, '');
  const lastSep = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  if (lastSep < 0) return +t;
  const int = t.slice(0, lastSep).replace(/[.,']/g, ''), dec = t.slice(lastSep + 1);
  return +`${int}.${dec}`;
};

// Imperial: 12'-6", 12' 6", 12'6, 2'-10 1/2", 10', 8", 6 1/2"
function imperial(str) {
  const s = str.replace(/[\u2019\u2032]/g, "'").replace(/[\u201d\u2033]/g, '"').replace(/''/g, '"').trim();
  const m = s.match(/^(?:(\d+)\s*')?\s*-?\s*(?:(\d+)(?:\s+(\d+)\/(\d+))?\s*(?:"|$))?$/);
  if (!m || (!m[1] && !m[2]) || (!s.includes("'") && !s.includes('"'))) return null;
  const ft = +(m[1] || 0), inch = +(m[2] || 0) + (m[3] ? +m[3] / +m[4] : 0);
  if (inch >= 12 && m[1]) return null;
  return ft * FOOT + inch * INCH;
}

// All plausible metric/imperial readings of one printed length. `sup` = raised digit (e.g. "5" in 3,31⁵).
export function parseLength(raw, sup = null) {
  const str = String(raw ?? '').trim().replace(/\u00a0/g, ' ');
  if (!str) return [];
  const imp = imperial(str);
  if (imp != null) return [{ m: imp, unit: 'ft-in' }];
  const clean = str.replace(/\s*(m|cm|mm)$/i, '');
  const unitHint = (str.match(/(mm|cm|m)$/i) || [])[1]?.toLowerCase();
  if (!NUM.test(clean)) return [];
  let v = num(clean);
  if (!Number.isFinite(v) || v <= 0) return [];
  const decimals = (clean.match(/[.,](\d+)$/) || [])[1]?.length || 0;
  const hasSep = /[.,]/.test(clean);
  const out = [];
  const add = (m, unit) => { if (m > 0.005 && m < 500 && !out.some((o) => Math.abs(o.m - m) < 1e-9)) out.push({ m: Math.round(m * 1e6) / 1e6, unit }); };
  // a raised digit adds a fraction of the last printed digit: 3,31⁵ → 3,315 ; 17⁵ → 17,5
  if (sup != null && /^\d$/.test(String(sup))) {
    const step = decimals ? 10 ** -decimals : 1;
    v += (+sup / 10) * step;
  }
  if (unitHint) { add(v * { m: 1, cm: 0.01, mm: 0.001 }[unitHint], unitHint); return out; }
  // Readings in a sensible order; the consistency check picks one.
  if (hasSep && decimals <= 3) add(v, 'm');                  // 3,40  2,765  1,625
  if (!hasSep || decimals <= 1) add(v / 100, 'cm');          // 49  87,5  115 (=1,15 m)
  if (!hasSep && v >= 10) add(v / 1000, 'mm');               // 3400
  if (!hasSep && /^\d{3}$/.test(clean) && clean.endsWith('5')) add(+clean.slice(0, 2) / 100 + 0.005, 'cm+half'); // 175 → 0,175 ; 115 → 0,115
  if (hasSep && decimals === 3 && clean.endsWith('5')) add(v, 'm+half');                                          // 3,315 (merged 3,31⁵)
  return out;
}

const AREA = /^(?:[\p{L}.\s]*:?\s*)?(\d+(?:[.,]\d+)?)\s*(m2|m\u00b2|qm|sq\.?\s*ft|ft2|ft\u00b2|sf)(?![\p{L}\d])/iu;
const LEVEL = /^(?:okff|okrf|ffl|fl|el\.?|level|niveau|kote)?\s*([\u00b1+-])\s?(\d+(?:[.,]\d+)?)\s*(m)?$/i;
const SCALE = /(?:^|[^\d])1\s*:\s*(\d{1,4})(?![\d.,])/;
const SCALE_IMP = /(\d+(?:\/\d+)?)\s*"\s*=\s*(\d+)\s*'\s*(?:-?\s*0\s*")?/;
const SILL = /^(brh|br|sh|sill|all\u00e8ge|bh|bru|aff)\.?\s*[:=]?\s*(.+)$/i;

export function parseScaleText(str) {
  const s = String(str).replace(/[\u201d\u2033]/g, '"').replace(/[\u2019\u2032]/g, "'");
  const m = s.match(SCALE);
  if (m && +m[1] >= 1 && +m[1] <= 5000) return { ratio: +m[1] };
  const i = s.match(SCALE_IMP);
  if (i) { const [a, b] = i[1].split('/').map(Number); const inch = b ? a / b : a; if (inch > 0) return { ratio: (+i[2] * 12) / inch }; }
  return null;
}

// What kind of text is this? Returns { kind, ... } with parsed values.
export function classifyLabel(item) {
  const str = String(item.str || '').trim();
  if (!str) return { kind: 'unknown' };
  const sc = parseScaleText(str);
  if (sc && /:|"|=/.test(str)) return { kind: 'scale', ...sc };
  const area = str.match(AREA);
  if (area) { const v = num(area[1]); const sqft = /ft|sf/i.test(area[2]); return { kind: 'area', m2: sqft ? v * 0.092903 : v }; }
  const lv = str.replace(/\s/g, ' ').match(LEVEL);
  if (lv && /[\u00b1+-]/.test(str)) return { kind: 'level', m: (lv[1] === '-' ? -1 : 1) * num(lv[2]) };
  const sill = str.match(SILL);
  if (sill) { const r = parseLength(sill[2]); if (r.length) return { kind: 'sill', readings: r }; }
  const pair = str.split(/\s*(?:\/|x|\u00d7)\s*/i);
  if (pair.length === 2 && pair[0] && pair[1]) {
    const w = parseLength(pair[0], item.sup), h = parseLength(pair[1], item.sup2);
    if (w.length && h.length) return { kind: 'pair', w, h };
  }
  const readings = parseLength(str, item.sup);
  if (readings.length) return { kind: 'length', readings };
  if (/\p{L}/u.test(str)) return { kind: 'name' };
  return { kind: 'unknown' };
}

const centre = (it) => [it.x + (it.w / 2) * Math.cos(it.angle * Math.PI / 180), it.y + (it.w / 2) * Math.sin(it.angle * Math.PI / 180)];

// items: [{ str, x, y, w, h, angle }] in one coordinate system (x right, y down; x/y = start of the baseline).
// Joins raised small digits to their number and stacked numeric pairs into "a/b". Returns new items.
export function mergeTextItems(items) {
  const list = items.map((it) => ({ ...it, str: String(it.str).trim() })).filter((it) => it.str);
  const used = new Set();
  // raised digit: smaller font, right after the end of a number along the reading direction
  for (const sup of list) {
    if (!/^\d$/.test(sup.str)) continue;
    let best = null, bd = Infinity;
    for (const base of list) {
      if (base === sup || used.has(base) || !/\d$/.test(base.str) || !(sup.h < base.h * 0.8) || Math.abs(sup.angle - base.angle) > 2) continue;
      const a = base.angle * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), nx = Math.sin(a), ny = -Math.cos(a); // n = "up" of the text
      const ex = base.x + ux * base.w, ey = base.y + uy * base.w; // end of the base text
      const along = (sup.x - ex) * ux + (sup.y - ey) * uy, up = (sup.x - base.x) * nx + (sup.y - base.y) * ny;
      if (along > -base.h * 0.4 && along < base.h * 0.6 && up > base.h * 0.15 && up < base.h * 1.1) { const d = Math.abs(along) + Math.abs(up - base.h * 0.5); if (d < bd) { bd = d; best = base; } }
    }
    if (best) { best.sup = sup.str; best.w += sup.w; used.add(sup); }
  }
  const rest = list.filter((it) => !used.has(it));
  // stacked pair: two numbers, same direction, centres on one line perpendicular to the text, 0.8–2.6 font heights apart
  const out = [], paired = new Set();
  for (const a of rest) {
    if (paired.has(a) || classifyLabel(a).kind !== 'length') continue;
    const ang = a.angle * Math.PI / 180, ux = Math.cos(ang), uy = Math.sin(ang), nx = Math.sin(ang), ny = -Math.cos(ang);
    const ca = centre(a); let best = null, bd = Infinity;
    for (const b of rest) {
      if (b === a || paired.has(b) || Math.abs(b.angle - a.angle) > 2 || classifyLabel(b).kind !== 'length' || Math.abs(b.h - a.h) > a.h * 0.25) continue;
      const cb = centre(b); const along = (cb[0] - ca[0]) * ux + (cb[1] - ca[1]) * uy, up = (cb[0] - ca[0]) * nx + (cb[1] - ca[1]) * ny;
      if (Math.abs(along) < a.h * 0.9 && up < -a.h * 0.8 && up > -a.h * 2.6 && -up < bd) { bd = -up; best = b; }
    }
    if (best) { paired.add(a); paired.add(best); out.push({ ...a, str: `${a.str}/${best.str}`, sup: a.sup, sup2: best.sup, w: Math.max(a.w, best.w), h: a.h + bd, stacked: true }); }
  }
  for (const it of rest) if (!paired.has(it)) out.push(it);
  return out;
}

// Votes metres-per-unit from printed lengths and drawn straight segments.
// labels: items with classifyLabel kind 'length' (in drawing units); segments: [{ x1, y1, x2, y2 }] same units.
// A label supports a scale if a parallel segment close to it has length × scale equal to one of its readings.
export function estimateScale(items, segments, { tol = 0.006 } = {}) {
  const labels = items.map((it) => ({ it, c: classifyLabel(it) })).filter((l) => l.c.kind === 'length');
  if (labels.length < 3 || !segments.length) return null;
  const segs = segments.map((s) => { const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = Math.hypot(dx, dy); return { ...s, L, ux: dx / L, uy: dy / L, mx: (s.x1 + s.x2) / 2, my: (s.y1 + s.y2) / 2 }; }).filter((s) => s.L > 2);
  const votes = new Map(); // bin → Set(label index)
  const ratios = [];
  labels.forEach(({ it, c }, li) => {
    const a = it.angle * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a); const [cx, cy] = centre(it); const reach = it.h * 4;
    for (const s of segs) {
      if (Math.abs(s.ux * ux + s.uy * uy) < 0.995) continue; // parallel to the text
      const along = (cx - s.x1) * s.ux + (cy - s.y1) * s.uy, perp = Math.abs((cx - s.x1) * -s.uy + (cy - s.y1) * s.ux);
      if (perp > reach || along < -it.h || along > s.L + it.h) continue;
      for (const r of c.readings) { const k = r.m / s.L; const bin = Math.round(Math.log(k) / tol); for (const b of [bin - 1, bin, bin + 1]) { if (!votes.has(b)) votes.set(b, new Set()); votes.get(b).add(li); } ratios.push({ k, li, bin, m: r.m }); }
    }
  });
  // Candidate scales, best first. Equal support happens when a whole plan can be read in two units
  // (all cm or all mm): prefer the reading in which the longest supported label is a plausible building size.
  const cands = [];
  for (const [bin, set] of [...votes].sort((x, y) => y[1].size - x[1].size)) {
    if (set.size < 3) continue;
    const ks = ratios.filter((r) => Math.abs(r.bin - bin) <= 1).map((r) => r.k).sort((x, y) => x - y); const k = ks[Math.floor(ks.length / 2)];
    if (cands.some((c) => Math.abs(Math.log(c.mPerUnit / k)) < tol * 3)) continue;
    const longest = Math.max(...ratios.filter((r) => Math.abs(r.bin - bin) <= 1).map((r) => r.m));
    cands.push({ mPerUnit: k, support: set.size, plausible: longest >= 2 && longest <= 60 });
  }
  if (!cands.length) return null;
  cands.sort((x, y) => y.support - x.support || y.plausible - x.plausible);
  const top = cands[0], alt = cands.find((c) => c !== top && c.support >= top.support * 0.9 && c.plausible && !top.plausible);
  const best = alt || top;
  return { mPerUnit: best.mPerUnit, support: best.support, lengthLabels: labels.length, candidates: cands.slice(0, 4) };
}

export function resolveReadings(items, segments, mPerUnit, tol = 0.02) {
  return items.map((it) => {
    const c = classifyLabel(it); if (c.kind !== 'length' && c.kind !== 'pair') return { ...it, label: c };
    if (c.kind === 'pair') return { ...it, label: c };
    const a = it.angle * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a); const [cx, cy] = centre(it);
    let pick = null;
    for (const s of segments) {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = Math.hypot(dx, dy); if (L < 2) continue;
      if (Math.abs((dx / L) * ux + (dy / L) * uy) < 0.995) continue;
      const along = (cx - s.x1) * dx / L + (cy - s.y1) * dy / L, perp = Math.abs((cx - s.x1) * -dy / L + (cy - s.y1) * dx / L);
      if (perp > it.h * 4 || along < -it.h || along > L + it.h) continue;
      const r = c.readings.find((x) => Math.abs(x.m / (L * mPerUnit) - 1) < tol); if (r) { pick = r; break; }
    }
    return { ...it, label: c, reading: pick };
  });
}

export const labelCentre = centre;
