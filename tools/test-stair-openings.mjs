import assert from 'node:assert/strict';
import * as THREE from 'three';

const gradient = { addColorStop() {} };
const context = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient, measureText: () => ({ width: 0 }) }, { get: (target, key) => target[key] ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };

const { stairTargetLevel, syncStairVoids } = await import('../frontend/src/plan.js');
const { buildLevel, wallSegments } = await import('../frontend/src/house.js');

const room = (id, points) => ({ id, name: id, kind: 'room', surface: 'oak', points });
const level = (id, elevation, rooms = []) => ({ id, name: id, elevation, height: 2.6, cutHeight: 1.2, rooms, openings: [], furniture: [], devices: [] });
const rayHits = (object, [x, y, z], [dx, dy, dz], far = 5) => new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, dy, dz), 0, far).intersectObject(object, true).length > 0;
const rayHitsAny = (objects, [x, y, z], [dx, dy, dz], far = 5) => new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, dy, dz), 0, far).intersectObjects(objects, false).length > 0;
const floorPlates = (built) => built.group.children.filter((child) => {
  if (!child.isMesh || child.userData.room) return false;
  const bounds = new THREE.Box3().setFromObject(child, true);
  return bounds.min.y < -0.2 && Math.abs(bounds.max.y) < 1e-6;
});

/* ---------- plan compatibility and manual opening behavior ---------- */
{
  const lower = level('lower', 0), upper = level('upper', 2.85), roof = level('roof', 5.7);
  const stair = { id: 'stairs', type: 'stairs', pos: [1, 1], width: 1, depth: 2, rot: 0 };
  lower.furniture.push(stair); const plan = { levels: [roof, lower, upper] };
  assert.equal(stairTargetLevel(plan, lower, stair), upper, 'unset target resolves to the next higher level');
  syncStairVoids(plan); const opening = upper.rooms.find((r) => r.stair === stair.id);
  assert.ok(opening, 'automatic stairwell is created on the next higher level');

  opening.points[0][0] += 0.25; const edited = structuredClone(opening.points);
  syncStairVoids(plan);
  assert.equal(stair.openingMode, 'manual', 'an edited legacy signature migrates to manual mode');
  assert.deepEqual(opening.points, edited, 'legacy edited geometry is preserved');

  stair.pos = [2, 2]; stair.rot = 90; syncStairVoids(plan);
  assert.deepEqual(opening.points[0], [0.95, 2.3], 'manual shape follows Three.js stair translation and rotation');
  const moved = structuredClone(opening.points);

  stair.targetLevelId = null; syncStairVoids(plan);
  assert.equal(upper.rooms.some((r) => r.stair === stair.id), false, 'disabled connection removes the active cut');
  stair.targetLevelId = undefined; syncStairVoids(plan);
  assert.deepEqual(upper.rooms.find((r) => r.stair === stair.id).points, moved, 'manual shape survives disabling and restoring the connection');

  stair.openingMode = 'auto'; syncStairVoids(plan);
  assert.notDeepEqual(upper.rooms.find((r) => r.stair === stair.id).points, moved, 'reset to automatic regenerates the opening');
  stair.targetLevelId = roof.id;
  assert.equal(stairTargetLevel(plan, lower, stair), null, 'a skipped or stale target is rejected');
}

/* ---------- polygon subtraction across boundaries ---------- */
{
  const a = room('a', [[0, 0], [2, 0], [2, 4], [0, 4]]), b = room('b', [[2, 0], [4, 0], [4, 4], [2, 4]]);
  const opening = { id: 'void', name: 'void', kind: 'void', surface: 'oak', points: [[1.5, 1], [2.5, 1], [2.5, 3], [1.5, 3]] };
  const built = buildLevel(level('split', 0, [a, b, opening]));
  assert.equal(rayHits(built.floors.a, [1.75, 0.2, 2], [0, -1, 0]), false, 'cross-room opening cuts the first room');
  assert.equal(rayHits(built.floors.b, [2.25, 0.2, 2], [0, -1, 0]), false, 'cross-room opening cuts the second room');
  assert.equal(rayHits(built.floors.a, [0.5, 0.2, 2], [0, -1, 0]), true, 'floor remains outside the opening');
  const plates = floorPlates(built);
  assert.equal(plates.length, 2, 'each room keeps one floor plate');
  assert.equal(rayHitsAny(plates, [1.75, -0.125, 2], [-1, 0, 0], 0.4), true, 'first room plate closes the cross-room opening edge');
  assert.equal(rayHitsAny(plates, [2.25, -0.125, 2], [1, 0, 0], 0.4), true, 'second room plate closes the cross-room opening edge');
  assert.equal(rayHitsAny([plates[0]], [0.1, -0.125, 0.5], [1, 0, 0], 1.8), false, 'clipping triangulation does not create internal side faces');
  const walls = wallSegments(level('walls', 0, [a, b, opening]));
  assert.equal(walls.some((s) => Math.abs(s.l.off + 2) < 0.01 && s.a < 2 && s.b > 2), false, 'interior wall is removed across the stair exit');
  assert.equal(walls.some((s) => Math.abs(Math.abs(s.l.off) - 1.5) < 0.01 && s.a < 2 && s.b > 2), false, 'the void boundary does not create a full-height wall');
}

{
  const concave = room('concave', [[0, 0], [4, 0], [4, 1.5], [1.5, 1.5], [1.5, 4], [0, 4]]);
  const diamond = [[0.4, 1.5], [1.5, 0.4], [2.6, 1.5], [1.5, 2.6]];
  const built = buildLevel(level('concave', 0, [concave, { id: 'void', name: 'void', kind: 'void', surface: 'oak', points: diamond }]));
  assert.equal(rayHits(built.floors.concave, [1, 0.2, 1], [0, -1, 0]), false, 'rotated boundary opening cuts a concave room');
  assert.equal(rayHits(built.floors.concave, [0.3, 0.2, 3], [0, -1, 0]), true, 'concave room remains outside the cut');
}

{
  const r = room('covered', [[0, 0], [2, 0], [2, 2], [0, 2]]), covering = [[-1, -1], [3, -1], [3, 3], [-1, 3]];
  const built = buildLevel(level('covered', 0, [r, { id: 'void', name: 'void', kind: 'void', surface: 'oak', points: covering }]));
  assert.equal(rayHits(built.floors.covered, [1, 0.2, 1], [0, -1, 0]), false, 'an opening covering the entire room leaves no floor');
}

{
  const r = room('ceiling', [[0, 0], [4, 0], [4, 4], [0, 4]]), hole = [[1, 1], [3, 1], [3, 3], [1, 3]];
  const built = buildLevel(level('ceiling', 0, [r]), {}, { ceilingHoles: [hole] });
  assert.equal(rayHits(built.group, [2, 2.5, 2], [0, 1, 0], 0.3), false, 'ceiling opening is cut above the lower stair');
  assert.equal(rayHits(built.group, [0.5, 2.5, 0.5], [0, 1, 0], 0.3), true, 'ceiling remains outside the opening');
  const visible = buildLevel(level('visible-ceiling', 0, [r]), {}, { visibleCeilings: true });
  const ceiling = visible.group.children.find((child) => child.userData.blocker);
  assert.equal(ceiling.material.polygonOffset, true, 'walkthrough ceiling finish offsets coincident upper slab pixels');
  assert.equal(ceiling.material.polygonOffsetFactor, -1);
  assert.equal(ceiling.material.polygonOffsetUnits, -1);
}

{
  const lower=level('legacy-lower',0), upper=level('legacy-upper',2.85);
  lower.furniture.push({id:'legacy',type:'stairs',pos:[0,0]});
  const points=[[-.3,-1],[.4,-1],[.8,1],[-.4,1]];
  upper.rooms.push({id:'legacy-hole',kind:'void',stair:'legacy',points:structuredClone(points)});
  syncStairVoids({levels:[lower,upper]});
  assert.deepEqual(upper.rooms[0].points,points,'an unsigned legacy opening is preserved');
  assert.equal(lower.furniture[0].openingMode,'manual');
}
console.log('stair opening tests passed');
