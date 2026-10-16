// Roofs (flat, shed, gable, hip, pyramid) over the top storey, roof coverings and PV arrays.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTex, rng, shade, mat } from './kit.js';
import { bbox } from './geometry.js';
import { sunVector } from './sun.js';

export const ROOF_TYPES = { none: 'Kein Dach', flat: 'Flachdach', shed: 'Pultdach', gable: 'Satteldach', hip: 'Walmdach', pyramid: 'Zeltdach' };
export const ROOF_COVERS = {
  pfanne: { label: 'Frankfurter Pfanne', color: '#7d3a2c' },
  biber: { label: 'Biberschwanz', color: '#9a4a33' },
  flach: { label: 'Flachziegel', color: '#3b3d42' },
  schiefer: { label: 'Schiefer', color: '#3e434b' },
  blech: { label: 'Stehfalz-Blech', color: '#5b636e' },
  kies: { label: 'Kies (Flachdach)', color: '#b8b2a6', flat: true },
  gruen: { label: 'Gründach (Flachdach)', color: '#6b8f4e', flat: true },
};
export const FACADES = { plaster: 'Putz', brick: 'Klinker', wood: 'Holzschalung' };
export const FACADE_PRESETS = ['#f4f1ea', '#ece7de', '#e3ddd0', '#d9d4cb', '#c9c6c0', '#a9aaa8', '#e8d9bf', '#d6b98f', '#c8d3cf', '#b9c6d6', '#5d6168', '#3a3d43'];

/* ---------- textures: drawn in light neutrals, the material colour tints them; 1 texture = 1 m ---------- */
const covTex = {};
function coverTexture(kind) {
  if (covTex[kind]) return covTex[kind];
  const t = canvasTex(256, (g, s) => {
    const r = rng(kind.length * 17);
    g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, s, s);
    if (kind === 'pfanne') { const rows = 3; for (let y = 0; y < rows; y++) for (let x = 0; x < s; x += 2) { const w = 0.5 + 0.5 * Math.sin((x / s) * Math.PI * 2 * 4); g.fillStyle = `rgba(255,255,255,${0.1 + 0.25 * w})`; g.fillRect(x, (y * s) / rows, 2, s / rows - 6); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x, ((y + 1) * s) / rows - 6, 2, 6); } }
    if (kind === 'biber') { const rows = 6, cols = 6; for (let y = 0; y < rows; y++) for (let c = 0; c < cols; c++) { const x0 = (c + (y % 2) * 0.5) * (s / cols), w = s / cols - 3, y0 = (y * s) / rows, h = s / rows + 10; g.fillStyle = shade('#d9d9d9', (r() - 0.5) * 0.12); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + w, y0); g.lineTo(x0 + w, y0 + h - w / 2); g.arc(x0 + w / 2, y0 + h - w / 2, w / 2, 0, Math.PI); g.closePath(); g.fill(); g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke(); } }
    if (kind === 'flach') { const rows = 3, cols = 3; for (let y = 0; y < rows; y++) for (let c = -1; c < cols; c++) { const x0 = (c + (y % 2) * 0.5) * (s / cols); g.fillStyle = shade('#d9d9d9', (r() - 0.5) * 0.08); g.fillRect(x0 + 2, (y * s) / rows + 2, s / cols - 4, s / rows - 8); g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x0, ((y + 1) * s) / rows - 6, s / cols, 6); } }
    if (kind === 'schiefer') { const rows = 8, cols = 5; for (let y = 0; y < rows; y++) for (let c = -1; c < cols; c++) { const x0 = (c + (y % 2) * 0.5) * (s / cols), y0 = (y * s) / rows; g.fillStyle = shade('#d9d9d9', (r() - 0.5) * 0.18); g.beginPath(); g.moveTo(x0 + 1, y0); g.lineTo(x0 + s / cols - 1, y0); g.lineTo(x0 + s / cols - 1, y0 + s / rows - 6); g.lineTo(x0 + s / cols / 2, y0 + s / rows + 2); g.lineTo(x0 + 1, y0 + s / rows - 6); g.closePath(); g.fill(); g.strokeStyle = 'rgba(0,0,0,.3)'; g.stroke(); } }
    if (kind === 'blech') { for (let x = 0; x < s; x += s / 2) { g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, 0, 3, s); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 3, 0, 3, s); } }
    if (kind === 'kies' || kind === 'gruen') { for (let i = 0; i < 9000; i++) { g.fillStyle = shade('#d9d9d9', (r() - 0.5) * 0.35); const q = 1 + r() * 2.5; g.fillRect(r() * s, r() * s, q, q); } }
  });
  covTex[kind] = t; return t;
}
const facTex = {};
export function facadeTexture(kind) {
  if (facTex[kind]) return facTex[kind];
  const t = canvasTex(256, (g, s) => {
    const r = rng(kind.length * 31);
    g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, s, s);
    if (kind === 'plaster') for (let i = 0; i < 7000; i++) { g.fillStyle = shade('#e6e6e6', (r() - 0.5) * 0.06); g.fillRect(r() * s, r() * s, 1.5, 1.5); }
    if (kind === 'brick') { const rows = 16, cols = 4; g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, s, s); for (let y = 0; y < rows; y++) for (let c = -1; c < cols; c++) { const x0 = (c + (y % 2) * 0.5) * (s / cols); g.fillStyle = shade('#cfcfcf', (r() - 0.5) * 0.14); g.fillRect(x0 + 2, (y * s) / rows + 2, s / cols - 4, s / rows - 3); } }
    if (kind === 'wood') { const n = 7; for (let i = 0; i < n; i++) { g.fillStyle = shade('#d6d6d6', (r() - 0.5) * 0.12); g.fillRect((i * s) / n, 0, s / n - 3, s); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(((i + 1) * s) / n - 3, 0, 3, s); g.strokeStyle = 'rgba(0,0,0,.06)'; for (let k = 0; k < 6; k++) { const x = (i * s) / n + r() * (s / n); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 6, s); g.stroke(); } } }
  });
  facTex[kind] = t; return t;
}
const facMats = new Map();
export function facadeMaterial(f = {}) {
  const k = `${f.material || 'plaster'}|${f.color || '#ece7de'}`;
  if (!facMats.has(k)) facMats.set(k, new THREE.MeshStandardMaterial({ map: facadeTexture(f.material || 'plaster'), color: f.color || '#ece7de', roughness: f.material === 'brick' ? 0.9 : 0.95 }));
  return facMats.get(k);
}
// Scales box UVs to metres so tiled facade textures keep their real size.
export function metricUV(geo, w, h, d) {
  const uv = geo.attributes.uv; const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) { const [du, dv] = dims[Math.floor(i / 4)] || [1, 1]; uv.setXY(i, uv.getX(i) * du, uv.getY(i) * dv); }
  return geo;
}

/* ---------- geometry ---------- */
function planeMesh(pts, material, frame) {
  // pts: Vector3[] (convex, ordered). UVs projected onto the plane frame in metres.
  const pos = [], uvs = [];
  const tri = (a, b, c) => { for (const p of [a, b, c]) { pos.push(p.x, p.y, p.z); const d = p.clone().sub(frame.origin); uvs.push(d.dot(frame.u), d.dot(frame.v)); } };
  for (let i = 1; i < pts.length - 1; i++) tri(pts[0], pts[i], pts[i + 1]);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material); m.castShadow = m.receiveShadow = true; return m;
}
function frameOf(eaveA, eaveB, top) {
  const u = eaveB.clone().sub(eaveA).normalize();
  const mid = eaveA.clone().add(eaveB).multiplyScalar(0.5);
  const v = top.clone().sub(mid); v.sub(u.clone().multiplyScalar(v.dot(u))); const slope = v.length(); v.normalize();
  const n = new THREE.Vector3().crossVectors(u, v).normalize(); if (n.y < 0) { n.negate(); u.negate(); }
  return { origin: mid, u, v, n, width: eaveA.distanceTo(eaveB), slope };
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// The roof sits on a rectangle (centre, length along the ridge, width across, rotation in degrees).
// Without an explicit rectangle it wraps the top storey's indoor rooms.
export function roofRect(level, roof, isIndoor) {
  if (roof?.rect) return roof.rect;
  const all = level ? level.rooms.filter(isIndoor) : [];
  const main = roof?.garageFlat === false ? all : all.filter((r) => r.kind !== 'garage'); // garages get their own flat roof
  const rooms = main.length ? main : all;
  if (!rooms.length) return null;
  const b = bbox(rooms.flatMap((r) => r.points));
  const alongX = roof?.ridge ? roof.ridge === 'x' : b.w >= b.d;
  return { cx: b.cx, cz: b.cz, length: alongX ? b.w : b.d, width: alongX ? b.d : b.w, rot: alongX ? 0 : 90 };
}
// Plan-space corners of the rectangle, ordered (-x,-z), (+x,-z), (+x,+z), (-x,+z) in roof coordinates.
export function rectCorners(r) {
  const t = (r.rot * Math.PI) / 180, X = [Math.cos(t), Math.sin(t)], Z = [-Math.sin(t), Math.cos(t)], hx = r.length / 2, hz = r.width / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [r.cx + sx * hx * X[0] + sz * hz * Z[0], r.cz + sx * hx * X[1] + sz * hz * Z[1]]);
}
export const rectAxes = (r) => { const t = (r.rot * Math.PI) / 180; return { X: [Math.cos(t), Math.sin(t)], Z: [-Math.sin(t), Math.cos(t)] }; };

// Returns { group, planes: [{frame, label}], update(states) }.
export function buildRoof(level, site, isIndoor) {
  const group = new THREE.Group(); const roof = site.roof || {}; const planes = [];
  const out = { group, planes, update() {} };
  if (!roof.type || roof.type === 'none') return out;
  const R = roofRect(level, roof, isIndoor); if (!R || R.length < 0.5 || R.width < 0.5) return out;
  const H = level.height, knee = Math.max(0, roof.knee || 0), oh = roof.overhang ?? 0.4, ohg = roof.overhangGable ?? oh;
  const cover = ROOF_COVERS[roof.cover] ? roof.cover : roof.type === 'flat' ? 'kies' : 'pfanne';
  const covMat = new THREE.MeshStandardMaterial({ map: coverTexture(cover), color: roof.color || ROOF_COVERS[cover].color, roughness: cover === 'blech' ? 0.45 : 0.85, metalness: cover === 'blech' ? 0.4 : 0, side: THREE.DoubleSide });
  const gableMat = facadeMaterial(site.facade); gableMat.side = THREE.DoubleSide;
  const local = new THREE.Group(); group.add(local);
  local.position.set(R.cx, H, R.cz); local.rotation.y = -(R.rot * Math.PI) / 180;
  const L = R.length, S = R.width, hx = L / 2, hz = S / 2;
  const t = Math.tan(THREE.MathUtils.degToRad(Math.min(70, Math.max(2, roof.pitch ?? 35))));
  const addPlane = (pts, eaveA, eaveB, top, gable = false) => { const f = frameOf(eaveA, eaveB, top); const m = planeMesh(pts, covMat, f); m.userData.roofPlane = planes.length; local.add(m); planes.push({ frame: f, pts, mesh: m, gable }); };
  const wall = (pts) => { const f = frameOf(pts[0], pts[1], pts[2]); const m = planeMesh(pts, gableMat, f); local.add(m); };
  // Knee wall (Kniestock): facade band between the top ceiling and the roof base.
  // The roof rests on the outer face of the walls: lift it by half a wall thickness along the slope,
  // and close the gap with a wall band (also forms the knee wall).
  const lift = roof.type === 'flat' ? 0 : 0.14 * t;
  if (roof.type !== 'flat') {
    const eaveH = knee + 0.02 * t, endH = ['gable', 'shed'].includes(roof.type) ? knee + lift : eaveH;
    for (const [w, d, x, z, h] of [[L + 0.24, 0.24, 0, hz, eaveH], [L + 0.24, 0.24, 0, -hz, eaveH], [0.24, S, hx, 0, endH], [0.24, S, -hx, 0, endH]]) { if (h < 0.01) continue; const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), gableMat); m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; local.add(m); }
  }
  const B = knee + lift; // roof base height above the top ceiling
  const V2 = (x, y, z) => V(x, y + B, z);
  if (roof.type === 'flat') {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(L + 0.1, 0.3, S + 0.1), gableMat); slab.position.y = 0.15; slab.castShadow = slab.receiveShadow = true; local.add(slab);
    const top = planeMesh([V(-hx, 0.31, hz), V(hx, 0.31, hz), V(hx, 0.31, -hz), V(-hx, 0.31, -hz)], covMat, { origin: V(0, 0.31, 0), u: V(1, 0, 0), v: V(0, 0, -1) }); local.add(top);
    const capM = mat('#9aa0a8', { rough: 0.5, metal: 0.4 });
    for (const [w, d, x, z] of [[L + 0.1, 0.12, 0, hz], [L + 0.1, 0.12, 0, -hz], [0.12, S + 0.1, hx, 0], [0.12, S + 0.1, -hx, 0]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(w, 0.28, d), gableMat); p.position.set(x, 0.44, z); p.castShadow = true; local.add(p); const c = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.03, d + 0.04), capM); c.position.set(x, 0.595, z); local.add(c); }
    planes.push({ frame: { origin: V(0, 0.32, 0), u: V(1, 0, 0), v: V(0, 0, -1), n: V(0, 1, 0), width: L - 0.6, slope: S - 0.6 }, flat: true });
  } else if (roof.type === 'shed') {
    const rise = S * t;
    addPlane([V2(-hx - ohg, -oh * t, hz + oh), V2(hx + ohg, -oh * t, hz + oh), V2(hx + ohg, rise + oh * t, -hz - oh), V2(-hx - ohg, rise + oh * t, -hz - oh)], V2(-hx - ohg, -oh * t, hz + oh), V2(hx + ohg, -oh * t, hz + oh), V2(0, rise + oh * t, -hz - oh), true);
    for (const sx of [-1, 1]) wall([V2(sx * hx, 0, hz), V2(sx * hx, 0, -hz), V2(sx * hx, rise, -hz)]);
    wall([V2(-hx, 0, -hz), V2(hx, 0, -hz), V2(hx, rise, -hz), V2(-hx, rise, -hz)]);
  } else if (roof.type === 'gable') {
    const z0 = Math.max(-0.45, Math.min(0.45, roof.ridgeOffset || 0)) * hz, Hr = hz * t;
    const tf = Hr / (hz - z0), tb = Hr / (hz + z0);
    addPlane([V2(-hx - ohg, -oh * tf, hz + oh), V2(hx + ohg, -oh * tf, hz + oh), V2(hx + ohg, Hr, z0), V2(-hx - ohg, Hr, z0)], V2(-hx - ohg, -oh * tf, hz + oh), V2(hx + ohg, -oh * tf, hz + oh), V2(0, Hr, z0), true);
    addPlane([V2(hx + ohg, -oh * tb, -hz - oh), V2(-hx - ohg, -oh * tb, -hz - oh), V2(-hx - ohg, Hr, z0), V2(hx + ohg, Hr, z0)], V2(hx + ohg, -oh * tb, -hz - oh), V2(-hx - ohg, -oh * tb, -hz - oh), V2(0, Hr, z0), true);
    for (const sx of [-1, 1]) wall([V2(sx * hx, 0, -hz), V2(sx * hx, 0, hz), V2(sx * hx, Hr, z0)]);
  } else if (roof.type === 'hip' || roof.type === 'pyramid') {
    const Hr = hz * t, r = roof.type === 'pyramid' ? 0 : Math.max(0, hx - hz), He = -oh * t;
    const e = [V2(-hx - oh, He, hz + oh), V2(hx + oh, He, hz + oh), V2(hx + oh, He, -hz - oh), V2(-hx - oh, He, -hz - oh)];
    const ra = V2(-r, Hr, 0), rb = V2(r, Hr, 0);
    addPlane(r > 0.01 ? [e[0], e[1], rb, ra] : [e[0], e[1], rb], e[0], e[1], rb);
    addPlane(r > 0.01 ? [e[2], e[3], ra, rb] : [e[2], e[3], ra], e[2], e[3], ra);
    addPlane([e[1], e[2], rb], e[1], e[2], rb);
    addPlane([e[3], e[0], ra], e[3], e[0], ra);
  }
  // Constructive details: underside, rafters, purlins, barge boards, brackets.
  if (roof.type !== 'flat') addDetails(local, planes, roof, { hx, hz, oh, ohg, t, B, type: roof.type, Hr: hz * t, z0: Math.max(-0.45, Math.min(0.45, roof.ridgeOffset || 0)) * hz, S });
  // Facing of each plane as a compass label (for picking the PV plane).
  const north = site.north || 0;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, local.rotation.y, 0));
  for (const p of planes) {
    const n = p.frame.n.clone().applyQuaternion(q);
    if (p.flat) { p.label = 'Flachdach'; continue; }
    const az = ((Math.atan2(n.x, -n.z) * 180) / Math.PI + north + 360) % 360;
    p.label = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'][Math.round(az / 45) % 8]; p.azimuth = az;
  }
  // PV arrays
  const panels = [];
  const south = sunVector(180, 0, north); const southLocal = V(south.x, 0, south.z).applyQuaternion(q.clone().invert()).normalize();
  for (const arr of site.solar || []) {
    if (!planes.length) break;
    let pl = planes[0];
    if (arr.plane === 'auto' || arr.plane == null) pl = planes.reduce((best, p) => (p.flat || Math.abs(((p.azimuth ?? 180) - 180 + 540) % 360 - 180) < Math.abs(((best.azimuth ?? 180) - 180 + 540) % 360 - 180) ? p : best), planes[0]);
    else pl = planes[Math.min(planes.length - 1, +arr.plane || 0)];
    const f = pl.frame; const w = arr.portrait === false ? 1.72 : 1.13, h = arr.portrait === false ? 1.13 : 1.72, gap = 0.03;
    const rows = Math.max(1, arr.rows || 1), cols = Math.max(1, arr.cols || 1);
    const totalW = cols * w + (cols - 1) * gap, totalH = rows * h + (rows - 1) * gap * 4;
    const glow = new THREE.MeshStandardMaterial({ color: '#0e1a33', roughness: 0.2, metalness: 0.7, emissive: '#2a6cff', emissiveIntensity: 0, map: panelTex() });
    const [ou, ov] = arr.offset || [0, 0];
    let u = f.u, v = f.v, n = f.n, base = f.origin.clone();
    if (pl.flat) { v = southLocal.clone(); u = V(0, 1, 0).cross(v).normalize(); n = V(0, 1, 0); }
    const centerV = pl.flat ? 0 : Math.max(totalH / 2 + 0.3, f.slope / 2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const du = -totalW / 2 + w / 2 + c * (w + gap) + ou, dv = -totalH / 2 + h / 2 + r * (h + gap * 4) + ov + centerV;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, h), glow);
      const p = base.clone().add(u.clone().multiplyScalar(du)).add(v.clone().multiplyScalar(pl.flat ? dv * 1.6 : dv)).add(n.clone().multiplyScalar(0.1));
      const basis = new THREE.Matrix4().makeBasis(u, n, u.clone().cross(n)); m.quaternion.setFromRotationMatrix(basis); m.position.copy(p);
      if (pl.flat) { m.rotateX(-THREE.MathUtils.degToRad(15)); m.position.y += 0.25; }
      m.castShadow = true; m.userData.solar = arr.id; local.add(m); panels.push(m);
    }
    out.update = ((prev) => (states) => {
      prev(states);
      const s = arr.entity_id && states[arr.entity_id]; let kw = s ? parseFloat(s.state) : NaN;
      if (s && /^w$/i.test(s.attributes?.unit_of_measurement || '')) kw /= 1000;
      const ratio = Number.isFinite(kw) ? Math.max(0, Math.min(1, kw / (arr.peak_kw || 5))) : 0;
      glow.emissiveIntensity = 0.02 + ratio * 0.2;
    })(out.update);
  }
  out.panels = panels;
  // roof windows and dormers
  out.items = [];
  const pitchedPlanes = planes.filter((pl) => !pl.flat);
  const builtItems = new Map(); let lastStates = null;
  const makeItem = (it) => {
    const pl = planes[it.plane] && !planes[it.plane].flat ? planes[it.plane] : pitchedPlanes[0];
    const built = it.kind === 'dormer' ? buildDormer(pl.frame, it, roof, gableMat, covMat, site.facade) : buildRoofWindow(pl.frame, it, site.facade);
    built.group.traverse((o) => { if (o.isMesh) { o.userData.roofItem = it.id; o.castShadow = true; } });
    local.add(built.group); builtItems.set(it.id, built); if (lastStates) built.update(lastStates);
  };
  const syncPicks = () => { out.items.length = 0; for (const b of builtItems.values()) out.items.push(...b.pickables); };
  if (pitchedPlanes.length) for (const it of site.roofItems || []) makeItem(it);
  syncPicks();
  out.update = ((prev) => (states) => { prev(states); lastStates = states; for (const b of builtItems.values()) b.update(states); })(out.update);
  // Rebuilds one roof item in place (cheap, used while dragging).
  out.rebuildItem = (it) => { const old = builtItems.get(it.id); if (old) { local.remove(old.group); old.group.traverse((o) => o.geometry?.dispose()); builtItems.delete(it.id); } if (pitchedPlanes.length) makeItem(it); syncPicks(); };
  out.local = local;
  return out;
}

/* ---------- roof windows & dormers ---------- */
export const ROOF_WINDOWS = { '78x118': [0.78, 1.18], '78x140': [0.78, 1.4], '94x140': [0.94, 1.4], '114x118': [1.14, 1.18], '114x140': [1.14, 1.4], '134x98': [1.34, 0.98] };
const coverPos = (states, id, inv) => { const s = id && states[id]; if (!s) return 100; let p = s.attributes?.current_position; p = p != null ? +p : s.state === 'closed' ? 0 : 100; return inv ? 100 - p : p; };
const isOpen = (states, id) => { const s = id && states[id]; return !!s && ['on', 'open'].includes(s.state); };
function sashParts(w, h, frameCol) {
  const g = new THREE.Group(); const fm = mat(frameCol || '#3b3d42', { rough: 0.5 });
  const fr = 0.07, d = 0.06;
  for (const [x, y, bw, bh] of [[0, h / 2 - fr / 2, w, fr], [0, -h / 2 + fr / 2, w, fr], [-w / 2 + fr / 2, 0, fr, h], [w / 2 - fr / 2, 0, fr, h]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), fm); b.position.set(x, y, 0); g.add(b); }
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * fr, h - 2 * fr), new THREE.MeshStandardMaterial({ color: '#9fc3dc', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  glass.position.z = 0.005; g.add(glass);
  return g;
}
// Shutter slats rolling down from the top edge. Returns setter(fractionClosed).
function shutter(w, h, z) {
  const tex = canvasTex(64, (g, s) => { g.fillStyle = '#5c5f66'; g.fillRect(0, 0, s, s); g.fillStyle = '#44474d'; for (let y = 0; y < s; y += 8) g.fillRect(0, y, s, 2); });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, 0.015), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.2 }));
  const box = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.12, 0.1), mat('#4a4d53', { rough: 0.5 }));
  box.position.set(0, h / 2 + 0.06, z); const g = new THREE.Group(); g.add(m, box);
  return { group: g, set(f) { f = Math.max(0.0, Math.min(1, f)); m.visible = f > 0.01; m.scale.y = Math.max(0.001, f * h); m.position.set(0, h / 2 - (f * h) / 2, z); tex.repeat.set(1, Math.max(1, f * h * 12)); } };
}
function buildRoofWindow(f, it, facade) {
  const group = new THREE.Group(); const w = it.w || 0.78, h = it.h || 1.18;
  // basis on the plane: x = u, y = v (up the slope), z = n (outward)
  const pos = f.origin.clone().addScaledVector(f.u, it.u || 0).addScaledVector(f.v, it.v ?? f.slope / 2).addScaledVector(f.n, 0.06);
  orient(group, pos, f.u, f.v);
  const flash = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.05), mat('#2c2e33', { rough: 0.5 })); flash.position.z = -0.02; group.add(flash);
  const hinge = new THREE.Group(); hinge.position.set(0, h / 2, 0.03); group.add(hinge);
  const sash = sashParts(w, h, '#30333a'); sash.position.set(0, -h / 2, 0); hinge.add(sash);
  const sh = it.cover ? shutter(w - 0.02, h - 0.02, 0.07) : null; if (sh) { group.add(sh.group); sh.set(0); }
  let cur = 0, tgt = 0, curS = 0, tgtS = 0, raf = 0;
  const step = () => { cur += (tgt - cur) * 0.2; curS += (tgtS - curS) * 0.2; hinge.rotation.x = -cur; sh?.set(curS); if (Math.abs(tgt - cur) + Math.abs(tgtS - curS) > 0.002) raf = requestAnimationFrame(step); else raf = 0; };
  return { group, pickables: [flash, ...sash.children], update(states) {
    tgt = isOpen(states, it.contact) ? 0.28 : 0; tgtS = it.cover ? 1 - coverPos(states, it.cover, it.coverInvert) / 100 : 0;
    if (!raf) raf = requestAnimationFrame(step);
  } };
}
function buildDormer(f, it, roof, wallMat, covMat, facade) {
  const group = new THREE.Group(); const w = Math.max(0.8, it.w || 1.6), wh = Math.max(0.6, (it.dormer?.h ?? 1.3));
  const hv = new THREE.Vector3(f.v.x, 0, f.v.z); const cosA = hv.length(); hv.normalize(); const tanA = Math.sqrt(1 - cosA * cosA) / cosA;
  // front foot point on the plane
  const foot = f.origin.clone().addScaledVector(f.u, it.u || 0).addScaledVector(f.v, it.v ?? f.slope * 0.35);
  const up = new THREE.Vector3(0, 1, 0); const depth = wh / Math.max(0.05, tanA) + 0.1;
  // local frame: x = u, y = up, z = -hv (towards outside / front)
  const base = new THREE.Group(); orient(base, foot, up.clone().cross(hv).normalize(), up); group.add(base); // z = up-slope
  // side walls as triangles + front wall
  const front = new THREE.Mesh(new THREE.BoxGeometry(w, wh, 0.12), wallMat); front.position.set(0, wh / 2, -0.06); base.add(front);
  for (const sx of [-1, 1]) {
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0, wh); s.lineTo(depth, wh); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false }); const m = new THREE.Mesh(g, wallMat);
    m.rotation.y = -Math.PI / 2; m.position.set(sx * (w / 2) + (sx > 0 ? 0.0 : 0.12), 0, -0.12); base.add(m);
  }
  const oh = 0.25, type = it.dormer?.type || 'shed';
  if (type === 'gable') {
    const rise = Math.min(1.2, (w / 2 + oh) * 0.8);
    for (const sx of [-1, 1]) { const len = Math.hypot(w / 2 + oh, rise); const pl = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, depth + oh), covMat); pl.position.set(sx * (w / 4 + oh / 2), wh + rise / 2 + 0.05, depth / 2 - oh / 2 - 0.12); pl.rotation.z = -sx * Math.atan2(rise, w / 2 + oh); base.add(pl); }
    const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, rise); s.closePath();
    const tri = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false }), wallMat); tri.position.set(0, wh, -0.12); base.add(tri);
  } else {
    const len = depth + oh + 0.1; const pl = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * oh, 0.06, len), covMat);
    const drop = Math.tan(THREE.MathUtils.degToRad(8)); pl.position.set(0, wh + 0.05 + (len / 2 - oh) * drop * 0.5, len / 2 - oh - 0.12); pl.rotation.x = -Math.atan(drop); base.add(pl);
  }
  // window in the front wall
  const ww = Math.min(w - 0.3, it.winW || w - 0.4), whh = Math.min(wh - 0.25, it.winH || wh - 0.35);
  const sash = sashParts(ww, whh, facade?.frame || '#f2f2f2'); sash.position.set(0, wh / 2 + 0.03, -0.125); sash.rotation.y = Math.PI; base.add(sash);
  const sh = it.cover ? shutter(ww, whh, 0) : null; if (sh) { sh.group.position.set(0, wh / 2 + 0.03, -0.17); sh.group.rotation.y = Math.PI; base.add(sh.group); sh.set(0); }
  const glassMat = sash.children[4].material; let curS = 0, tgtS = 0, raf = 0;
  const step = () => { curS += (tgtS - curS) * 0.2; sh?.set(curS); if (Math.abs(tgtS - curS) > 0.002) raf = requestAnimationFrame(step); else raf = 0; };
  const picks = []; base.traverse((o) => o.isMesh && picks.push(o));
  return { group, pickables: picks, update(states) { tgtS = it.cover ? 1 - coverPos(states, it.cover, it.coverInvert) / 100 : 0; glassMat.color.set(isOpen(states, it.contact) ? '#ffd27a' : '#9fc3dc'); if (!raf) raf = requestAnimationFrame(step); } };
}
let _pTex;
function panelTex() {
  if (_pTex) return _pTex;
  _pTex = canvasTex(128, (g, s) => { g.fillStyle = '#d0d6e2'; g.fillRect(0, 0, s, s); g.fillStyle = '#2a3550'; for (let y = 0; y < 10; y++) for (let x = 0; x < 6; x++) g.fillRect(x * (s / 6) + 1, y * (s / 10) + 1, s / 6 - 2, s / 10 - 2); });
  _pTex.wrapS = _pTex.wrapT = THREE.ClampToEdgeWrapping; return _pTex;
}

/* ---------- constructive roof details ---------- */
export const HEAD_SHAPES = { straight: 'Gerader Schnitt', bevel: 'Schrägschnitt', round: 'Rundschnitt', ogee: 'Schweif / S-Profil', step: 'Stufenschnitt', cove: 'Hohlkehle', carved: 'Geschnitzter Kopf', bracket: 'Konsole / Knagge' };
export const SOFFITS = { open: 'Offen (Sparren sichtbar)', closed: 'Geschlossen (verkleidet)', shadow: 'Schattenfuge (modern)' };
export const BARGES = { none: 'Kein Ortgangbrett', plain: 'Schlicht', profiled: 'Profiliert' };
export const WOOD_PRESETS = { '#c9a273': 'Natur hell', '#a8763e': 'Lärche', '#8a5a35': 'Fichte lasiert', '#5a3b22': 'Eiche dunkel', '#7c7a74': 'Grau lasiert', '#ece8df': 'Weiß' };
export const DEFAULT_DETAILS = { soffit: 'closed', rafters: false, spacing: 0.8, rw: 0.08, rh: 0.16, purlins: false, purlinOut: 0.35, flyRafter: false, barge: 'plain', brackets: false, braces: false, head: 'straight', wood: '#8a5a35' };

// Side profile of a beam end, x from 0 (inside) to len (visible end), top at y = 0, bottom at y = -h.
export function headProfile(shape, len, h) {
  const s = new THREE.Shape(); const k = Math.min(h * 1.2, len * 0.45);
  s.moveTo(0, 0); s.lineTo(len, 0);
  switch (shape) {
    case 'bevel': s.lineTo(len - k * 0.85, -h); break;
    case 'round': s.absarc(len - Math.min(h, k), 0, Math.min(h, k), 0, -Math.PI / 2, true); s.lineTo(len - Math.min(h, k), -h); break;
    case 'ogee': s.bezierCurveTo(len + k * 0.15, -h * 0.55, len - k, -h * 0.35, len - k, -h); break;
    case 'step': s.lineTo(len, -h / 3); s.lineTo(len - k * 0.3, -h / 3); s.lineTo(len - k * 0.3, (-2 * h) / 3); s.lineTo(len - k * 0.6, (-2 * h) / 3); s.lineTo(len - k * 0.6, -h); break;
    case 'cove': s.lineTo(len, -h * 0.15); s.quadraticCurveTo(len - k * 0.9, -h * 0.2, len - k * 0.9, -h); break;
    case 'carved': s.lineTo(len, -h * 0.22); s.lineTo(len - k * 0.12, -h * 0.3); s.bezierCurveTo(len - k * 0.05, -h * 0.6, len - k * 0.7, -h * 0.4, len - k * 0.75, -h * 0.75); s.lineTo(len - k * 0.6, -h * 0.82); s.lineTo(len - k * 0.85, -h); break;
    default: s.lineTo(len, -h);
  }
  s.lineTo(0, -h); s.closePath(); return s;
}
// SVG path of a profile for the inspector preview (100 × 40 box).
export function headSvg(shape) {
  const pts = headProfile(shape, 90, 30).getPoints(12);
  return `<svg viewBox="-4 -4 100 40" width="100" height="40" aria-hidden="true"><path d="M${pts.map((p) => `${p.x.toFixed(1)} ${(-p.y).toFixed(1)}`).join(' L')} Z" fill="currentColor" opacity=".85"/></svg>`;
}
function beam(len, w, h, shape, material) {
  const g = new THREE.ExtrudeGeometry(headProfile(shape, len, h), { depth: w, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -w / 2);
  const m = new THREE.Mesh(g, material); m.castShadow = true; m.receiveShadow = true; return m;
}
// Places object o so its local x/y/z axes map to the given world-space (roof-local) axes, origin at p.
function orient(o, p, x, y) { const z = new THREE.Vector3().crossVectors(x, y); o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); o.position.copy(p); return o; }
const _woodTex = {};
function woodMat(color) { return (_woodTex[color] ||= new THREE.MeshStandardMaterial({ map: facadeTexture('wood'), color, roughness: 0.8 })); }

function addDetails(target, planes, roof, c) {
  // Collect parts in a scratch group, then merge them per material into a few meshes.
  const local = new THREE.Group(); addDetailParts(local, planes, roof, c);
  const byMat = new Map();
  local.updateMatrixWorld(true);
  for (const m of local.children) { if (!m.isMesh) continue; let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrix); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) continue; (byMat.get(m.material) || byMat.set(m.material, []).get(m.material)).push(g); m.geometry.dispose(); }
  for (const [mt, gs] of byMat) { const g = mergeGeometries(gs, false); gs.forEach((x) => x.dispose()); if (!g) continue; const mesh = new THREE.Mesh(g, mt); mesh.castShadow = mt.side !== THREE.DoubleSide; mesh.receiveShadow = true; target.add(mesh); }
}
function addDetailParts(local, planes, roof, c) {
  const D = { ...DEFAULT_DETAILS, ...(roof.details || {}) };
  const wood = woodMat(D.wood), soffitM = new THREE.MeshStandardMaterial({ color: D.soffit === 'open' ? D.wood : '#eeeae2', map: D.soffit === 'open' ? facadeTexture('wood') : null, roughness: 0.9, side: THREE.DoubleSide });
  const fasciaM = mat(D.soffit === 'shadow' ? '#3b3d42' : D.soffit === 'open' ? D.wood : '#eeeae2', { rough: 0.7 });
  const COV = 0.035; const up = V(0, 1, 0);
  for (const pl of planes) {
    const f = pl.frame; if (!f.v || !pl.pts) continue;
    // underside sheathing a little below the covering
    const under = planeMesh(pl.pts.map((p) => p.clone().addScaledVector(f.n, -COV)), soffitM, f); under.castShadow = false; local.add(under);
    const hv = V(f.v.x, 0, f.v.z); const hlen = hv.length(); if (hlen < 1e-3) continue; hv.normalize(); // horizontal up-slope direction
    const cosA = hlen, ohS = c.oh / cosA; // overhang measured along the slope
    const eaveW = f.width;
    // closed soffit: horizontal board under the eave overhang + fascia
    if (D.soffit !== 'open' && c.oh > 0.05) {
      const sb = new THREE.Mesh(new THREE.BoxGeometry(eaveW, 0.02, c.oh), soffitM); orient(sb, f.origin.clone().addScaledVector(hv, c.oh / 2).add(V(0, -0.09, 0)), f.u, up); local.add(sb);
      if (D.soffit === 'shadow') { const sh = new THREE.Mesh(new THREE.BoxGeometry(eaveW, 0.025, 0.04), mat('#0d0f13')); orient(sh, f.origin.clone().addScaledVector(hv, c.oh - 0.02).add(V(0, -0.1, 0)), f.u, up); local.add(sh); }
      const fa = new THREE.Mesh(new THREE.BoxGeometry(eaveW, 0.2, 0.025), fasciaM); orient(fa, f.origin.clone().add(V(0, -0.08, 0)).addScaledVector(hv, -0.012), f.u, up); fa.castShadow = true; local.add(fa);
    }
    // rafter tails along the eave
    if (D.soffit === 'open' && D.rafters && c.oh > 0.05) {
      const usable = eaveW - 2 * (pl.gable ? c.ohg + 0.1 : 0.3); const n = Math.max(1, Math.floor(usable / Math.max(0.3, D.spacing)) + 1);
      const len = ohS + 0.45, x0 = -((n - 1) * D.spacing) / 2;
      const lim = pl.gable ? Infinity : eaveW / 2 - len * cosA - D.rw; // hip planes narrow towards the top
      for (let i = 0; i < n; i++) {
        if (Math.abs(x0 + i * D.spacing) > lim) continue;
        const b = beam(len, D.rw, D.rh, D.head === 'bracket' ? 'straight' : D.head, wood);
        const start = f.origin.clone().addScaledVector(f.u, x0 + i * D.spacing).addScaledVector(f.v, len - 0.04).addScaledVector(f.n, -COV);
        orient(b, start, f.v.clone().negate(), f.n); local.add(b);
      }
    }
    if (!pl.gable) continue;
    // gable edges: flying rafters and barge boards along both side edges of the plane
    for (const sx of [-1, 1]) {
      const slopeLen = f.slope + 0.0;
      if (D.flyRafter) {
        const b = beam(slopeLen + 0.06, D.rw + 0.02, D.rh + 0.02, D.head === 'bracket' ? 'straight' : D.head, wood);
        const start = f.origin.clone().addScaledVector(f.u, sx * (eaveW / 2 - (D.rw + 0.02) / 2)).addScaledVector(f.v, slopeLen).addScaledVector(f.n, -COV);
        orient(b, start, f.v.clone().negate(), f.n); local.add(b);
      }
      if (D.barge !== 'none') {
        const bh = D.barge === 'profiled' ? 0.3 : 0.22, L = slopeLen + 0.04;
        const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(L, 0); s.lineTo(L, -bh);
        if (D.barge === 'profiled') { const n = Math.max(2, Math.round(L / 0.22)); for (let i = n; i > 0; i--) { const x1 = (L * (i - 1)) / n, xm = (x1 + (L * i) / n) / 2; s.quadraticCurveTo(xm, -bh * 0.45, x1, -bh); } }
        else s.lineTo(0, -bh);
        s.closePath();
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false, curveSegments: 6 }); g.translate(0, 0, -0.015);
        const m = new THREE.Mesh(g, fasciaM.color.getHexString() === 'eeeae2' && D.soffit !== 'open' ? fasciaM : wood); m.castShadow = true;
        const yAxis = up.clone().addScaledVector(f.v, -up.dot(f.v)).normalize();
        orient(m, f.origin.clone().addScaledVector(f.u, sx * (eaveW / 2 + 0.016)).addScaledVector(f.v, -0.02).addScaledVector(f.n, 0.05), f.v, yAxis); local.add(m);
      }
    }
  }
  // purlin heads, brackets and braces at the gable ends (gable and shed roofs)
  if (!['gable', 'shed'].includes(c.type) || !(D.purlins || D.brackets || D.braces)) return;
  const under = (z) => (c.type === 'gable' ? (z >= c.z0 ? c.Hr - (z - c.z0) * (c.Hr / (c.hz - c.z0)) : c.Hr - (c.z0 - z) * (c.Hr / (c.hz + c.z0))) : (c.hz - z) * c.t) + c.B - COV - (D.rafters && D.soffit === 'open' ? D.rh : 0);
  const zs = c.type === 'gable' ? [c.z0, (c.z0 + c.hz) / 2, (c.z0 - c.hz) / 2, c.hz - 0.1, -c.hz + 0.1] : [c.hz - 0.1, 0, -c.hz + 0.1];
  const pw = 0.14, ph = 0.2, out = D.purlins ? D.purlinOut : 0;
  for (const z of zs) {
    const top = under(z);
    for (const sx of [-1, 1]) {
      const xIn = sx * (c.hx - 0.3), xOut = sx * (c.hx + c.ohg + out);
      if (D.purlins || D.brackets) {
        const len = Math.abs(xOut - xIn), b = beam(len, pw, ph, D.head === 'bracket' ? 'straight' : D.head, wood);
        b.position.set(xIn, top, z); b.rotation.y = sx > 0 ? 0 : Math.PI; local.add(b);
      }
      const reach = Math.min(c.ohg + out, 0.9) * 0.75;
      if ((D.brackets || D.head === 'bracket') && reach > 0.1) {
        const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(reach, 0); s.quadraticCurveTo(reach * 0.35, -reach * 0.25, 0, -reach * 0.9); s.closePath();
        const g = new THREE.ExtrudeGeometry(s, { depth: pw * 0.8, bevelEnabled: false, curveSegments: 6 }); g.translate(0, 0, -pw * 0.4);
        const m = new THREE.Mesh(g, wood); m.castShadow = true; m.position.set(sx * c.hx, top - ph, z); m.rotation.y = sx > 0 ? 0 : Math.PI; local.add(m);
      }
      if (D.braces && reach > 0.2) {
        const L = Math.hypot(reach, reach) * 1.05; const m = new THREE.Mesh(new THREE.BoxGeometry(L, 0.09, 0.09), wood); m.castShadow = true;
        m.position.set(sx * (c.hx + reach / 2), top - ph - reach / 2, z); m.rotation.z = sx > 0 ? Math.PI / 4 : -Math.PI / 4; local.add(m);
      }
    }
  }
}

/* ---------- style presets ---------- */
export const ROOF_STYLES = {
  bayern: { label: 'Bayern / Oberpfalz', roof: { type: 'gable', pitch: 26, overhang: 1.0, overhangGable: 1.0, cover: 'pfanne', color: '#6e3428', knee: 0.6 }, facade: { material: 'plaster', color: '#f4f1ea', frame: '#5a3b22' }, details: { soffit: 'open', rafters: true, spacing: 0.8, rw: 0.08, rh: 0.16, purlins: true, purlinOut: 0.35, flyRafter: true, barge: 'plain', brackets: false, braces: false, head: 'bevel', wood: '#8a5a35' } },
  tirol: { label: 'Tirol / Österreich', roof: { type: 'gable', pitch: 22, overhang: 1.4, overhangGable: 1.4, cover: 'flach', color: '#4a4744', knee: 0.8 }, facade: { material: 'plaster', color: '#f2eee6', frame: '#4a3020' }, details: { soffit: 'open', rafters: true, spacing: 0.75, rw: 0.1, rh: 0.18, purlins: true, purlinOut: 0.55, flyRafter: true, barge: 'profiled', brackets: true, braces: true, head: 'carved', wood: '#6b4423' } },
  chalet: { label: 'Chalet (Schweiz)', roof: { type: 'gable', pitch: 25, overhang: 1.5, overhangGable: 1.5, cover: 'flach', color: '#5a4a40', knee: 0.7 }, facade: { material: 'wood', color: '#b07a4a', frame: '#3d2817' }, details: { soffit: 'open', rafters: true, spacing: 0.7, rw: 0.1, rh: 0.18, purlins: true, purlinOut: 0.6, flyRafter: true, barge: 'profiled', brackets: true, braces: true, head: 'ogee', wood: '#9a6232' } },
  schwarzwald: { label: 'Schwarzwald', roof: { type: 'hip', pitch: 48, overhang: 1.6, cover: 'schiefer', color: '#4a3a30', knee: 0 }, facade: { material: 'wood', color: '#7a5434', frame: '#3a2618' }, details: { soffit: 'open', rafters: true, spacing: 0.9, rw: 0.12, rh: 0.2, head: 'straight', wood: '#5a3b22', barge: 'none' } },
  skandi: { label: 'Skandinavisch', roof: { type: 'gable', pitch: 35, overhang: 0.4, overhangGable: 0.3, cover: 'blech', color: '#2e2f33', knee: 0 }, facade: { material: 'wood', color: '#8c2f25', frame: '#f0eee8' }, details: { soffit: 'open', rafters: true, spacing: 0.6, rw: 0.06, rh: 0.14, purlins: false, flyRafter: false, barge: 'plain', head: 'straight', wood: '#f0eee8' } },
  craftsman: { label: 'Craftsman (USA)', roof: { type: 'gable', pitch: 30, overhang: 0.9, overhangGable: 0.8, cover: 'flach', color: '#4b4f55', knee: 0 }, facade: { material: 'wood', color: '#7b8a6a', frame: '#efe9dd' }, details: { soffit: 'open', rafters: true, spacing: 0.6, rw: 0.06, rh: 0.15, purlins: true, purlinOut: 0.3, flyRafter: true, barge: 'plain', brackets: true, braces: false, head: 'cove', wood: '#6b4a2e' } },
  japan: { label: 'Japanisch', roof: { type: 'hip', pitch: 25, overhang: 1.2, cover: 'flach', color: '#3a3d42', knee: 0 }, facade: { material: 'plaster', color: '#efe9dd', frame: '#3a2a1e' }, details: { soffit: 'open', rafters: true, spacing: 0.4, rw: 0.06, rh: 0.1, head: 'straight', wood: '#4a3626', barge: 'none' } },
  modern: { label: 'Modern', roof: { type: 'shed', pitch: 8, overhang: 0.15, overhangGable: 0.15, cover: 'blech', color: '#3b3d42', knee: 0 }, facade: { material: 'plaster', color: '#e9e9e7', frame: '#2c2f35' }, details: { soffit: 'shadow', rafters: false, purlins: false, flyRafter: false, barge: 'none', brackets: false, braces: false, head: 'straight', wood: '#7c7a74' } },
};
export function applyStyle(site, key, { keepType = true } = {}) {
  const st = ROOF_STYLES[key]; if (!st) return;
  const type = site.roof.type, keep = keepType && type && type !== 'none';
  const { type: styleType, ...rest } = st.roof;
  Object.assign(site.roof, keep ? rest : st.roof); site.roof.details = { ...DEFAULT_DETAILS, ...st.details }; site.roof.style = key;
  if (keep && type === 'flat') { site.roof.cover = 'kies'; site.roof.color = ROOF_COVERS.kies.color; }
  if (keep && type !== 'flat' && ROOF_COVERS[site.roof.cover]?.flat) site.roof.cover = 'pfanne';
  site.facade = { ...site.facade, ...st.facade };
}

/* ---------- additional roofs (garage, carport, garden house, extension …) ---------- */
// Each entry of site.roofs: { id, name, type, pitch, overhang, cover, levelId, height (eaves above that floor), rect, posts }
export function newExtraRoof(plan, { levelId, rect, name, type = 'flat', posts = false, height } = {}) {
  const L = plan.levels.find((l) => l.id === levelId) || plan.levels[0];
  return { id: 'xr' + Math.random().toString(36).slice(2, 8), name: name || `Dach ${(plan.site.roofs || []).length + 2}`, type, pitch: type === 'flat' ? 3 : 25, overhang: type === 'flat' ? 0.15 : 0.3, cover: type === 'flat' ? (posts ? 'blech' : 'kies') : 'pfanne', levelId: L?.id, height: height ?? (posts ? 2.3 : Math.min(L?.height || 2.6, 2.75)), rect, posts };
}
export function rectOfPoints(pts, ridge = 'auto') {
  const b = bbox(pts); const alongX = ridge === 'auto' ? b.w >= b.d : ridge === 'x';
  return { cx: Math.round(b.cx * 1000) / 1000, cz: Math.round(b.cz * 1000) / 1000, length: Math.round((alongX ? b.w : b.d) * 1000) / 1000, width: Math.round((alongX ? b.d : b.w) * 1000) / 1000, rot: alongX ? 0 : 90 };
}
export function buildExtraRoof(xr, site) {
  const roof = { ...xr, overhangGable: xr.overhang, details: { ...(xr.details || {}), rafters: false } };
  const out = buildRoof({ height: Math.max(1.8, xr.height || 2.5), rooms: [] }, { facade: site.facade, north: site.north, roof, solar: [], roofItems: [] }, () => false);
  if (xr.posts && xr.rect) { // carport: posts at the corners and every ~3 m
    const R = xr.rect, hx = R.length / 2 - 0.1, hz = R.width / 2 - 0.1, h = Math.max(1.8, xr.height || 2.3);
    const pm = mat('#6b4f36', { rough: 0.8 }); const n = Math.max(1, Math.round((2 * hx) / 3));
    const g = new THREE.Group(); g.position.set(R.cx, 0, R.cz); g.rotation.y = -(R.rot * Math.PI) / 180;
    for (let i = 0; i <= n; i++) for (const sz of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), pm); m.position.set(-hx + (2 * hx * i) / n, h / 2, sz * hz); m.castShadow = true; g.add(m); }
    for (const sz of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(2 * hx + 0.12, 0.16, 0.12), pm); m.position.set(0, h - 0.08, sz * hz); m.castShadow = true; g.add(m); }
    out.group.add(g);
  }
  out.group.traverse((o) => { if (o.isMesh) { o.userData.xroof = xr.id; o.castShadow = true; } });
  return out;
}
