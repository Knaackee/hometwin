import { furnitureParams, stairInfo } from './furniture.js';
import { roomAt, stairTargetLevel } from './plan.js';
import { pointInPolygon } from './geometry.js';

const APRON = 0.45;
const BODY_RADIUS = 0.18;
export const STAIR_HEIGHT_TOLERANCE = 0.08;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const unit = (a, b) => { const d = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / d, z: (b.z - a.z) / d }; };

function localPoints(p) {
  const shape = p.shape || 'straight', hw = p.w / 2, hd = p.d / 2;
  if (!['straight', 'quarter', 'half'].includes(shape)) return null;
  if (shape === 'straight') return [{ x: 0, z: hd, y: 0 }, { x: 0, z: -hd, y: p.h }];
  const { n, rise, fw } = stairInfo(p), sgn = p.turn === 'left' ? -1 : 1;
  const firstX = sgn > 0 ? -hw + fw / 2 : hw - fw / 2;
  const landingZ = -hd + fw / 2;
  if (shape === 'quarter') {
    const run1 = p.d - fw, run2 = p.w - fw;
    const n1 = Math.max(1, Math.round((n - 1) * run1 / (run1 + run2)));
    const landingY = Math.min(p.h, (n1 + 1) * rise);
    const secondX = firstX + sgn * fw / 2;
    return [{ x: firstX, z: hd, y: 0 }, { x: firstX, z: -hd + fw, y: landingY }, { x: firstX, z: landingZ, y: landingY }, { x: secondX, z: landingZ, y: landingY }, { x: sgn * hw, z: landingZ, y: p.h }];
  }
  const n1 = Math.floor((n - 1) / 2), landingY = Math.min(p.h, (n1 + 1) * rise);
  return [{ x: firstX, z: hd, y: 0 }, { x: firstX, z: -hd + fw, y: landingY }, { x: -firstX, z: -hd + fw, y: landingY }, { x: -firstX, z: hd, y: p.h }];
}

function finishRoute(points) {
  let s = 0;
  points[0].s = 0;
  for (let i = 1; i < points.length; i++) { s += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z); points[i].s = s; }
  return { points, length: s, bottomS: APRON, topS: s - APRON };
}

export function stairRoute(plan, lower, stair) {
  const upper = stairTargetLevel(plan, lower, stair);
  if (!upper) return null;
  const next = [...plan.levels].filter(l => l.elevation > lower.elevation).sort((a, b) => a.elevation - b.elevation)[0];
  if (next !== upper) return null;
  if (!Array.isArray(stair.pos) || stair.pos.length !== 2 || !stair.pos.every(Number.isFinite)) return null;
  const p = furnitureParams(stair), local = localPoints(p), lift = Number(stair.elevation) || 0;
  const gap = upper.elevation - lower.elevation;
  if (!local || !Number.isFinite(p.w) || !Number.isFinite(p.d) || !Number.isFinite(p.h) || p.w <= 0 || p.d <= 0 || p.h <= 0) return null;
  if (Math.abs(lift) > STAIR_HEIGHT_TOLERANCE || Math.abs(p.h - gap) > STAIR_HEIGHT_TOLERANCE) return null;
  const width = (p.shape || 'straight') === 'straight' ? p.w : stairInfo(p).fw;
  if (!Number.isFinite(width) || width <= BODY_RADIUS * 2 || !local.every(q => Number.isFinite(q.x) && Number.isFinite(q.z) && Number.isFinite(q.y))) return null;
  const th = ((stair.rot || 0) * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
  const world = local.map(q => ({ x: stair.pos[0] + q.x * c + q.z * sn, z: stair.pos[1] - q.x * sn + q.z * c, y: q.y }));
  const first = unit(world[0], world[1]), last = unit(world.at(-2), world.at(-1));
  world.unshift({ x: world[0].x - first.x * APRON, z: world[0].z - first.z * APRON, y: 0 });
  world.push({ x: world.at(-1).x + last.x * APRON, z: world.at(-1).z + last.z * APRON, y: gap });
  const supported = (level, q) => roomAt(level, [q.x, q.z]) && !(level.rooms || []).some(r => r.kind === 'void' && pointInPolygon([q.x, q.z], r.points));
  if (!supported(lower, world[0]) || !supported(upper, world.at(-1))) return null;
  return { ...finishRoute(world), lower, upper, stair, width, gap };
}

export function stairRoutes(plan) {
  const routes = [];
  for (const lower of plan.levels) for (const stair of lower.furniture || []) {
    if (stair.type !== 'stairs') continue;
    const route = stairRoute(plan, lower, stair); if (route) routes.push(route);
  }
  return routes;
}

function crossesVoid(level, from, to) {
  const holes = (level.rooms || []).filter(r => r.kind === 'void'); if (!holes.length) return false;
  const inside = p => holes.some(r => pointInPolygon([p.x, p.z], r.points));
  if (inside(from) && !inside(to)) return false;
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.08));
  for (let i = 1; i <= n; i++) if (inside({ x: from.x + (to.x - from.x) * i / n, z: from.z + (to.z - from.z) * i / n })) return true;
  return false;
}

export function guardStairwellMove(level, from, to) {
  if (!crossesVoid(level, from, to)) return to;
  const xOnly = { x: to.x, z: from.z }; if (!crossesVoid(level, from, xOnly)) return xOnly;
  const zOnly = { x: from.x, z: to.z }; return crossesVoid(level, from, zOnly) ? from : zOnly;
}

function pointAt(route, s) {
  s = clamp(s, 0, route.length);
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i];
    if (s > b.s && i < route.points.length - 1) continue;
    const d = b.s - a.s || 1, t = clamp((s - a.s) / d, 0, 1), tangent = unit(a, b);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, tangent };
  }
  return null;
}

function entry(route, at, motion, upper) {
  const i = upper ? route.points.length - 1 : 1, a = route.points[i - 1], b = route.points[i], tangent = unit(a, b);
  const vx = b.x - a.x, vz = b.z - a.z, d2 = vx * vx + vz * vz || 1;
  const t = clamp(((at.x - a.x) * vx + (at.z - a.z) * vz) / d2, 0, 1);
  const x = a.x + vx * t, z = a.z + vz * t, nx = -tangent.z, nz = tangent.x;
  const lateral = (at.x - x) * nx + (at.z - z) * nz, distance = Math.hypot(at.x - x, at.z - z);
  const toward = (motion.x * tangent.x + motion.z * tangent.z) * (upper ? -1 : 1), speed = Math.hypot(motion.x, motion.z);
  if (distance > route.width / 2 || speed < 1e-6 || toward < speed * 0.35) return null;
  const limit = Math.max(0, route.width / 2 - BODY_RADIUS);
  return { route, s: a.s + (b.s - a.s) * t, lateral: clamp(lateral, -limit, limit), direction: upper ? -1 : 1, levelId: upper ? route.upper.id : route.lower.id };
}

export function enterStair(plan, levelId, at, motion) {
  for (const route of stairRoutes(plan)) {
    const nav = route.lower.id === levelId ? entry(route, at, motion, false) : route.upper.id === levelId ? entry(route, at, motion, true) : null;
    if (nav) return nav;
  }
  return null;
}

export function advanceStair(nav, forward, sideways) {
  const r = nav.route, limit = Math.max(0, r.width / 2 - BODY_RADIUS);
  const controlDirection = nav.controlDirection ?? nav.direction;
  nav.s = clamp(nav.s + forward * controlDirection, 0, r.length);
  nav.lateral = clamp(nav.lateral + sideways * controlDirection, -limit, limit);
  if (nav.levelId === r.lower.id && nav.s >= r.topS) nav.levelId = r.upper.id;
  else if (nav.levelId === r.upper.id && nav.s <= r.bottomS) nav.levelId = r.lower.id;
  const p = pointAt(r, nav.s), nx = -p.tangent.z, nz = p.tangent.x;
  const done = (nav.levelId === r.upper.id && nav.s >= r.length) || (nav.levelId === r.lower.id && nav.s <= 0);
  return { nav: done ? null : nav, levelId: nav.levelId, x: p.x + nx * nav.lateral, z: p.z + nz * nav.lateral, floorY: r.lower.elevation + p.y };
}

// Project current camera-relative movement onto the flight; never retain an entry-time key direction.
export function advanceStairMotion(nav, motion) {
  let p = pointAt(nav.route, nav.s);
  const ahead = pointAt(nav.route, nav.s + 1e-6);
  if (motion.x * ahead.tangent.x + motion.z * ahead.tangent.z > 1e-6
      && Math.abs(motion.x * p.tangent.x + motion.z * p.tangent.z) < 1e-6) p = {...p, tangent:ahead.tangent};
  const t = p.tangent;
  const forward = motion.x * t.x + motion.z * t.z;
  const sideways = motion.x * -t.z + motion.z * t.x;
  const r = nav.route;
  if ((nav.s <= r.bottomS || nav.s >= r.topS) && Math.abs(sideways) > Math.abs(forward)) {
    const level = nav.s <= r.bottomS ? r.lower : r.upper;
    const x = p.x - t.z * nav.lateral + motion.x, z = p.z + t.x * nav.lateral + motion.z;
    if (roomAt(level, [x,z]) && !(level.rooms || []).some(room => room.kind === 'void' && pointInPolygon([x,z], room.points))) {
      return { nav:null, levelId:level.id, x, z, floorY:level.elevation };
    }
  }
  return advanceStair({...nav, controlDirection:1}, forward, sideways);
}
