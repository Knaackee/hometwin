import assert from 'node:assert/strict';
const context = new Proxy({}, { get: (_target, key) => key.startsWith('create') && key.endsWith('Gradient') ? () => ({ addColorStop() {} }) : () => {} });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const { buildLevel } = await import('../frontend/src/house.js');

const level = {
  id: 'main', height: 2.7, elevation: 0,
  rooms: [
    { id: 'left', points: [[0, 0], [2, 0], [2, 4], [0, 4]] },
    { id: 'right', points: [[2, 0], [4, 0], [4, 4], [2, 4]] },
  ],
  openings: [
    { id: 'front-door', type: 'door', from: [0.8, 0], to: [1.8, 0] },
    { id: 'interior-door', type: 'door', from: [2, 1], to: [2, 2] },
    { id: 'passage', type: 'open', from: [4, 2], to: [4, 3] },
    { id: 'window', type: 'window', from: [0, 2], to: [0, 3] },
  ],
};

const house = buildLevel(level, {});
assert.equal(house.openingHits.length, level.openings.length, 'every opening gets a pick proxy');
assert.deepEqual(new Set(house.openingHits.map((m) => m.userData.opening)), new Set(level.openings.map((o) => o.id)));
assert(house.openingHits.every((m) => m.material.visible === false), 'pick proxies stay invisible');
console.log(`PASS: ${house.openingHits.length} opening pick proxies, including unlinked and interior openings`);

