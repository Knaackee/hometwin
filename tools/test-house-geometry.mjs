import assert from 'node:assert/strict';
import * as THREE from 'three';

// Texture modules draw during import; geometry tests only need a canvas-shaped stub.
const gradient = { addColorStop() {} };
const context = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient, measureText: () => ({ width: 0 }) }, { get: (target, key) => target[key] ?? (() => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };

const { DEFAULT_SLAB, DEFAULT_ROOM_HEIGHT, DEFAULT_BASEMENT_HEIGHT, DEFAULT_PLINTH, applyOps, computeElevations, fitNewLevel, plinthHeight, slabThickness, terrainOf } = await import('../frontend/src/plan.js');
const { EXT_T, INT_T, buildLevel } = await import('../frontend/src/house.js');

const close = (actual, expected, message, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
const rect = (id, x0, z0, x1, z1, kind = 'room') => ({ id, name: id, kind, surface: 'oak', points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });
const level = (id, elevation, height, extra = {}) => ({ id, name: id, elevation, height, cutHeight: 1.2, rooms: [rect('r' + id, 0, 0, 4, 4)], openings: [], furniture: [], devices: [], ...extra });

/* ---------- terrain and the storey standing on it ---------- */
{
  const eg = level('eg', 0, 2.6), og = level('og', 2.85, 2.5), kg = level('kg', -2.65, 2.4);
  assert.deepEqual(terrainOf({ levels: [eg, og] }), { y: 0, groundId: 'eg' }, 'ground floor stands on the terrain');
  assert.deepEqual(terrainOf({ levels: [kg, eg, og] }), { y: 0, groundId: 'eg' }, 'a basement is below the terrain');
  assert.deepEqual(terrainOf({ levels: [level('hp', 0.6, 2.6)] }), { y: 0, groundId: 'hp' }, 'raised ground floor keeps the terrain at ±0');
  assert.equal(terrainOf({ levels: [eg], site: { terrain: -0.4 } }).y, -0.4, 'explicit terrain wins');
  assert.equal(terrainOf({ levels: [] }).groundId, null);
  assert.equal(plinthHeight({}), DEFAULT_PLINTH); assert.equal(plinthHeight({ facade: { plinthHeight: 0.5 } }), 0.5);
}

/* ---------- fitting a new storey (assistant) ---------- */
{
  const only = fitNewLevel({ levels: [] }, { elevation: 0, height: 2.55 });
  assert.equal(only.elevation, 0); assert.equal(only.height, 2.55); assert.equal(only.source.height, 'plan');
  const absolute = fitNewLevel({ levels: [] }, { elevation: 312.4 });
  assert.equal(absolute.elevation, 0, 'sea-level heights are ignored'); assert.equal(absolute.height, DEFAULT_ROOM_HEIGHT); assert.equal(absolute.source.height, 'default');

  const eg = level('eg', 0, 2.6);
  const og = fitNewLevel({ levels: [eg] }, { elevation: 2.92, height: 2.5 });
  assert.equal(og.position, 'above'); close(og.slab, 0.32, 'slab derived from plan level'); assert.equal(og.source.slab, 'derived'); close(og.elevation, 2.92, 'plan level kept');
  const odd = fitNewLevel({ levels: [eg] }, { elevation: 3.5 });
  assert.equal(odd.slab, DEFAULT_SLAB, 'implausible gap keeps the default slab'); close(odd.elevation, 2.85, 'storey stacked without gap'); assert.equal(odd.mismatch, true);
  const noInfo = fitNewLevel({ levels: [eg] }, {});
  close(noInfo.elevation, 2.6 + DEFAULT_SLAB, 'defaults stack'); assert.equal(noInfo.mismatch, false);

  const kg = fitNewLevel({ levels: [eg] }, { elevation: -2.75 });
  assert.equal(kg.position, 'below'); assert.equal(kg.autoElevation, false); close(kg.height, 2.5, 'basement height closes the gap to the ground floor');
  close(kg.elevation + kg.height + slabThickness(eg), 0, 'ground floor keeps ±0');
  const kg2 = fitNewLevel({ levels: [eg] }, { elevation: -9 });
  close(kg2.height, DEFAULT_BASEMENT_HEIGHT, 'implausible basement level uses the default height');

  // The add_level op carries slab and manual elevation; the stack stays closed.
  const plan = { levels: [level('eg', 0, 2.6)], site: {} };
  applyOps(plan, [{ op: 'add_level', id: 'og', name: 'OG', elevation: og.elevation, height: og.height, slab: og.slab }]);
  applyOps(plan, [{ op: 'add_level', id: 'kg', name: 'KG', elevation: kg.elevation, height: kg.height, autoElevation: false }]);
  computeElevations(plan);
  assert.deepEqual(plan.levels.map((l) => l.id), ['kg', 'eg', 'og']);
  close(plan.levels[1].elevation, 0, 'ground floor unchanged after adding a basement');
  close(plan.levels[2].elevation, 2.92, 'upper floor uses its slab');
}

/* ---------- geometry ---------- */
const bounds = (o) => new THREE.Box3().setFromObject(o, true);
const firstHit = (group, origin, dir) => new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize(), 0, 10).intersectObject(group, true).find((h) => h.object.material?.visible !== false && h.object.material?.colorWrite !== false);
const two = (extra = {}) => level('two', 0, 2.6, { rooms: [rect('a', 0, 0, 2, 4), rect('b', 2, 0, 4, 4)], ...extra });
{
  // Upper storeys: no plinth, the facade is flush. Ground storey: plinth 2.25 cm proud.
  const upper = buildLevel(two()), ground = buildLevel(two(), {}, { terrain: 0 });
  close(firstHit(upper.group, [-1, 0.15, 1], [1, 0, 0]).point.x, -EXT_T / 2, 'upper storey has no plinth band', 1e-4);
  close(firstHit(ground.group, [-1, 0.15, 1], [1, 0, 0]).point.x, -EXT_T / 2 - 0.0225, 'ground storey plinth', 1e-4);
  close(firstHit(ground.group, [-1, 0.6, 1], [1, 0, 0]).point.x, -EXT_T / 2, 'facade above the plinth', 1e-4);
  // Plinth corner is closed at convex corners (no notch).
  const corner = firstHit(ground.group, [-1, 0.15, -0.13], [1, 0, 0]);
  assert.ok(corner && Math.abs(corner.point.x + EXT_T / 2 + 0.0225) < 1e-4, 'plinth wraps the outer corner');
  // Plinth does not stick into the room.
  const inside = firstHit(ground.group, [1, 0.15, 1], [-1, 0, 0]).point.x;
  close(inside, EXT_T / 2, 'plinth stays inside the wall', 1e-4);

  // Raised floor: the plinth reaches down to the terrain.
  const raised = buildLevel(two(), {}, { terrain: -0.6 });
  close(firstHit(raised.group, [-1, -0.5, 1], [1, 0, 0]).point.x, -EXT_T / 2 - 0.0225, 'plinth below a raised floor', 1e-4);
  assert.ok(bounds(raised.group).min.y <= -0.6, 'house reaches the terrain');

  // Interior walls end inside the exterior wall instead of reaching its outer face.
  const thin = [];
  upper.group.traverse((m) => { if (!m.isMesh) return; const b = bounds(m); if (Math.abs(b.max.x - b.min.x - INT_T) < 1e-3 && b.max.z - b.min.z > 3) thin.push(b); });
  assert.ok(thin.length >= 1, 'interior wall found');
  for (const w of thin) { close(w.min.z, -INT_T / 2, 'interior wall start', 1e-4); close(w.max.z, 4 + INT_T / 2, 'interior wall end', 1e-4); }
  // Exterior corners still close flush.
  const b = bounds(upper.group); close(b.min.x, -EXT_T / 2, 'outer corner x', 1e-4); close(b.min.z, -EXT_T / 2, 'outer corner z', 1e-4);
}
/* ---------- door hinge side and opening direction ---------- */
{
  const { doorGeometry, doorSwingVector } = await import('../frontend/src/house.js');
  const door = (extra) => buildLevel(two({ openings: [{ id: 'd', type: 'door', from: [2, 1], to: [2, 1.9], ...extra }] })).doors.d;
  const def = door({}), flipped = door({ hinge: 'to' }), sw1 = door({ swing: 1 }), sw2 = door({ swing: -1 });
  assert.ok(def && flipped && sw1 && sw2, 'doors built');
  close(def.hinge.position.z, 1.02, 'default hinge at "from"', 1e-6); close(flipped.hinge.position.z, 1.88, 'hinge at "to"', 1e-6);
  assert.notEqual(sw1.swing, sw2.swing, 'swing ±1 opens to opposite sides');
  // the leaf tip moves towards the requested side: open the door and check where the tip is
  for (const [d, side] of [[sw1, 1], [sw2, -1]]) {
    d.hinge.rotation.y = d.base + d.swing * 1.2; d.hinge.updateMatrixWorld(true);
    const tip = new THREE.Vector3(0.8, 0, 0).applyMatrix4(d.hinge.matrixWorld);
    // left normal of from→to (0,+1) is (−1, 0): swing +1 → x < 2
    assert.ok(side === 1 ? tip.x < 2 - 0.3 : tip.x > 2 + 0.3, `swing ${side} opens to the expected side (tip x ${tip.x.toFixed(2)})`);
  }
  const l = { ux: 0, uz: 1, nx: -1, nz: 0 };
  assert.deepEqual(doorSwingVector({ from: [2, 1], to: [2, 2], swing: -1 }, l, 1), [1, -0]);
  assert.equal(doorGeometry({ from: [2, 1], to: [2, 2] }, l, 1, { x: 2, z: 1 }, { x: 2, z: 2 }).atA, true);
}
console.log('house geometry tests passed');
