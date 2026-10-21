import * as THREE from 'three';
import { wallSegments } from './house.js';

export const WALK_RADIUS = 0.18;
const EPS = 1e-5;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function openingClear(opening, level, floorY, bodyHeight) {
  if (!opening) return false;
  const bottom = opening.type === 'window' ? (opening.sill ?? 0.9) : 0;
  const top = Math.min(opening.head ?? (opening.type === 'window' ? 2.2 : opening.type === 'open' ? 2.3 : 2.1), level.height);
  const feet = floorY - level.elevation;
  return feet >= bottom - EPS && feet + bodyHeight <= top + EPS;
}

function wallObstacles(plan, floorY, bodyHeight) {
  const obstacles = [];
  for (const level of plan.levels || []) {
    if (floorY + bodyHeight <= level.elevation + EPS || floorY >= level.elevation + level.height - EPS) continue;
    for (const segment of wallSegments(level)) {
      if (openingClear(segment.opening, level, floorY, bodyHeight)) continue;
      const { l } = segment;
      obstacles.push({
        ax: l.ux * segment.a + l.nx * l.off,
        az: l.uz * segment.a + l.nz * l.off,
        bx: l.ux * segment.b + l.nx * l.off,
        bz: l.uz * segment.b + l.nz * l.off,
        halfWidth: segment.kind === 'exterior' ? 0.12 : 0.06
      });
    }
  }
  return obstacles;
}

function penetration(point, wall, radius, origin) {
  const vx = wall.bx - wall.ax, vz = wall.bz - wall.az, d2 = vx * vx + vz * vz || 1;
  const t = clamp(((point.x - wall.ax) * vx + (point.z - wall.az) * vz) / d2, 0, 1);
  const qx = wall.ax + vx * t, qz = wall.az + vz * t, dx = point.x - qx, dz = point.z - qz;
  const distance = Math.hypot(dx, dz), limit = radius + wall.halfWidth;
  if (distance >= limit - EPS) return null;
  if (t > EPS && t < 1 - EPS) {
    const length = Math.sqrt(d2), nx = -vz / length, nz = vx / length;
    const side = (origin.x - wall.ax) * nx + (origin.z - wall.az) * nz;
    if (Math.abs(side) > EPS) return { depth: limit - (point.x - qx) * Math.sign(side) * nx - (point.z - qz) * Math.sign(side) * nz, nx: Math.sign(side) * nx, nz: Math.sign(side) * nz };
  }
  if (distance > EPS) return { depth: limit - distance, nx: dx / distance, nz: dz / distance };
  const length = Math.hypot(vx, vz) || 1;
  return { depth: limit, nx: -vz / length, nz: vx / length };
}

// Swept circle movement against the same segmented walls/openings used by buildLevel().
// Small frame steps cannot tunnel through the expanded wall; projection preserves tangential slide.
export function moveWithWallCollisions(plan, from, delta, { floorY = 0, bodyHeight = 1.75, radius = WALK_RADIUS } = {}) {
  const walls = wallObstacles(plan, floorY, bodyHeight);
  const point = { x: from.x + delta.x, z: from.z + delta.z };
  for (let pass = 0; pass < 4; pass++) {
    let deepest = null;
    for (const wall of walls) {
      const hit = penetration(point, wall, radius, from);
      if (hit && (!deepest || hit.depth > deepest.depth)) deepest = hit;
    }
    if (!deepest) break;
    point.x += deepest.nx * (deepest.depth + EPS); point.z += deepest.nz * (deepest.depth + EPS);
  }
  return point;
}

function floorTargets(stage) {
  const targets = [], owners = new Map();
  for (const [levelId, built] of stage.levels || []) {
    built.group?.updateWorldMatrix?.(true, true);
    for (const mesh of Object.values(built.house?.floors || {})) { targets.push(mesh); owners.set(mesh, levelId); }
  }
  if (stage.ground) { stage.ground.updateWorldMatrix?.(true, false); targets.push(stage.ground); owners.set(stage.ground, null); }
  return { targets, owners };
}

export function walkSupportAt(stage, x, z, maxY) {
  const { targets, owners } = floorTargets(stage); if (!targets.length) return null;
  const ray = new THREE.Raycaster(new THREE.Vector3(x, maxY, z), new THREE.Vector3(0, -1, 0), 0, 500);
  const hit = ray.intersectObjects(targets, false)[0];
  return hit ? { y: hit.point.y, levelId: owners.get(hit.object) ?? null, object: hit.object } : null;
}

function ceilingAt(stage, x, z, minY) {
  const ceilings = [];
  for (const built of stage.levels?.values?.() || []) {
    built.group?.updateWorldMatrix?.(true, true);
    built.house?.group?.traverse?.(mesh => { if (mesh.isMesh && mesh.userData.blocker && mesh.material?.colorWrite !== false) ceilings.push(mesh); });
  }
  if (!ceilings.length) return null;
  const ray = new THREE.Raycaster(new THREE.Vector3(x, minY, z), new THREE.Vector3(0, 1, 0), 0, 500);
  return ray.intersectObjects(ceilings, false)[0]?.point.y ?? null;
}

export function clampWalkVertical(stage, walk, targetY) {
  if (targetY < walk.floorY) {
    const support = walkSupportAt(stage, walk.x, walk.z, walk.floorY + 0.05);
    return support && targetY < support.y ? support.y : targetY;
  }
  if (targetY > walk.floorY) {
    const ceiling = ceilingAt(stage, walk.x, walk.z, walk.floorY + walk.body - 0.02);
    return ceiling !== null && targetY + walk.body > ceiling ? ceiling - walk.body : targetY;
  }
  return targetY;
}

export function applyWalkGravity(stage, walk, dt) {
  const step = Math.max(0, Math.min(0.05, dt));
  walk.velocityY = Math.max(-12, (walk.velocityY || 0) - 9.81 * step);
  const target = walk.floorY + walk.velocityY * step;
  const support = walkSupportAt(stage, walk.x, walk.z, walk.floorY + 0.08);
  if (support && target <= support.y + EPS) {
    walk.floorY = support.y; walk.velocityY = 0;
    return { landed: true, support };
  }
  walk.floorY = target;
  return { landed: false, support };
}
