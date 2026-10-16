// Wall-aware placement: furniture is pushed out of walls, wall-mounted devices snap flush
// to the nearest wall face and turn to face the room.
import { edges, pointInPolygon, distToSeg } from './geometry.js';
import { furnitureParams, FURNITURE } from './furniture.js';
import { EXT_T, INT_T } from './house.js';

export const wallCfg = { on: true };

const isWallRoom = (r) => !r.kind || r.kind === 'room' || r.kind === 'garage';

// Wall segments of a level as [{a, b, ux, uz, nx, nz, len, ht}], with door/passage gaps removed.
export function wallSegments(level) {
  const rooms = level.rooms.filter(isWallRoom); const out = []; const seen = new Set();
  const inside = (p) => rooms.some((r) => pointInPolygon(p, r.points));
  for (const r of rooms) for (const [a, b] of edges(r.points)) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.05) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len, nx = -uz, nz = ux;
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const key = [Math.round(m[0] * 50), Math.round(m[1] * 50), Math.round(Math.abs(ux) * 50)].join(':'); if (seen.has(key)) continue; seen.add(key);
    const interior = inside([m[0] + nx * 0.08, m[1] + nz * 0.08]) && inside([m[0] - nx * 0.08, m[1] - nz * 0.08]);
    const ht = (interior ? INT_T : EXT_T) / 2;
    // cut out doors, passages and garage doors on this edge
    const gaps = level.openings.filter((o) => o.type !== 'window' && distToSeg(o.from, a, b) < 0.03 && distToSeg(o.to, a, b) < 0.03)
      .map((o) => { const t1 = (o.from[0] - a[0]) * ux + (o.from[1] - a[1]) * uz, t2 = (o.to[0] - a[0]) * ux + (o.to[1] - a[1]) * uz; return [Math.min(t1, t2), Math.max(t1, t2)]; }).sort((p, q) => p[0] - q[0]);
    let t = 0;
    for (const [g0, g1] of [...gaps, [len, len]]) {
      if (g0 - t > 0.02) out.push({ a: [a[0] + ux * t, a[1] + uz * t], b: [a[0] + ux * g0, a[1] + uz * g0], ux, uz, nx, nz, len: g0 - t, ht });
      t = Math.max(t, g1);
    }
  }
  return out;
}

// Oriented footprint of a furniture item: centre, half extents and axes in plan space.
function footprint(item) {
  const p = furnitureParams(item); const th = ((item.rot || 0) * Math.PI) / 180;
  return { c: [...item.pos], hw: (p.w || 0.5) / 2, hd: (p.d || 0.5) / 2, X: [Math.cos(th), -Math.sin(th)], Z: [Math.sin(th), Math.cos(th)] };
}

// Pushes a furniture item out of every wall it overlaps. Returns the corrected position.
export function resolveFurniture(level, item, segs = wallSegments(level)) {
  const def = FURNITURE[item.type]; if (!wallCfg.on || !def || def.flat || item.type === 'stairs') return item.pos;
  const f = footprint(item);
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const s of segs) {
      const dx = f.c[0] - s.a[0], dz = f.c[1] - s.a[1];
      const sn = dx * s.nx + dz * s.nz, su = dx * s.ux + dz * s.uz;
      const en = f.hw * Math.abs(f.X[0] * s.nx + f.X[1] * s.nz) + f.hd * Math.abs(f.Z[0] * s.nx + f.Z[1] * s.nz);
      const eu = f.hw * Math.abs(f.X[0] * s.ux + f.X[1] * s.uz) + f.hd * Math.abs(f.Z[0] * s.ux + f.Z[1] * s.uz);
      if (su + eu < 0.01 || su - eu > s.len - 0.01) continue; // no overlap along the wall
      const need = en + s.ht + 0.005; if (Math.abs(sn) >= need) continue;
      const push = (sn >= 0 ? 1 : -1) * (need - Math.abs(sn));
      f.c[0] += s.nx * push; f.c[1] += s.nz * push; moved = true;
    }
    if (!moved) break;
  }
  return [Math.round(f.c[0] * 1000) / 1000, Math.round(f.c[1] * 1000) / 1000];
}

const WALL_KINDS = new Set(['temp', 'thermostat', 'plug', 'camera', 'ac']);
export function isWallMounted(dev) {
  if (WALL_KINDS.has(dev.kind)) return true;
  if (dev.kind === 'light') return ['wall', 'outdoorWall'].includes(dev.style);
  if (dev.kind === 'radiator') return (dev.style || 'panel') !== 'convector';
  return false;
}
// Snaps a wall-mounted device to the nearest wall face (within reach) on the pointer's side.
// Returns { pos, rot } or null when no wall is close.
export function snapToWall(level, p, reach = 0.9, segs = wallSegments(level)) {
  if (!wallCfg.on) return null;
  let best = null, bd = reach;
  for (const s of segs) { const d = distToSeg(p, s.a, s.b); if (d < bd) { bd = d; best = s; } }
  if (!best) return null;
  const s = best, t = Math.max(0.1, Math.min(s.len - 0.1, (p[0] - s.a[0]) * s.ux + (p[1] - s.a[1]) * s.uz));
  const side = (p[0] - s.a[0]) * s.nx + (p[1] - s.a[1]) * s.nz >= 0 ? 1 : -1;
  const nx = s.nx * side, nz = s.nz * side;
  const pos = [s.a[0] + s.ux * t + nx * s.ht, s.a[1] + s.uz * t + nz * s.ht];
  return { pos: pos.map((v) => Math.round(v * 1000) / 1000), rot: Math.round((Math.atan2(nx, nz) * 180) / Math.PI) };
}
// Applies the right rule for any item; mutates pos/rot.
export function placeItem(level, type, item, segs) {
  if (type === 'furniture') item.pos = resolveFurniture(level, item, segs);
  else if (type === 'device' && isWallMounted(item)) { const s = snapToWall(level, item.pos, 0.9, segs); if (s) { item.pos = s.pos; item.rot = s.rot; } }
  return item;
}
