import assert from 'node:assert/strict';
import { FURNITURE_COMPOSITION_VERSION, markFurnitureCompositionCurrent, migrateFurnitureCompositions } from '../frontend/src/furniture-composition.js';

const level = {
  furniture: [
    { id: 'coffee', type: 'coffeeTable', pos: [10, 20], rot: 90, width: 2, hidden: true, locked: true },
    { id: 'shelf', type: 'bookshelf', pos: [0, 4], width: 0.5, height: 0.9 },
    { id: 'table', type: 'diningTable', pos: [1, 2], width: 2, depth: 1, chairs: 3 },
    { id: 'kitchen', type: 'kitchen', pos: [4, 5], rot: 180, width: 2.4, upper: false },
    { id: 'desk', type: 'desk', pos: [7, 8], rot: -90, depth: 0.8 },
    { id: 'bare-desk', type: 'desk', pos: [0, 0], monitor: false },
  ],
  devices: [],
};

const migrated = migrateFurnitureCompositions(level);
assert.ok(migrated > 9, 'legacy compounds expand into their former visible parts');
assert.equal(level.furniture.find((item) => item.id === 'coffee').compositionVersion, FURNITURE_COMPOSITION_VERSION);

const book = level.furniture.find((item) => item.id === 'coffee__book');
assert.deepEqual(book.pos, [10.05, 19.6], 'local child offsets rotate into world coordinates');
assert.equal(book.rot, 90);
assert.equal(book.hidden, true, 'child visibility follows the legacy parent');
assert.equal(book.locked, true, 'child lock state follows the legacy parent');

const chairs = level.furniture.filter((item) => item.id.startsWith('table__chair-'));
assert.equal(chairs.length, 3);
assert.deepEqual(chairs.map((chair) => chair.rot || 0), [180, 180, 0]);

const books = level.furniture.filter((item) => item.id.startsWith('shelf__book-'));
assert.ok(books.length > 4, 'bookcase contents become individually selectable books');
assert.ok(books.every((book) => book.type === 'standingBook' && book.width > 0 && book.height > 0));

assert.equal(level.furniture.some((item) => item.id === 'kitchen__upper'), false, 'disabled legacy upper cabinets stay absent');
assert.equal(level.furniture.some((item) => item.id === 'kitchen__hood'), false, 'hood follows the legacy upper-cabinet option');
assert.ok(level.furniture.some((item) => item.id === 'kitchen__hob'));
assert.ok(level.furniture.some((item) => item.id === 'kitchen__sink'));
assert.ok(level.furniture.some((item) => item.id === 'kitchen__tap'));

assert.deepEqual(level.devices.find((item) => item.id === 'desk__monitor'), {
  id: 'desk__monitor', pos: [7.25, 7.9], rot: -90, kind: 'tv', style: 'monitor', y: 0.75, length: 0.62,
});
assert.equal(level.devices.some((item) => item.id === 'bare-desk__monitor'), false, 'monitor:false remains visually empty');

const snapshot = JSON.stringify(level);
assert.equal(migrateFurnitureCompositions(level), 0, 'migration is idempotent');
assert.equal(JSON.stringify(level), snapshot);

const priorDemo = { furniture: [{ id: 'desk', type: 'desk', pos: [8.6, 8.05], rot: 180, width: 1.6 }], devices: [{ id: 'monitor', kind: 'tv', style: 'monitor', pos: [8.7, 8.25], rot: 180, y: 0.75, length: 0.62 }] };
assert.equal(migrateFurnitureCompositions(priorDemo), 0, 'an already separated monitor from a previously saved demo is not duplicated');
assert.equal(priorDemo.devices.length, 1);
assert.equal(priorDemo.furniture[0].compositionVersion, FURNITURE_COMPOSITION_VERSION);

const inserted = markFurnitureCompositionCurrent({ id: 'new-table', type: 'roundTable', pos: [0, 0] });
const fresh = { furniture: [inserted], devices: [] };
assert.equal(migrateFurnitureCompositions(fresh), 0, 'new standalone furniture does not gain legacy children after reload');
assert.equal(fresh.furniture.length, 1);

const expectedParts = new Map([
  ['coffeeTable', 2], ['bookshelf', null], ['diningTable', 6], ['roundTable', 4], ['kitchen', 5],
  ['kitchenTall', 1], ['island', 4], ['vanity', 1], ['towelRack', 2], ['desk', 1], ['shelf', 4],
  ['coatRack', 3], ['rack', 4], ['gardenSet', 4],
]);
for (const [type, expected] of expectedParts) {
  const compound = { id: type, type, pos: [0, 0] }, one = { furniture: [compound], devices: [] };
  const count = migrateFurnitureCompositions(one);
  assert.equal(compound.compositionVersion, FURNITURE_COMPOSITION_VERSION, `${type} records the migration boundary`);
  expected === null ? assert.ok(count > 4, `${type} expands its visible parts`) : assert.equal(count, expected, `${type} expands every visible part`);
  assert.equal(migrateFurnitureCompositions(one), 0, `${type} migration is idempotent`);
}

const collision = { furniture: [{ id: 'coffee', type: 'coffeeTable', pos: [0, 0] }, { id: 'coffee__book', type: 'book', pos: [4, 4] }], devices: [] };
migrateFurnitureCompositions(collision);
assert.ok(collision.furniture.some((item) => item.id === 'coffee__book-2'), 'migration never overwrites an existing item id');

const noop = () => {};
const gradient = { addColorStop: noop };
const context = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient, measureText: () => ({ width: 0 }) }, { get: (target, key) => target[key] ?? noop });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const { buildFurniture, FURNITURE, furnitureParams } = await import('../frontend/src/furniture.js');
const THREE = await import('three');
const meshCount = (type) => { let count = 0; FURNITURE[type].build(furnitureParams({ type, pos: [0, 0] })).traverse((node) => { if (node.isMesh) count++; }); return count; };
assert.equal(meshCount('coffeeTable'), 5, 'coffee table geometry contains only the table');
assert.equal(meshCount('diningTable'), 5, 'dining table geometry contains no chairs');
assert.equal(meshCount('roundTable'), 3, 'round table geometry contains no chairs');
assert.equal(meshCount('bookshelf'), 1, 'bookcase geometry contains no books');
assert.equal(meshCount('kitchenTall'), 1, 'tall cabinet geometry contains no oven');
assert.equal(meshCount('island'), 2, 'island geometry contains no stools or cooktop');
assert.equal(meshCount('towelRack'), 1, 'towel shelf geometry contains no towels');
assert.equal(meshCount('coatRack'), 2, 'coat rack geometry contains no clothes');
assert.equal(meshCount('rack'), 8, 'heavy-duty shelf geometry contains no boxes');
assert.equal(meshCount('gardenSet'), 5, 'garden table geometry contains no chairs');

const kitchen = { furniture: [{ id: 'k', type: 'kitchen', pos: [4, 5], rot: 180, width: 2.4 }], devices: [] };
migrateFurnitureCompositions(kitchen);
const kitchenWorld = new THREE.Group();
for (const item of kitchen.furniture) { const object = buildFurniture(item); object.position.set(item.pos[0], 0, item.pos[1]); object.rotation.y = (item.rot || 0) * Math.PI / 180; kitchenWorld.add(object); }
const kitchenBounds = new THREE.Box3().setFromObject(kitchenWorld);
assert.ok(Math.abs(kitchenBounds.max.y - 2.15) < 1e-6, 'split upper cabinets keep the legacy kitchen height');
assert.ok(kitchenBounds.min.x < 2.79 && kitchenBounds.max.x > 5.21, 'split kitchen keeps the legacy transformed footprint');

const { applyOps, migrate } = await import('../frontend/src/plan.js');
const currentPlan = { version: 2, name: 'current', site: { roof: { type: 'none' } }, levels: [{ id: 'l', elevation: 0, height: 2.6, rooms: [], openings: [], furniture: [], devices: [] }] };
const [placed] = applyOps(currentPlan, [{ op: 'place_furniture', level_id: 'l', type: 'coffeeTable', pos: [1, 2], lift: 0.3 }]);
assert.equal(placed.ok, true);
assert.equal(currentPlan.levels[0].furniture[0].compositionVersion, FURNITURE_COMPOSITION_VERSION);
assert.equal(currentPlan.levels[0].furniture[0].lift, 0.3, 'agent placement preserves vertical lift');
migrate(currentPlan);
assert.equal(currentPlan.levels[0].furniture.length, 1, 'freshly inserted furniture remains standalone after full plan normalization');

console.log('furniture composition migration ok');
