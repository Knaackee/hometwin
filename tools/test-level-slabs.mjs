import assert from 'node:assert/strict';
import * as THREE from 'three';

// The procedural texture modules draw during import. Geometry tests only need a canvas-shaped stub.
const gradient = { addColorStop() {} };
const context = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient, measureText: () => ({ width: 0 }) }, { get: (target, key) => target[key] ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };

const { DEFAULT_SLAB, computeElevations, demoPlan, slabThickness } = await import('../frontend/src/plan.js');
const { EXT_T, buildLevel } = await import('../frontend/src/house.js');

const close = (actual, expected, message, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
const room = (id = 'room') => ({ id, name: id, kind: 'room', surface: 'oak', points: [[0, 0], [4, 0], [4, 4], [0, 4]] });
const level = (id, elevation, height, extra = {}) => ({ id, name: id, elevation, height, cutHeight: 1.2, rooms: [room()], openings: [], furniture: [], devices: [], ...extra });

assert.equal(DEFAULT_SLAB, 0.25);
assert.equal(slabThickness({}), DEFAULT_SLAB, 'missing slab uses the shared default');
assert.equal(slabThickness({ slab: 0.38 }), 0.38, 'custom slab is preserved');
assert.equal(slabThickness({ slab: 0 }), 0, 'zero slab is supported');

const basement = level('basement', -3, 2.7, { autoElevation: false });
const ground = level('ground', 0, 2.6, { slab: 0.3 });
const upper = level('upper', 3, 2.5);
const manual = level('manual', 8.125, 2.4, { slab: 0.4, autoElevation: false });
const plan = { levels: [manual, upper, ground, basement] };
computeElevations(plan);
assert.deepEqual(plan.levels.map((item) => item.id), ['basement', 'ground', 'upper', 'manual'], 'basement-to-top order is retained');
close(ground.elevation, 0, 'custom ground slab joins the basement wall top');
close(upper.elevation, 2.85, 'default upper slab joins the ground wall top');
close(upper.elevation - slabThickness(upper), ground.elevation + ground.height, 'plate bottom meets lower wall top');
close(manual.elevation, 8.125, 'manual elevation is preserved');
assert.equal(Object.hasOwn(upper, 'slab'), false, 'default resolution does not rewrite user data');

const demo = demoPlan();
for (const [levelId, deskId, monitorId, expected] of [
  ['eg', 'f17', 'd46', { pos: [8.7, 8.25], rot: 180 }],
  ['og', 'g12', 'e14', { pos: [7.9, 0.2], rot: 0 }],
]) {
  const demoLevel = demo.levels.find((item) => item.id === levelId);
  const desk = demoLevel.furniture.find((item) => item.id === deskId);
  const monitor = demoLevel.devices.find((item) => item.id === monitorId);
  assert.ok(desk && monitor, `${levelId} desk and standalone monitor exist`);
  assert.deepEqual(monitor.pos, expected.pos, `${monitorId} uses the transformed desk-local monitor position`);
  assert.equal(monitor.rot, expected.rot, `${monitorId} follows the desk rotation`);
  assert.equal(monitor.kind, 'tv'); assert.equal(monitor.style, 'monitor');
  assert.equal(Object.hasOwn(monitor, 'entity_id'), false, `${monitorId} starts unbound`);
  assert.equal(Object.hasOwn(desk, 'monitor'), false, `${deskId} has no embedded monitor setting`);
}

function meshBounds(object) {
  const box = new THREE.Box3().setFromObject(object, true);
  return { min: box.min, max: box.max };
}
function plate(levelObject, depth) {
  return levelObject.group.children.find((child) => {
    if (!child.isMesh || child.userData.room) return false;
    const { min, max } = meshBounds(child);
    return Math.abs(min.y + depth) < 1e-6 && Math.abs(max.y) < 1e-6 && max.x - min.x > 3.9 && max.z - min.z > 3.9;
  });
}

const defaultBuilt = buildLevel(level('default', 0, 2.6));
const defaultPlate = plate(defaultBuilt, DEFAULT_SLAB);
assert.ok(defaultPlate, 'default floor plate spans from -0.25 m to local 0');
assert.ok(new THREE.Raycaster(new THREE.Vector3(2, 0.1, 2), new THREE.Vector3(0, -1, 0), 0, 1).intersectObject(defaultPlate, false).length, 'no-void plate keeps its top face');
assert.ok(new THREE.Raycaster(new THREE.Vector3(2, -0.35, 2), new THREE.Vector3(0, 1, 0), 0, 1).intersectObject(defaultPlate, false).length, 'no-void plate keeps its underside');
assert.ok(new THREE.Raycaster(new THREE.Vector3(-0.5, -0.125, 2), new THREE.Vector3(1, 0, 0), 0, 1).intersectObject(defaultPlate, false).length, 'no-void plate keeps its exterior side');

const customLevel = level('custom', 0, 2.6, { slab: 0.4 });
customLevel.rooms.push({ id: 'stairwell', name: 'Stairwell', kind: 'void', points: [[1.5, 1.5], [2.5, 1.5], [2.5, 2.5], [1.5, 2.5]] });
const customBuilt = buildLevel(customLevel);
const customPlate = plate(customBuilt, 0.4);
assert.ok(customPlate, 'custom floor plate spans from -0.4 m to local 0');

const down = new THREE.Vector3(0, -1, 0);
const stairRay = new THREE.Raycaster(new THREE.Vector3(2, 0.1, 2), down, 0, 1);
assert.equal(stairRay.intersectObject(customPlate, false).length, 0, 'floor plate does not fill the stair void');
const floorRay = new THREE.Raycaster(new THREE.Vector3(0.5, 0.1, 0.5), down, 0, 1);
assert.ok(floorRay.intersectObject(customPlate, false).length > 0, 'floor plate remains around the stair void');

// At the joining band, an outside-in ray must hit the exterior plate face before the room edge.
const seamRay = new THREE.Raycaster(new THREE.Vector3(-1, -0.2, 2), new THREE.Vector3(1, 0, 0), 0, 2);
const seamHit = seamRay.intersectObject(customBuilt.group, true)[0];
assert.ok(seamHit, 'exterior storey seam is closed');
close(seamHit.point.x, -EXT_T / 2, 'exterior plate reaches the wall face', 1e-4);

console.log('level slab tests passed');
