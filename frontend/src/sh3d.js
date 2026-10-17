// Sweet Home 3D import. A .sh3d file is a ZIP; since SH3D 5.3 it contains Home.xml
// (units: centimetres, y axis = our z, angles in radians clockwise).
import { newId, PLAN_VERSION } from './plan.js';
import { lineOf, projectOnSeg, distToSeg, edges, r3, pointInPolygon } from './geometry.js';
import { t } from './i18n.js';

async function unzipEntry(file, name) {
  const buf = new Uint8Array(await file.arrayBuffer()); const dv = new DataView(buf.buffer);
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(t('assistant.sh3d.invalidArchive'));
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const n = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    if (n === name) {
      const lstart = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true); const data = buf.subarray(lstart, lstart + csize);
      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8) { const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return await new Response(ds).text(); }
      throw new Error(t('assistant.sh3d.unsupportedCompression', { method }));
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

const M = (v) => r3((parseFloat(v) || 0) / 100);
const has = (s, ...words) => words.some((w) => s.includes(w));
function mapFurniture(el, levelHeight) {
  const name = `${el.getAttribute('name') || ''} ${el.getAttribute('catalogId') || ''}`.toLowerCase();
  const w = M(el.getAttribute('width')), d = M(el.getAttribute('depth')), h = M(el.getAttribute('height')), elev = M(el.getAttribute('elevation'));
  const base = { pos: [M(el.getAttribute('x')), M(el.getAttribute('y'))], rot: Math.round((-(parseFloat(el.getAttribute('angle')) || 0) * 180) / Math.PI) };
  const isLight = el.tagName === 'light' || has(name, 'lamp', 'light', 'leuchte', 'lampe', 'spot', 'luminaire');
  if (isLight) return { device: { ...base, kind: 'light', style: elev > 1.7 ? 'ceiling' : h > 1.1 && elev < 0.1 ? 'floor' : elev > 0.9 ? 'wall' : 'table', ...(elev > 0.1 && elev < 1.7 ? { y: elev } : {}) } };
  if (has(name, 'tv', 'television', 'fernseh')) return { device: { ...base, kind: 'tv', y: elev, length: w } };
  if (has(name, 'radiator', 'heizk')) return { device: { ...base, kind: 'radiator', length: w } };
  const T = (type, extra = {}) => ({ furniture: { ...base, type, width: w, depth: d, ...extra } });
  if (has(name, 'stair', 'treppe', 'escalier')) return T('stairs', { height: Math.max(h, levelHeight) });
  if (has(name, 'corner sofa', 'ecksofa', 'l-shaped')) return T('cornerSofa');
  if (has(name, 'sofa', 'couch', 'canap')) return T('sofa');
  if (has(name, 'armchair', 'sessel', 'fauteuil')) return T('armchair');
  if (has(name, 'crib', 'babybett', 'cot')) return T('crib');
  if (has(name, 'bed', 'bett', 'lit ')) return T(w < 1.3 ? 'singleBed' : 'bed');
  if (has(name, 'night', 'nacht', 'bedside', 'chevet')) return T('nightstand');
  if (has(name, 'desk', 'schreibtisch', 'bureau')) return T('desk');
  if (has(name, 'office chair', 'bürostuhl', 'swivel')) return T('officeChair');
  if (has(name, 'stool', 'hocker', 'tabouret')) return T('barStool');
  if (has(name, 'chair', 'stuhl', 'chaise')) return T('chair');
  if (has(name, 'coffee', 'couchtisch', 'low table', 'table basse')) return T('coffeeTable');
  if (has(name, 'round table', 'runder tisch', 'table ronde')) return T('roundTable');
  if (has(name, 'side table', 'beistell')) return T('sideTable');
  if (has(name, 'table', 'tisch')) return T('diningTable', { chairs: 0 });
  if (has(name, 'wardrobe', 'kleiderschrank', 'armoire', 'closet')) return T('wardrobe', { height: h });
  if (has(name, 'book', 'bücher', 'shelf', 'regal', 'étagère')) return T('bookshelf', { height: h });
  if (has(name, 'dresser', 'kommode', 'chest', 'commode')) return T('dresser');
  if (has(name, 'sideboard', 'buffet')) return T('sideboard');
  if (has(name, 'fridge', 'refrigerator', 'kühlschrank', 'réfrigérateur')) return T('fridge');
  if (has(name, 'oven', 'backofen', 'four')) return T('kitchenTall');
  if (has(name, 'kitchen', 'küche', 'cuisine', 'sink', 'spüle', 'cooker', 'dishwasher', 'herd')) return T('kitchen', { upper: false, depth: undefined });
  if (has(name, 'bath', 'badewanne', 'baignoire', 'tub')) return T('bathtub');
  if (has(name, 'shower', 'dusche', 'douche')) return T('shower');
  if (has(name, 'toilet', 'wc', 'toilette')) return T('toilet');
  if (has(name, 'washbasin', 'waschbecken', 'waschtisch', 'lavabo', 'basin')) return T('vanity');
  if (has(name, 'washing', 'waschmaschine', 'lave-linge', 'dryer', 'trockner')) return T('washer');
  if (has(name, 'fireplace', 'kamin', 'cheminée')) return T('fireplace');
  if (has(name, 'piano', 'klavier')) return T('piano');
  if (has(name, 'rug', 'carpet', 'teppich', 'tapis')) return T('rug');
  if (has(name, 'tree', 'baum', 'arbre')) return T('tree', { height: h });
  if (has(name, 'plant', 'pflanze', 'plante', 'flower')) return T('plant', { height: h });
  if (has(name, 'car', 'auto', 'voiture')) return T('car');
  return T('box', { height: h, color: '#a0a6b2' });
}

// Rooms are often drawn on the inner faces of walls, which leaves a gap between neighbours.
// Pull facing parallel edges that are a wall-thickness apart onto their shared midline.
function closeGaps(rooms) {
  const E = [];
  rooms.forEach((r) => edges(r.points).forEach(([a, b], i) => E.push({ r, i, a, b, l: lineOf(a, b) })));
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const A = E[i], B = E[j]; if (A.r === B.r) continue;
    const da = Math.abs(A.l.ang - B.l.ang); if (Math.min(da, Math.PI - da) > 0.02) continue;
    const offA = A.a[0] * A.l.nx + A.a[1] * A.l.nz, offB = B.a[0] * A.l.nx + B.a[1] * A.l.nz, gap = Math.abs(offA - offB);
    if (gap < 0.02 || gap > 0.5) continue;
    const t = (p) => p[0] * A.l.ux + p[1] * A.l.uz; const ia = [t(A.a), t(A.b)].sort((x, y) => x - y), ib = [t(B.a), t(B.b)].sort((x, y) => x - y);
    if (Math.min(ia[1], ib[1]) - Math.max(ia[0], ib[0]) < 0.3) continue;
    const mid = (offA + offB) / 2;
    for (const [X, off] of [[A, offA], [B, offB]]) { const s = mid - off; for (const p of [X.a, X.b]) { p[0] = r3(p[0] + A.l.nx * s); p[1] = r3(p[1] + A.l.nz * s); } }
  }
}
function snapOpening(o, rooms) {
  const c = [(o.from[0] + o.to[0]) / 2, (o.from[1] + o.to[1]) / 2], w = Math.hypot(o.to[0] - o.from[0], o.to[1] - o.from[1]);
  let best = null, bd = 0.6;
  for (const r of rooms) for (const [a, b] of edges(r.points)) { const d = distToSeg(c, a, b); if (d < bd) { bd = d; best = [a, b]; } }
  if (!best) return false;
  const [a, b] = best, { t, len } = projectOnSeg(c, a, b), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len, m = Math.min(len - w / 2, Math.max(w / 2, t * len));
  o.from = [r3(a[0] + ux * (m - w / 2)), r3(a[1] + uz * (m - w / 2))]; o.to = [r3(a[0] + ux * (m + w / 2)), r3(a[1] + uz * (m + w / 2))];
  return true;
}

export async function importSh3d(file, current) {
  const xml = await unzipEntry(file, 'Home.xml');
  if (!xml) throw new Error(t('assistant.sh3d.missingHomeXml'));
  const doc = new DOMParser().parseFromString(xml, 'application/xml'); const home = doc.querySelector('home'); if (!home) throw new Error(t('assistant.sh3d.unreadableHomeXml'));
  const levelEls = [...doc.querySelectorAll('home > level')];
  const levels = new Map(); const wallH = M(home.getAttribute('wallHeight') || 250);
  if (!levelEls.length) levels.set('', { id: newId('l'), name: t('assistant.sh3d.defaultGroundFloor'), floor_id: null, elevation: 0, height: wallH || 2.5, cutHeight: 1.2, rooms: [], openings: [], furniture: [], devices: [] });
  levelEls.forEach((el) => { if (el.getAttribute('viewable') === 'false') return; levels.set(el.getAttribute('id'), { id: newId('l'), name: el.getAttribute('name') || t('assistant.sh3d.defaultLevel'), floor_id: null, elevation: M(el.getAttribute('elevation')), height: M(el.getAttribute('height')) || 2.5, cutHeight: 1.2, rooms: [], openings: [], furniture: [], devices: [] }); });
  const lvlOf = (el) => levels.get(el.getAttribute('level') || '') || [...levels.values()][0];
  const stats = { rooms: 0, openings: 0, furniture: 0, levels: levels.size };
  for (const el of doc.querySelectorAll('room')) {
    const pts = [...el.querySelectorAll('point')].map((p) => [M(p.getAttribute('x')), M(p.getAttribute('y'))]); if (pts.length < 3) continue;
    const name = el.getAttribute('name') || t('assistant.sh3d.defaultRoom', { number: stats.rooms + 1 }); const n = name.toLowerCase();
    const kind = has(n, 'garage', 'carport') ? 'garage' : has(n, 'terras', 'balkon', 'balcon', 'garten', 'garden', 'patio') ? 'outdoor' : 'room';
    lvlOf(el).rooms.push({ id: newId('r'), name, kind, surface: kind === 'outdoor' ? 'terrace' : kind === 'garage' ? 'concrete' : has(n, 'bad', 'bath', 'wc', 'küche', 'kitchen') ? 'tile' : 'oak', area_id: null, points: pts }); stats.rooms++;
  }
  for (const l of levels.values()) closeGaps(l.rooms.filter((r) => r.kind !== 'outdoor'));
  for (const el of doc.querySelectorAll('doorOrWindow')) {
    const L = lvlOf(el); const name = `${el.getAttribute('name') || ''} ${el.getAttribute('catalogId') || ''}`.toLowerCase();
    const x = M(el.getAttribute('x')), y = M(el.getAttribute('y')), w = M(el.getAttribute('width')), a = parseFloat(el.getAttribute('angle')) || 0, elev = M(el.getAttribute('elevation')), h = M(el.getAttribute('height'));
    const type = has(name, 'garage') ? 'garage' : has(name, 'door', 'tür', 'porte') || elev < 0.15 && h > 1.9 && w < 1.3 ? 'door' : 'window';
    const o = { id: newId('o'), type, from: [r3(x - Math.cos(a) * w / 2), r3(y - Math.sin(a) * w / 2)], to: [r3(x + Math.cos(a) * w / 2), r3(y + Math.sin(a) * w / 2)], head: r3(elev + h), ...(type === 'window' ? { sill: elev } : {}) };
    if (snapOpening(o, L.rooms.filter((r) => r.kind !== 'outdoor'))) { L.openings.push(o); stats.openings++; }
  }
  const pieces = [...doc.querySelectorAll('pieceOfFurniture, light')].filter((el) => el.closest('home') && el.getAttribute('visible') !== 'false');
  for (const el of pieces) {
    const L = lvlOf(el.closest('furnitureGroup') || el); const m = mapFurniture(el, L.height);
    if (m.device) { L.devices.push({ id: newId('d'), ...m.device }); stats.furniture++; }
    else { const f = { id: newId('f'), ...m.furniture }; Object.keys(f).forEach((k) => f[k] === undefined && delete f[k]); L.furniture.push(f); stats.furniture++; }
  }
  const compass = doc.querySelector('compass');
  const site = { ...(current?.site || {}), roof: current?.site?.roof || { type: 'gable', pitch: 35, overhang: 0.4 } };
  if (compass) { site.north = -(parseFloat(compass.getAttribute('northDirection')) || 0); const lat = parseFloat(compass.getAttribute('latitude')), lon = parseFloat(compass.getAttribute('longitude')); if (Number.isFinite(lat) && Math.abs(lat) > 0.0001) { const rad = Math.abs(lat) <= 1.6 && Math.abs(lon) <= 3.2; site.lat = r3(rad ? (lat * 180) / Math.PI : lat); site.lon = r3(rad ? (lon * 180) / Math.PI : lon); } }
  const plan = { version: PLAN_VERSION, name: home.getAttribute('name')?.replace(/\.sh3d$/i, '') || file.name.replace(/\.sh3d$/i, ''), site, levels: [...levels.values()].sort((a, b) => a.elevation - b.elevation) };
  return { plan, stats };
}
