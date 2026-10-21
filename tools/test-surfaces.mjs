import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSurfaceDefinition, normalizeSurfaceOptions, resolveSurfaceDefinition, validateSurfaceDefinition, validateSurfaceOptions } from '../engine/surface.js';

const operations = new WeakMap();
function fakeCanvas() {
  const canvas = { width: 0, height: 0 };
  const calls = [];
  const context = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => { calls.push([key, ...args]); return key.includes('Gradient') ? { addColorStop() {} } : undefined; };
    },
    set(target, key, value) { target[key] = value; calls.push([key, value]); return true; },
  });
  canvas.getContext = () => context;
  canvas.toDataURL = () => `data:image/png;base64,${Buffer.from(JSON.stringify(calls)).toString('base64')}`;
  operations.set(canvas, calls);
  return canvas;
}
globalThis.document = { createElement: (tag) => tag === 'canvas' ? fakeCanvas() : {} };

const { FLOOR_SURFACES, findFloorSurface, floorSurfaceMaterial, surfacePreview } = await import('../frontend/src/surfaces.js');
const { surfaceMat } = await import('../frontend/src/kit.js');
const { buildLevel } = await import('../frontend/src/house.js');

assert.deepEqual(FLOOR_SURFACES.slice(0,8).map(({ id }) => id), ['oak', 'walnut', 'ash', 'tile', 'tileDark', 'stone', 'concrete', 'carpet']);
for (const surface of FLOOR_SURFACES) {
  assert.equal(validateSurfaceDefinition(surface), true);
  assert.deepEqual(normalizeSurfaceDefinition(JSON.parse(readFileSync(new URL(`../surfaces/${surface.id}.json`, import.meta.url)))), surface);
}
assert.equal(findFloorSurface('oak').name.de, 'Eiche');
assert.equal(findFloorSurface('missing'), null);

const options = normalizeSurfaceOptions({ color: '#ABCDEF', rotation: -30, width: 0.12, length: 1.8 });
assert.deepEqual(options, { color: '#abcdef', rotation: 330, width: 0.12, length: 1.8 });
assert.equal(validateSurfaceOptions(options), true);
const resolved = resolveSurfaceDefinition(findFloorSurface('oak'), options);
assert.equal(resolved.color, '#abcdef'); assert.equal(resolved.secondaryColor, '#9b7653'); assert.equal(resolved.rotation, 330);
assert.throws(() => normalizeSurfaceOptions({ width: 0.019 }), /0\.02/);
assert.throws(() => normalizeSurfaceOptions({ opacity: 0.5 }), /unsupported field/);
assert.throws(() => normalizeSurfaceDefinition({ ...findFloorSurface('oak'), pattern: 'script' }), /planks, tiles, noise/);
assert.throws(() => normalizeSurfaceDefinition({ ...findFloorSurface('oak'), onload: 'alert(1)' }), /unsupported field/);

const oakMaterial = floorSurfaceMaterial(findFloorSurface('oak'));
assert.equal(oakMaterial.userData.surface.id, 'oak');
assert.equal(oakMaterial.roughness, 0.75);
assert.ok(Math.abs(oakMaterial.map.repeat.x - 1) < 1e-9, 'two 1.2 m plank lengths fill the 2.4 m UV tile');
assert.ok(Math.abs(oakMaterial.map.repeat.y - (2.4 / (0.18 * 4))) < 1e-9, 'four plank widths use metric repeat');
const rotated = floorSurfaceMaterial(findFloorSurface('tile'), { rotation: 90, width: 0.3, length: 0.6 });
assert.ok(Math.abs(rotated.map.rotation - Math.PI / 2) < 1e-9);
assert.ok(Math.abs(rotated.map.repeat.x - 2) < 1e-9); assert.ok(Math.abs(rotated.map.repeat.y - 1) < 1e-9);
assert.equal(floorSurfaceMaterial(findFloorSurface('tile'), { rotation: 450, width: 0.3, length: 0.6 }), rotated, 'normalized overrides share a cached material');
assert.match(surfacePreview(findFloorSurface('stone'), { color: '#778899' }), /^data:image\/png;base64,/);
assert.equal(floorSurfaceMaterial({ id: 'oak', pattern: 'unsafe' }).userData.surface.id, 'oak', 'malformed stored data falls back safely');

const baseLevel = { id: 'eg', name: 'Ground floor', elevation: 0, height: 2.6, cutHeight: 1.2, openings: [], furniture: [], devices: [] };
const room = { id: 'room', name: 'Room', kind: 'room', surface: 'oak', points: [[0, 0], [3, 0], [3, 3], [0, 3]] };
const legacy = buildLevel({ ...baseLevel, rooms: [{ ...room }] });
assert.equal(legacy.floors.room.material, surfaceMat('oak'), 'rooms without a snapshot retain the legacy material path');
const modern = buildLevel({ ...baseLevel, rooms: [{ ...room, surfaceSpec: findFloorSurface('oak'), surfaceOptions: { rotation: 90 } }] });
assert.notEqual(modern.floors.room.material, surfaceMat('oak'));
assert.equal(modern.floors.room.material.userData.surface.rotation, 90);

const { applyOps } = await import('../frontend/src/plan.js');
const plan = {site:{},levels:[{...baseLevel,rooms:[structuredClone(room)]}]};
assert.equal(applyOps(plan,[{op:'update_room',room_id:'room',surfaceSpec:findFloorSurface('tile'),surfaceOptions:{rotation:90}}])[0].ok,true);
const saved = JSON.stringify(plan);
assert.equal(applyOps(plan,[{op:'update_room',room_id:'room',name:'Must not change',surfaceSpec:{id:'bad'}}])[0].ok,false);
assert.equal(JSON.stringify(plan),saved,'invalid surface operations are atomic');
assert.equal(applyOps(plan,[{op:'update_room',room_id:'room',surface:'carpet'}])[0].ok,true);
assert.equal(plan.levels[0].rooms[0].surfaceSpec,undefined,'legacy agent surface operation replaces new covering');
console.log('surface tests passed');
