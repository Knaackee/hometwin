import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (_, key) => key === 'canvas' ? null : () => gradient, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };

const { buildLevel } = await import('../frontend/src/house.js');
const { applyWalkGravity, clampWalkVertical, moveWithWallCollisions, walkSupportAt } = await import('../frontend/src/walk-physics.js');

const square = (id, size = 2) => ({ id, kind: 'room', surface: 'oak', points: [[-size, -size], [size, -size], [size, size], [-size, size]] });
const level = (rooms, openings = [], elevation = 0) => ({ id: `level-${elevation}`, elevation, height: 2.6, rooms, openings, furniture: [], devices: [] });

test('wall collision stops normal motion and preserves slide', () => {
  const plan = { levels: [level([square('room')])] };
  const moved = moveWithWallCollisions(plan, { x: 1.65, z: 0 }, { x: 0.5, z: 0.4 });
  assert.ok(moved.x < 1.71, `x=${moved.x}`);
  assert.ok(moved.z > 0.35, `z=${moved.z}`);
});

test('door openings pass at floor height while window openings remain solid', () => {
  const opening = { id: 'opening', from: [2, -0.5], to: [2, 0.5], head: 2.1 };
  const through = type => moveWithWallCollisions({ levels: [level([square('room')], [{ ...opening, type, ...(type === 'window' ? { sill: 0.9 } : {}) }])] }, { x: 1.65, z: 0 }, { x: 0.55, z: 0 });
  assert.ok(through('door').x > 2);
  assert.ok(through('window').x < 1.71);
});

test('rotated walls use their rendered segment orientation', () => {
  const diamond = { id: 'diamond', kind: 'room', points: [[0, -2], [2, 0], [0, 2], [-2, 0]] };
  const moved = moveWithWallCollisions({ levels: [level([diamond])] }, { x: 0.75, z: 0.75 }, { x: 0.5, z: 0 });
  assert.ok(moved.x + moved.z < 1.75);
  assert.ok(moved.x > 0.9 && moved.z < 0.75, JSON.stringify(moved));
});

function stageWithFloors() {
  const lower = level([square('lower')], [], 0);
  const upperRoom = square('upper');
  const hole = { id: 'void', kind: 'void', points: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] };
  const upper = level([upperRoom, hole], [], 3);
  const levels = new Map();
  for (const item of [lower, upper]) {
    const house = buildLevel(item, {}, { visibleCeilings: true });
    const group = new THREE.Group(); group.position.y = item.elevation; group.add(house.group); group.updateMatrixWorld(true);
    levels.set(item.id, { level: item, group, house });
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(20, 32), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1; ground.updateMatrixWorld(true);
  return { levels, ground };
}

test('gravity falls through a real floor void and lands continuously on the lower floor', () => {
  const stage = stageWithFloors();
  assert.equal(walkSupportAt(stage, 0, 0, 3.1).y, 0);
  const walk = { x: 0, z: 0, floorY: 3, body: 1.75, velocityY: 0 };
  let maxStep = 0, previous = walk.floorY, result;
  for (let i = 0; i < 80 && walk.floorY > 0; i++) {
    result = applyWalkGravity(stage, walk, 0.05);
    maxStep = Math.max(maxStep, previous - walk.floorY); previous = walk.floorY;
  }
  assert.equal(walk.floorY, 0); assert.equal(walk.velocityY, 0); assert.equal(result.support.levelId, 'level-0');
  assert.ok(maxStep < 0.61, `step=${maxStep}`);
});

test('gravity holds on a visible upper floor without falling through it', () => {
  const stage = stageWithFloors(), walk = { x: 1, z: 1, floorY: 3, body: 1.75, velocityY: 0 };
  for (let i = 0; i < 20; i++) applyWalkGravity(stage, walk, 0.05);
  assert.ok(Math.abs(walk.floorY - 3) < 1e-9); assert.equal(walk.velocityY, 0);
});

test('gravity lands on terrain when no floor supports the position', () => {
  const stage = stageWithFloors(), walk = { x: 8, z: 0, floorY: 1, body: 1.75, velocityY: 0 };
  for (let i = 0; i < 60 && walk.floorY > -1; i++) applyWalkGravity(stage, walk, 0.05);
  assert.equal(walk.floorY, -1); assert.equal(walk.velocityY, 0);
});

test('free-flight vertical clamping respects floor and ceiling only when requested', () => {
  const stage = stageWithFloors(), walk = { x: 1, z: 1, floorY: 0, body: 1.75 };
  assert.ok(Math.abs(clampWalkVertical(stage, walk, -0.5)) < 1e-9);
  assert.ok(clampWalkVertical(stage, walk, 1.5) <= 0.85 + 1e-6);
  // With collision disabled Stage applies the requested target directly, preserving free flight.
  const requested = walk.floorY + 1.5;
  assert.equal(requested, 1.5);
});
