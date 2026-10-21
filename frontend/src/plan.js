import { normalizeSurfaceDefinition, normalizeSurfaceOptions } from '../../engine/surface.js';
// Plan schema (version 2), migration, lookup helpers and the operation applier that both
// the editor and the AI agent use. Every change an agent proposes is one of these ops.
import { registerLibrary } from './furniture.js';
import { markFurnitureCompositionCurrent, migrateFurnitureCompositions } from './furniture-composition.js';
import { markStandaloneProjectorScreen, migrateLegacyProjectors } from './projector-migration.js';
import { rectPoints, pointInPolygon, bbox, labelPoint, r3 } from './geometry.js';
import { t } from './i18n.js';

export const PLAN_VERSION = 2;
export const DEFAULT_SLAB = 0.25;
let counter = Date.now() % 1e6;
export const newId = (p) => `${p}${(counter++).toString(36)}`;

// The slab belongs to the level standing on it. Missing or invalid legacy values use the
// default without being written back into the user's plan.
export function slabThickness(level) {
  return Number.isFinite(level?.slab) && level.slab >= 0 ? level.slab : DEFAULT_SLAB;
}

export const DEFAULT_ROOM_HEIGHT = 2.6, DEFAULT_BASEMENT_HEIGHT = 2.4, DEFAULT_PLINTH = 0.3;
export const plinthHeight = (site) => (Number.isFinite(site?.facade?.plinthHeight) && site.facade.plinthHeight >= 0 ? site.facade.plinthHeight : DEFAULT_PLINTH);
const hasIndoor = (l) => (l.rooms || []).some((r) => !r.kind || r.kind === 'room' || r.kind === 'garage');

// Terrain height (world y) and the storey that stands on it. That storey gets the plinth,
// which reaches down to the terrain when its floor is raised (e.g. a raised ground floor).
export function terrainOf(p) {
  const L = [...(p?.levels || [])].sort((a, b) => a.elevation - b.elevation);
  if (!L.length) return { y: 0, groundId: null };
  let y;
  if (Number.isFinite(p.site?.terrain)) y = p.site.terrain;
  else {
    const outdoor = L.find((l) => l.rooms?.some((r) => r.kind === 'outdoor'));
    const near = [...L].sort((a, b) => Math.abs(a.elevation) - Math.abs(b.elevation))[0];
    // A floor slightly above ±0 is a raised ground floor; larger values are absolute heights.
    y = outdoor ? outdoor.elevation : near.elevation > 0 && near.elevation <= 1.5 ? 0 : near.elevation;
  }
  const ground = L.find((l) => l.elevation >= y - 0.6 && hasIndoor(l));
  return { y, groundId: ground?.id ?? null };
}

// Fits a new storey into the stack. Plan values (floor elevation relative to the ground
// floor, clear room height, slab) are used when they are plausible; otherwise defaults.
// Returns the level fields plus `source` per value ('plan' | 'default' | 'derived').
export function fitNewLevel(p, { elevation, height, slab } = {}) {
  const ok = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  const L = [...(p?.levels || [])].sort((a, b) => a.elevation - b.elevation);
  const src = { height: ok(height, 1.9, 4.5) ? 'plan' : 'default', slab: ok(slab, 0, 0.6) ? 'plan' : 'default', elevation: 'derived' };
  let h = src.height === 'plan' ? height : DEFAULT_ROOM_HEIGHT, s = src.slab === 'plan' ? slab : DEFAULT_SLAB;
  if (!L.length) {
    const e = ok(elevation, -4, 1.5) ? elevation : 0; src.elevation = ok(elevation, -4, 1.5) ? 'plan' : 'default';
    return { position: 'only', elevation: r3(e), height: h, slab: s, autoElevation: undefined, source: src };
  }
  const bottom = L[0], top = L[L.length - 1];
  if (Number.isFinite(elevation) && elevation < bottom.elevation - 1.5) {
    // Basement: the storey above keeps its floor; the basement height closes the gap.
    if (src.height === 'default') h = DEFAULT_BASEMENT_HEIGHT;
    const fit = bottom.elevation - elevation - slabThickness(bottom);
    if (src.height === 'default' && ok(fit, 1.9, 4.5)) { h = r3(fit); src.height = 'derived'; }
    return { position: 'below', elevation: r3(bottom.elevation - h - slabThickness(bottom)), height: h, slab: s, autoElevation: false, source: src };
  }
  // Above the top storey: a plan elevation tells the slab thickness (floor minus wall top).
  const gap = Number.isFinite(elevation) ? elevation - top.elevation - top.height : NaN;
  if (src.slab === 'default' && ok(gap, 0.12, 0.5)) { s = r3(gap); src.slab = 'derived'; }
  return { position: 'above', elevation: r3(top.elevation + top.height + s), height: h, slab: s, autoElevation: undefined, mismatch: Number.isFinite(gap) && !ok(gap - s, -0.05, 0.05), source: src };
}

export function emptyPlan() {
  return { version: PLAN_VERSION, name: t('data.defaults.home'), site: DEFAULT_SITE(), levels: [newLevel(t('data.defaults.groundFloor'), 0)] };
}
export function newLevel(name, elevation, extra = {}) {
  return { id: newId('l'), name, floor_id: null, elevation, height: 2.6, cutHeight: 1.2, rooms: [], openings: [], furniture: [], devices: [], underlay: null, ...extra };
}

export function migrate(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.version === PLAN_VERSION && Array.isArray(p.levels)) return normalize(p);
  if (Array.isArray(p.rooms)) { // version 1: one level, rectangle rooms
    const lvl = newLevel(p.name || t('data.defaults.groundFloor'), 0, { height: p.wallHeight || 2.6, cutHeight: p.interiorWallHeight || 1.2 });
    lvl.rooms = p.rooms.map((r) => ({ id: r.id, name: r.name, area_id: r.area || null, kind: 'room', surface: r.floor || 'oak', points: rectPoints(...r.rect) }));
    lvl.openings = p.openings || []; lvl.furniture = p.furniture || []; lvl.devices = (p.devices || []).map((d) => ({ ...d, entity_id: d.entity }));
    return normalize({ version: PLAN_VERSION, name: p.name || t('data.defaults.home'), site: { north: 0, roof: { type: 'none' } }, levels: [lvl] });
  }
  return null;
}
export const DEFAULT_SITE = () => ({
  lat: null, lon: null, north: 0,
  facade: { material: 'plaster', color: '#ece7de', plinth: '#5f636b', frame: '#2c3142' },
  roof: { type: 'gable', pitch: 35, overhang: 0.4, cover: 'pfanne', color: '#7d3a2c' },
  solar: [],
  roofItems: [],
});
// Levels above the lowest one sit on the level below (its floor + room height + slab),
// unless their elevation was set by hand (autoElevation === false).
export function computeElevations(p) {
  p.levels.sort((a, b) => a.elevation - b.elevation);
  for (let i = 1; i < p.levels.length; i++) {
    const l = p.levels[i], below = p.levels[i - 1];
    if (l.autoElevation !== false) l.elevation = Math.round((below.elevation + below.height + slabThickness(l)) * 1000) / 1000;
  }
  return p;
}
function normalize(p) {
  if (p.site?.library) registerLibrary(Object.values(p.site.library), { source: 'plan' });
  const d = DEFAULT_SITE(), s = p.site || {};
  p.site = { ...d, ...s, facade: { ...d.facade, ...(s.facade || {}) }, roof: { ...d.roof, ...(s.roof || {}) }, solar: s.solar || [], roofItems: s.roofItems || [], roofs: s.roofs || null, library: s.library || {} };
  for (const l of p.levels) {
    l.rooms ||= []; l.openings ||= []; l.furniture ||= []; l.devices ||= [];
    migrateFurnitureCompositions(l);
    for (const r of l.rooms) { if (!r.points && r.rect) r.points = rectPoints(...r.rect); r.kind ||= 'room'; }
  }
  migrateLegacyProjectors(p);
  if (!Array.isArray(p.site.roofs)) { // older plans: garages not covered by a storey above get their own flat roof
    p.site.roofs = [];
    if (p.site.roof?.garageFlat !== false && p.site.roof?.type && p.site.roof.type !== 'none') for (const l of p.levels) for (const r of l.rooms) {
      if (r.kind !== 'garage' || r.points.length < 3) continue; const c = labelPoint(r.points);
      if (p.levels.some((u) => u.elevation > l.elevation + 0.5 && u.rooms.some((x) => x.kind === 'room' && pointInPolygon(c, x.points)))) continue;
      const b = bbox(r.points), alongX = b.w >= b.d;
      p.site.roofs.push({ id: 'xr' + r.id, name: t('data.defaults.roofOf', { name: r.name || t('data.demo.room.garage') }), type: 'flat', pitch: 3, overhang: 0.15, cover: 'kies', levelId: l.id, height: r.height || l.height, rect: { cx: r3(b.cx), cz: r3(b.cz), length: r3(alongX ? b.w : b.d), width: r3(alongX ? b.d : b.w), rot: alongX ? 0 : 90 }, posts: false });
    }
  }
  computeElevations(p); syncStairVoids(p); return p;
}

/* ---------- lookups ---------- */
export function findItem(plan, id) {
  for (const level of plan.levels) {
    if (level.id === id) return { level, type: 'level', item: level, list: plan.levels };
    for (const [type, key] of [['room', 'rooms'], ['opening', 'openings'], ['device', 'devices'], ['furniture', 'furniture']]) {
      const item = level[key].find((x) => x.id === id); if (item) return { level, type, item, list: level[key] };
    }
  }
  return null;
}
export const levelById = (plan, id) => plan.levels.find((l) => l.id === id) || null;
export function roomAt(level, [x, z]) {
  const rooms = level.rooms.filter((r) => r.kind !== 'void');
  return rooms.find((r) => r.kind !== 'outdoor' && pointInPolygon([x, z], r.points)) || rooms.find((r) => pointInPolygon([x, z], r.points)) || null;
}
export function roomOfOpening(level, o) {
  const mx = (o.from[0] + o.to[0]) / 2, mz = (o.from[1] + o.to[1]) / 2;
  const dx = o.to[0] - o.from[0], dz = o.to[1] - o.from[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
  const a = roomAt(level, [mx + nx * 0.2, mz + nz * 0.2]), b = roomAt(level, [mx - nx * 0.2, mz - nz * 0.2]);
  return [a, b].find((r) => r && r.kind !== 'outdoor') || a || b;
}
export function usedEntities(plan) {
  const s = new Set();
  for (const it of plan.site?.roofItems || []) { if (it.cover) s.add(it.cover); if (it.contact) s.add(it.contact); }
  for (const l of plan.levels) { for (const d of [...l.devices, ...l.furniture]) if (d.entity_id) s.add(d.entity_id); for (const o of l.openings) { if (o.cover) s.add(o.cover); if (o.contact) s.add(o.contact); } }
  return s;
}
export function roomCenter(r) { return labelPoint(r.points); }

export function stairTargetLevel(plan, level, stair) {
  const next = [...plan.levels].filter((l) => l.elevation > level.elevation).sort((a, b) => a.elevation - b.elevation)[0] || null;
  if (stair?.targetLevelId === null) return null;
  if (stair?.targetLevelId) return stair.targetLevelId === next?.id ? next : null;
  return next;
}

function stairPose(stair) {
  return { x: stair.pos[0], z: stair.pos[1], rot: stair.rot || 0, w: (stair.width ?? 1) + 0.1, d: (stair.depth ?? 3.2) + 0.1 };
}
function poseSignature(p) { return `${p.x},${p.z}|${p.rot}|${p.w}|${p.d}`; }
function poseFromSignature(sig) {
  const [pos, rot, w, d] = String(sig || '').split('|'), [x, z] = (pos || '').split(',').map(Number); const values = [x, z, +rot, +w, +d];
  return values.every(Number.isFinite) ? { x, z, rot: +rot, w: +w, d: +d } : null;
}
function stairOpeningPoints(p) {
  const th = p.rot * Math.PI / 180, X = [Math.cos(th), -Math.sin(th)], Z = [Math.sin(th), Math.cos(th)];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [r3(p.x + a * p.w / 2 * X[0] + b * p.d / 2 * Z[0]), r3(p.z + a * p.w / 2 * X[1] + b * p.d / 2 * Z[1])]);
}
const samePoints = (a, b) => a?.length === b?.length && a.every((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) < 0.002);
function moveManualOpening(points, from, to) {
  if (!from || (from.x === to.x && from.z === to.z && from.rot === to.rot)) return points;
  const th = (to.rot - from.rot) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  return points.map(([x, z]) => { const dx = x - from.x, dz = z - from.z; return [r3(to.x + dx * c + dz * s), r3(to.z - dx * s + dz * c)]; });
}

// Every staircase owns one void on its target storey. Legacy edited voids are recognized from
// their saved signature and retained as manual openings instead of being regenerated.
export function syncStairVoids(plan) {
  const changed = new Set(), desired = new Map(), existing = new Map();
  for (const level of plan.levels) for (const room of level.rooms) if (room.stair) existing.set(room.stair, { level, room });
  for (const level of plan.levels) for (const stair of level.furniture.filter((f) => f.type === 'stairs')) {
    const target = stairTargetLevel(plan, level, stair), found = existing.get(stair.id);
    if (!target) {
      if (found && stair.openingMode === 'manual') { stair.openingPoints = found.room.points.map((p) => [...p]); stair.openingSig = found.room.sig; }
      continue;
    }
    const pose = stairPose(stair), sig = poseSignature(pose); let room = found?.room;
    if (!room) room = { id: `void_${stair.id}`, name: t('data.defaults.stairwell'), kind: 'void', surface: 'oak', area_id: null, points: stair.openingMode === 'manual' && stair.openingPoints ? stair.openingPoints.map((p) => [...p]) : stairOpeningPoints(pose), stair: stair.id, sig: stair.openingSig || sig };
    const oldPose = poseFromSignature(room.sig);
    if (stair.openingMode == null && (!oldPose || !samePoints(room.points, stairOpeningPoints(oldPose)))) stair.openingMode = 'manual';
    const manual = stair.openingMode === 'manual';
    const points = manual ? moveManualOpening(room.points, oldPose, pose) : stairOpeningPoints(pose);
    if (!samePoints(room.points, points) || room.sig !== sig || found?.level !== target) {
      room.points = points; room.sig = sig; changed.add(target.id); if (found?.level && found.level !== target) changed.add(found.level.id);
    }
    desired.set(stair.id, target.id);
    if (manual) { stair.openingPoints = points.map((p) => [...p]); stair.openingSig = sig; }
    if (found?.level !== target) target.rooms.push(room);
  }
  for (const level of plan.levels) {
    const before = level.rooms.length;
    level.rooms = level.rooms.filter((r) => !r.stair || (desired.get(r.stair) === level.id && existing.get(r.stair)?.room === r) || (!existing.has(r.stair) && desired.get(r.stair) === level.id));
    if (level.rooms.length !== before) changed.add(level.id);
  }
  return changed;
}
export function planBounds(plan, level) {
  const pts = (level ? [level] : plan.levels).flatMap((l) => l.rooms.flatMap((r) => r.points));
  return pts.length ? bbox(pts) : { minX: 0, minZ: 0, maxX: 8, maxZ: 8, w: 8, d: 8, cx: 4, cz: 4 };
}

/* ---------- operations (shared with the agent) ---------- */
const num = (v, d) => (Number.isFinite(+v) ? +v : d);
const pt = (p) => (Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(+v)) ? [r3(+p[0]), r3(+p[1])] : null);
function pointsFrom(op) {
  if (Array.isArray(op.points) && op.points.length >= 3) { const pts = op.points.map(pt); if (pts.every(Boolean)) return pts; }
  if (Array.isArray(op.rect) && op.rect.length === 4) return rectPoints(...op.rect.map((v) => num(v, 0)));
  return null;
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export function applyOps(plan, ops) {
  const results = [];
  const lvl = (op) => levelById(plan, op.level_id) || plan.levels[0];
  for (const op of ops) {
    try {
      const f = (id) => { const x = findItem(plan, id); if (!x) throw new Error(t('data.error.unknownId', { id })); return x; };
      switch (op.op) {
        case 'add_level': { const l = newLevel(op.name || t('data.defaults.newLevel'), num(op.elevation, 0), pick(op, ['floor_id'])); if (op.id) l.id = op.id; if (op.height) l.height = num(op.height, DEFAULT_ROOM_HEIGHT); if (Number.isFinite(op.slab) && op.slab >= 0) l.slab = op.slab; if (op.autoElevation === false) l.autoElevation = false; plan.levels.push(l); computeElevations(plan); results.push({ ok: true, id: l.id }); break; }
        case 'update_level': { const { item } = f(op.level_id); Object.assign(item, pick(op, ['name', 'floor_id'])); for (const k of ['elevation', 'height', 'cutHeight']) if (op[k] !== undefined) item[k] = num(op[k], item[k]); if (op.elevation !== undefined) item.autoElevation = false; computeElevations(plan); results.push({ ok: true }); break; }
        case 'add_room': { const points = pointsFrom(op); if (!points) throw new Error(t('data.error.roomGeometry')); const r = { id: op.id || newId('r'), name: op.name || t('data.defaults.room'), kind: op.kind || 'room', surface: op.surface || (op.kind === 'outdoor' ? 'lawn' : 'oak'), area_id: op.area_id || null, points }; if (op.surfaceSpec) r.surfaceSpec = normalizeSurfaceDefinition(op.surfaceSpec); if (op.surfaceOptions) r.surfaceOptions = normalizeSurfaceOptions(op.surfaceOptions); lvl(op).rooms.push(r); results.push({ ok: true, id: r.id }); break; }
        case 'update_room': { const { item } = f(op.room_id);
          const spec = op.surfaceSpec ? normalizeSurfaceDefinition(op.surfaceSpec) : null;
          const options = op.surfaceOptions ? normalizeSurfaceOptions(op.surfaceOptions) : null;
          if (op.surface !== undefined || op.surfaceSpec === null || ['outdoor', 'void'].includes(op.kind)) { delete item.surfaceSpec; delete item.surfaceOptions; }
          if (spec) { item.surfaceSpec = spec; delete item.surfaceOptions; }
          if (options) item.surfaceOptions = options;
          if (op.surfaceOptions === null) delete item.surfaceOptions;
          Object.assign(item, pick(op, ['name', 'kind', 'surface', 'area_id'])); const p = pointsFrom(op); if (p) item.points = p; results.push({ ok: true }); break; }
        case 'add_opening': { const from = pt(op.from), to = pt(op.to); if (!from || !to) throw new Error(t('data.error.openingGeometry')); const o = { id: op.id || newId('o'), type: op.type || 'door', from, to, ...pick(op, ['sill', 'head', 'glazed', 'model', 'frameColor', 'leafColor', 'shutterColor', 'shutterFrameColor', 'cover', 'contact', 'preset', 'hinge', 'swing']) }; lvl(op).openings.push(o); results.push({ ok: true, id: o.id }); break; }
        case 'update_opening': { const { item } = f(op.opening_id); Object.assign(item, pick(op, ['type', 'sill', 'head', 'glazed', 'model', 'frameColor', 'leafColor', 'shutterColor', 'shutterFrameColor', 'cover', 'contact', 'hinge', 'swing'])); if (pt(op.from)) item.from = pt(op.from); if (pt(op.to)) item.to = pt(op.to); results.push({ ok: true }); break; }
        case 'place_device': { const pos = pt(op.pos); if (!pos) throw new Error(t('data.error.devicePosition')); const d = markStandaloneProjectorScreen({ id: op.id || newId('d'), kind: op.kind, pos, ...pick(op, ['style', 'entity_id', 'y', 'elevation', 'autoElevation', 'rot', 'length', 'projector_id', 'projector_screen_only']) }); lvl(op).devices.push(d); results.push({ ok: true, id: d.id }); break; }
        case 'update_device': { const { item } = f(op.device_id); Object.assign(item, pick(op, ['style', 'entity_id', 'y', 'elevation', 'autoElevation', 'rot', 'length', 'kind', 'projector_id', 'projector_screen_only'])); if (op.elevation !== undefined && op.autoElevation === undefined) item.autoElevation = false; markStandaloneProjectorScreen(item); if (pt(op.pos)) item.pos = pt(op.pos); results.push({ ok: true }); break; }
        case 'place_furniture': { const pos = pt(op.pos); if (!pos) throw new Error(t('data.error.furniturePosition')); const it = markFurnitureCompositionCurrent({ id: op.id || newId('f'), type: op.type, pos, elevation: 0, autoElevation: op.elevation === undefined, ...pick(op, ['rot', 'width', 'depth', 'height', 'lift', 'color', 'elevation', 'autoElevation']) }); lvl(op).furniture.push(it); results.push({ ok: true, id: it.id }); break; }
        case 'move_item': { const { item } = f(op.item_id); if (pt(op.pos)) item.pos = pt(op.pos); if (op.rot !== undefined) item.rot = num(op.rot, 0); if (op.elevation !== undefined) { item.elevation = num(op.elevation, 0); item.autoElevation = false; } if (typeof op.autoElevation === 'boolean') item.autoElevation = op.autoElevation; results.push({ ok: true }); break; }
        case 'delete_item': { const x = f(op.item_id); x.list.splice(x.list.indexOf(x.item), 1); results.push({ ok: true }); break; }
        default: throw new Error(t('data.error.unknownOperation', { operation: op.op }));
      }
    } catch (e) { results.push({ ok: false, error: e.message }); }
  }
  return results;
}

/* ---------- demo house ---------- */
const R = (id, name, area_id, rect, surface = 'oak', kind = 'room') => ({ id, name, area_id, kind, surface, points: rectPoints(...rect) });
export function demoPlan() {
  return normalize({
    version: PLAN_VERSION, name: t('data.demo.planName'),
    site: { lat: 49.326, lon: 12.11, north: 12, facade: { material: 'plaster', color: '#ece7de', plinth: '#5f636b', frame: '#2c3142' }, roof: { type: 'gable', pitch: 38, overhang: 0.5, ridge: 'x', cover: 'pfanne', color: '#6e3428' }, solar: [{ id: 'pv1', plane: 'auto', rows: 2, cols: 6, portrait: true, offset: [0, 0], entity_id: 'sensor.pv_leistung', peak_kw: 5.4 }], roofItems: [{ id: 'dfw1', kind: 'window', plane: 0, u: -4.4, v: 2.2, w: 0.78, h: 1.18, cover: 'cover.dachfenster', contact: 'binary_sensor.dachfenster' }] },
    levels: [
      {
        id: 'eg', name: t('data.defaults.groundFloor'), floor_id: 'erdgeschoss', elevation: 0, height: 2.6, cutHeight: 1.2,
        rooms: [
          { id: 'wohnen', name: t('data.demo.room.livingDining'), area_id: 'wohnzimmer', kind: 'room', surface: 'oak', points: [[0, 0], [6.2, 0], [6.2, 4.8], [4.4, 4.8], [4.4, 8.4], [0, 8.4]] },
          R('kueche', t('data.demo.room.kueche'), 'kueche', [6.2, 0, 4.2, 3.2], 'stone'),
          R('flur', t('data.demo.room.flur'), 'flur', [6.2, 3.2, 4.2, 1.6], 'tile'),
          R('diele', t('data.demo.room.diele'), 'flur', [4.4, 4.8, 2.4, 3.6], 'tile'),
          R('buero', t('data.demo.room.buero'), 'buero', [6.8, 4.8, 3.6, 3.6], 'ash'),
          R('garage', t('data.demo.room.garage'), 'garage', [10.4, 0, 3.4, 6.2], 'concrete', 'garage'),
          R('garten_s', t('data.demo.room.garten_s'), 'garten', [-6, 8.4, 22, 8], 'lawn', 'outdoor'),
          R('garten_w', t('data.demo.room.garten_w'), 'garten', [-6, -3, 6, 11.4], 'lawn', 'outdoor'),
          { ...R('terrasse', t('data.demo.room.terrasse'), 'garten', [-3.6, 1.2, 3.6, 5.6], 'terrace', 'outdoor'), raise: 0.06 },
          { ...R('einfahrt', t('data.demo.room.einfahrt'), 'garten', [10.4, -6, 3.4, 6], 'paving', 'outdoor'), raise: 0.02 },
          { ...R('weg', t('data.demo.room.weg'), 'garten', [4.5, 8.4, 1.2, 4.2], 'gravel', 'outdoor'), raise: 0.02 },
        ],
        openings: [
          { id: 'eg_o1', type: 'open', from: [6.2, 0.6], to: [6.2, 2.8] },
          { id: 'eg_o2', type: 'door', from: [6.2, 3.5], to: [6.2, 4.4] },
          { id: 'eg_o3', type: 'open', from: [6.6, 3.2], to: [8.4, 3.2] },
          { id: 'eg_o4', type: 'open', from: [4.4, 5.4], to: [4.4, 6.4] },
          { id: 'eg_o5', type: 'door', from: [8.6, 4.8], to: [9.5, 4.8] },
          { id: 'eg_o6', type: 'door', from: [10.4, 3.6], to: [10.4, 4.5] },
          { id: 'eg_o7', type: 'open', from: [6.2, 4.8], to: [6.8, 4.8] },
          { id: 'haustuer', type: 'door', from: [4.6, 8.4], to: [5.6, 8.4], contact: 'binary_sensor.haustuer' },
          { id: 'garagentor', type: 'garage', from: [10.8, 0], to: [13.4, 0], head: 2.2, cover: 'cover.garagentor' },
          { id: 'eg_w1', type: 'window', from: [0, 1.2], to: [0, 3.4], sill: 0.05, head: 2.25, cover: 'cover.wohnzimmer_west' },
          { id: 'eg_w2', type: 'window', from: [1.0, 8.4], to: [3.4, 8.4], sill: 0.05, head: 2.25, cover: 'cover.wohnzimmer_sued', contact: 'binary_sensor.terrassentuer' },
          { id: 'eg_w3', type: 'window', from: [1.6, 0], to: [4.0, 0], sill: 0.9, head: 2.25, cover: 'cover.wohnzimmer_nord' },
          { id: 'eg_w4', type: 'window', from: [7.4, 0], to: [9.4, 0], sill: 1.1, head: 2.25, cover: 'cover.kueche' },
          { id: 'eg_w5', type: 'window', from: [7.6, 8.4], to: [9.6, 8.4], sill: 0.9, head: 2.25 },
          { id: 'eg_w6', type: 'window', from: [13.8, 2.2], to: [13.8, 3.4], sill: 1.4, head: 2.1 },
        ],
        furniture: [
          { id: 'f1', type: 'rug', pos: [2.6, 2.2], width: 3.0, depth: 2.3, color: '#3b4a66' },
          { id: 'f2', type: 'tvBoard', pos: [2.8, 0.3], width: 2.0 },
          { id: 'f3', type: 'cornerSofa', pos: [2.4, 3.6], rot: 180, width: 3.0, depth: 2.0, color: '#7d8597' },
          { id: 'f4', type: 'coffeeTable', pos: [2.6, 2.2] },
          { id: 'f5', type: 'armchair', pos: [4.9, 2.0], rot: -90, color: '#c28a5a' },
          { id: 'f6', type: 'bigPlant', pos: [0.5, 0.5] },
          { id: 'f7', type: 'diningTable', pos: [2.2, 6.6], width: 2.0, chairs: 6 },
          { id: 'f8', type: 'bookshelf', pos: [0.18, 7.2], rot: 90, width: 1.6 },
          { id: 'f10', type: 'kitchen', pos: [8.1, 0.32], width: 2.8 },
          { id: 'f11', type: 'fridge', pos: [9.95, 0.36] },
          { id: 'f12', type: 'kitchenTall', pos: [10.08, 1.3], rot: -90 },
          { id: 'f13', type: 'island', pos: [8.1, 2.0], width: 2.0, depth: 0.9, stools: 3 },
          { id: 'f14', type: 'stairs', pos: [6.25, 6.6], width: 1.0, depth: 3.4, height: 2.85 },
          { id: 'f15', type: 'coatRack', pos: [4.6, 7.5], rot: 90 },
          { id: 'f16', type: 'shoeCabinet', pos: [9.6, 3.36] },
          { id: 'f17', type: 'desk', pos: [8.6, 8.05], rot: 180, width: 1.6, compositionVersion: 1 },
          { id: 'f18', type: 'officeChair', pos: [8.6, 7.35] },
          { id: 'f19', type: 'shelf', pos: [6.98, 6.6], rot: 90, width: 1.4 },
          { id: 'f20', type: 'car', pos: [12.1, 3.1], color: '#355c8c' },
          { id: 'f21', type: 'workbench', pos: [12.1, 5.8], rot: 180, width: 2.2 },
          { id: 'f22', type: 'bike', pos: [10.85, 4.4] },
          { id: 'f23', type: 'gardenSet', pos: [-1.8, 4.0] },
          { id: 'f24', type: 'tree', pos: [-3.5, 12.5], height: 6 },
          { id: 'f25', type: 'conifer', pos: [13, 14], height: 6.5 },
          { id: 'f26', type: 'hedge', pos: [5, 16.1], width: 18 },
          { id: 'f27', type: 'bush', pos: [9.5, 10] },
          { id: 'f28', type: 'raisedBed', pos: [1.5, 13.5], rot: 90 },
          { id: 'f29', type: 'lounger', pos: [3.5, 11.0], rot: 180 },
          { id: 'f30', type: 'umbrella', pos: [2.4, 11.3] },
          { id: 'f31', type: 'heatPump', pos: [14.3, 4.6], rot: -90 },
          { id: 'f32', type: 'bush', pos: [-4.5, -1.5], height: 1.4, width: 1.3 },
        ],
        devices: [
          { id: 'd1', kind: 'light', style: 'downlights', entity_id: 'light.wohnzimmer_decke', pos: [2.6, 2.2] },
          { id: 'd2', kind: 'light', style: 'arc', entity_id: 'light.wohnzimmer_stehlampe', pos: [0.6, 3.6], rot: 90 },
          { id: 'd3', kind: 'light', style: 'pendantTrio', entity_id: 'light.esstisch', pos: [2.2, 6.6], length: 1.6 },
          { id: 'd4', kind: 'tv', entity_id: 'media_player.wohnzimmer_tv', pos: [2.8, 0.3], y: 0.54, length: 1.6 },
          { id: 'd5', kind: 'radiator', style: 'convector', entity_id: 'climate.wohnzimmer', pos: [2.2, 8.05], length: 2.2 },
          { id: 'd6', kind: 'temp', entity_id: 'sensor.wohnzimmer_temperatur', pos: [0.02, 5.8], rot: 90, y: 1.5 },
          { id: 'd7', kind: 'motion', entity_id: 'binary_sensor.bewegung_wohnzimmer', pos: [0.15, 0.15], rot: 45 },
          { id: 'd8', kind: 'vacuum', entity_id: 'vacuum.roby', pos: [5.85, 0.35] },
          { id: 'd9', kind: 'light', style: 'track', entity_id: 'light.kueche_spots', pos: [8.1, 2.0], length: 1.8 },
          { id: 'd10', kind: 'light', style: 'strip', entity_id: 'light.kueche_led', pos: [8.1, 0.36], y: 1.1, length: 2.6 },
          { id: 'd11', kind: 'speaker', entity_id: 'media_player.kueche', pos: [9.2, 0.4], y: 0.9 },
          { id: 'd40', kind: 'speaker', entity_id: 'media_player.esszimmer', pos: [0.35, 5.9], y: 0 },
          { id: 'd41', kind: 'fireplace', entity_id: 'switch.kamin', pos: [0.12, 4.6], rot: 90, length: 1.0 },
          { id: 'd42', kind: 'frame', pos: [0.12, 4.6], rot: 90, y: 1.65, fw: 0.9, fh: 0.6, frame: 'black', src: 'art' },
          { id: 'd43', kind: 'frame', pos: [4.345, 6.6], rot: -90, y: 1.5, fw: 0.7, fh: 0.5, frame: 'oak', passe: true, src: 'folder', folder: 'media-source://media_source/local/Urlaub', interval: 30 },
          { id: 'd44', kind: 'frame', pos: [6.255, 5.2], rot: 90, y: 1.5, fw: 0.42, fh: 0.594, frame: 'none', src: 'art' },
          { id: 'd45', kind: 'washer', entity_id: 'sensor.waschmaschine', pos: [13.45, 1.0], rot: -90 },
          { id: 'd46', kind: 'tv', style: 'monitor', pos: [8.7, 8.25], rot: 180, y: 0.75, length: 0.62 },
          { id: 'd12', kind: 'smoke', entity_id: 'binary_sensor.rauchmelder_flur', pos: [7.5, 4.0] },
          { id: 'd13', kind: 'light', style: 'ceiling', entity_id: 'light.flur_decke', pos: [8.6, 4.0] },
          { id: 'd14', kind: 'motion', entity_id: 'binary_sensor.bewegung_flur', pos: [10.3, 3.3], rot: -45 },
          { id: 'd15', kind: 'light', style: 'pendant', entity_id: 'light.diele', pos: [5.1, 6.0], y: 1.9 },
          { id: 'd16', kind: 'light', style: 'ceiling', entity_id: 'light.garage', pos: [12.1, 3.1] },
          { id: 'd17', kind: 'camera', entity_id: 'camera.einfahrt', pos: [13.6, -0.13], y: 2.4, rot: 180 },
          { id: 'd18', kind: 'light', style: 'outdoorWall', entity_id: 'light.aussen_haustuer', pos: [6.0, 8.53], y: 2.1 },
          { id: 'd19', kind: 'light', style: 'bollard', entity_id: 'light.gartenweg', pos: [4.2, 10.5] },
          { id: 'd20', kind: 'light', style: 'bollard', entity_id: 'light.gartenweg', pos: [6.0, 11.8] },
          { id: 'd21', kind: 'mower', entity_id: 'lawn_mower.rasenmaeher', pos: [-5.2, 15.4] },
          { id: 'd22', kind: 'valve', entity_id: 'valve.bewaesserung', pos: [9, 13] },
          { id: 'd23', kind: 'camera', entity_id: 'camera.garten', pos: [-0.12, 7.8], y: 2.3, rot: -90 },
        ],
      },
      {
        id: 'og', name: t('data.defaults.upperFloor'), floor_id: 'obergeschoss', elevation: 2.85, height: 2.5, cutHeight: 1.2,
        rooms: [
          R('schlafen', t('data.demo.room.schlafen'), 'schlafzimmer', [0, 0, 4.4, 4.8], 'walnut'),
          R('ankleide', t('data.demo.room.ankleide'), 'schlafzimmer', [0, 4.8, 4.4, 3.6], 'carpet'),
          R('bad', t('data.demo.room.bad'), 'bad', [4.4, 0, 2.8, 3.2], 'tileDark'),
          R('flur_og', t('data.demo.room.flur_og'), 'flur', [4.4, 3.2, 6.0, 1.6], 'oak'),
          R('galerie', t('data.demo.room.galerie'), 'flur', [4.4, 4.8, 2.4, 3.6], 'oak'),
          R('kind1', t('data.demo.room.kind1'), 'kinderzimmer', [7.2, 0, 3.2, 3.2], 'ash'),
          R('kind2', t('data.demo.room.kind2'), 'kinderzimmer_2', [6.8, 4.8, 3.6, 3.6], 'ash'),
        ],
        openings: [
          { id: 'og_d1', type: 'door', from: [4.4, 3.5], to: [4.4, 4.4] },
          { id: 'og_d2', type: 'door', from: [5.2, 3.2], to: [6.0, 3.2] },
          { id: 'og_d3', type: 'door', from: [7.5, 3.2], to: [8.4, 3.2] },
          { id: 'og_d4', type: 'door', from: [8.6, 4.8], to: [9.5, 4.8] },
          { id: 'og_o1', type: 'open', from: [3.75, 4.8], to: [4.35, 4.8] },
          { id: 'og_o2', type: 'open', from: [4.4, 4.8], to: [5.7, 4.8] },
          { id: 'og_o3', type: 'open', from: [5.7, 4.8], to: [6.8, 4.8] },
          { id: 'og_w1', type: 'window', from: [0, 1.2], to: [0, 3.4], sill: 0.6, head: 2.2, cover: 'cover.schlafzimmer' },
          { id: 'og_w2', type: 'window', from: [1.2, 0], to: [3.2, 0], sill: 0.9, head: 2.2 },
          { id: 'og_w3', type: 'window', from: [5.2, 0], to: [6.4, 0], sill: 1.4, head: 2.1, contact: 'binary_sensor.bad_fenster' },
          { id: 'og_w4', type: 'window', from: [7.8, 0], to: [9.6, 0], sill: 0.9, head: 2.2, cover: 'cover.kind1' },
          { id: 'og_w5', type: 'window', from: [7.6, 8.4], to: [9.6, 8.4], sill: 0.9, head: 2.2, cover: 'cover.kind2' },
          { id: 'og_w6', type: 'window', from: [10.4, 1.0], to: [10.4, 2.4], sill: 0.9, head: 2.2 },
          { id: 'og_w7', type: 'window', from: [1.0, 8.4], to: [3.0, 8.4], sill: 0.9, head: 2.2 },
        ],
        furniture: [
          { id: 'g1', type: 'bed', pos: [2.2, 3.7], rot: 180, width: 1.8, color: '#7f8fb5' },
          { id: 'g2', type: 'nightstand', pos: [0.95, 4.55], rot: 180 },
          { id: 'g3', type: 'nightstand', pos: [3.45, 4.55], rot: 180 },
          { id: 'g4', type: 'rug', pos: [2.2, 2.6], width: 2.8, depth: 2.2, color: '#5f4f4a' },
          { id: 'g5', type: 'wardrobe', pos: [0.32, 6.6], rot: 90, width: 3.0 },
          { id: 'g6', type: 'wardrobe', pos: [4.08, 6.6], rot: -90, width: 2.4 },
          { id: 'g7', type: 'bathtub', pos: [5.27, 2.78], rot: 180 },
          { id: 'g8', type: 'toilet', pos: [7.0, 0.6], rot: -90 },
          { id: 'g9', type: 'vanity', pos: [4.7, 1.0], rot: 90, width: 1.2 },
          { id: 'g10', type: 'shower', pos: [6.7, 2.7] },
          { id: 'g11', type: 'singleBed', pos: [9.85, 1.6], color: '#d98b8b' },
          { id: 'g12', type: 'desk', pos: [8.0, 0.4], width: 1.2, compositionVersion: 1 },
          { id: 'g13', type: 'singleBed', pos: [9.9, 6.6], color: '#86a37f' },
          { id: 'g14', type: 'shelf', pos: [7.0, 6.6], rot: 90 },
          { id: 'g15', type: 'roundRug', pos: [8.6, 6.6], color: '#4f6e8c' },
          { id: 'g16', type: 'plant', pos: [5.0, 7.9] },
        ],
        devices: [
          { id: 'e1', kind: 'light', style: 'ceiling', entity_id: 'light.schlafzimmer_decke', pos: [2.2, 2.4] },
          { id: 'e2', kind: 'light', style: 'wall', entity_id: 'light.nachttisch_links', pos: [0.9, 4.75], rot: 180, y: 1.1 },
          { id: 'e3', kind: 'light', style: 'wall', entity_id: 'light.nachttisch_rechts', pos: [3.5, 4.75], rot: 180, y: 1.1 },
          { id: 'e4', kind: 'temp', entity_id: 'sensor.schlafzimmer_temperatur', pos: [4.38, 1.5], rot: -90 },
          { id: 'e5', kind: 'radiator', entity_id: 'climate.schlafzimmer', pos: [0.13, 2.3], rot: 90, length: 1.4 },
          { id: 'e6', kind: 'light', style: 'strip', entity_id: 'light.bad_spiegel', pos: [4.47, 1.0], y: 1.95, length: 1.0, rot: 90 },
          { id: 'e7', kind: 'radiator', style: 'towel', entity_id: 'climate.bad', pos: [7.13, 1.8], rot: -90 },
          { id: 'e8', kind: 'light', style: 'ceiling', entity_id: 'light.kind1', pos: [8.8, 1.6] },
          { id: 'e9', kind: 'light', style: 'ceiling', entity_id: 'light.kind2', pos: [8.6, 5.6] },
          { id: 'e10', kind: 'fan', entity_id: 'fan.kind2', pos: [8.6, 7.4] },
          { id: 'e11', kind: 'ac', entity_id: 'climate.schlafzimmer_klima', pos: [3.85, 0.02] },
          { id: 'e12', kind: 'smoke', entity_id: 'binary_sensor.rauchmelder_og', pos: [9.6, 4.0] },
          { id: 'e13', kind: 'light', style: 'downlights', entity_id: 'light.flur_og', pos: [7.4, 4.0] },
          { id: 'e14', kind: 'tv', style: 'monitor', pos: [7.9, 0.2], rot: 0, y: 0.75, length: 0.62 },
        ],
      },
    ],
  });
}

// Cover positions: Home Assistant uses 0 = closed, 100 = open. Some devices report it the other
// way round; openings and roof windows can flag their cover with coverInvert.
export function coverInverted(plan, eid) {
  if (!eid || !plan) return false;
  for (const l of plan.levels) for (const o of l.openings) if (o.cover === eid && o.coverInvert) return true;
  return (plan.site?.roofItems || []).some((r) => r.cover === eid && r.coverInvert);
}
export function coverPercent(st, invert = false) {
  if (!st) return null; const a = st.attributes || {};
  let p = a.current_position; if (p == null) p = ['closed', 'closing'].includes(st.state) ? 0 : ['open', 'opening'].includes(st.state) ? 100 : null;
  if (p == null) return null; return invert ? 100 - p : +p;
}
