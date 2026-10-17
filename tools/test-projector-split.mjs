import assert from 'node:assert/strict';
import * as THREE from 'three';
import { markStandaloneProjectorScreen, migrateLegacyProjectors } from '../frontend/src/projector-migration.js';

const noop = () => {};
const gradient = { addColorStop: noop };
const context = new Proxy({
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
  createPattern: () => null,
  measureText: () => ({ width: 0 }),
}, { get: (target, prop) => prop in target ? target[prop] : noop });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const { buildDevice, deviceDefaults } = await import('../frontend/src/devices.js');
assert.deepEqual(deviceDefaults('projector'), { style: 'ceiling' }, 'catalog placement uses the standalone ceiling projector style');

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);
const plan = {
  levels: [{
    height: 2.8,
    devices: [{ id: 'screen', kind: 'tv', style: 'projector', entity_id: 'media_player.cinema', pos: [4, 5], rot: 90, y: 0.7, length: 2 }],
  }],
};

assert.equal(migrateLegacyProjectors(plan), 1, 'legacy combination is split once');
const [screen, projector] = plan.levels[0].devices;
assert.deepEqual(screen.pos, [4, 5], 'screen position is unchanged');
assert.equal(screen.rot, 90, 'screen rotation is unchanged');
assert.equal(screen.y, 0.7, 'screen height is unchanged');
assert.equal(screen.length, 2, 'screen width is unchanged');
assert.equal(screen.entity_id, 'media_player.cinema', 'screen keeps media content and controls after the split');
assert.equal(screen.projector_id, projector.id, 'screen records the migrated projector');
assert.equal(projector.kind, 'projector');
assert.equal(projector.style, 'ceiling');
assert.equal(projector.entity_id, 'media_player.cinema', 'projector retains the media entity');
close(projector.pos[0], 7, 'projector keeps the legacy transformed x position');
close(projector.pos[1], 5, 'projector keeps the legacy transformed z position');
close(projector.y, 2.43, 'projector keeps the legacy body height');
assert.equal(projector.rot, 90, 'projector keeps the legacy rotation');
assert.equal(migrateLegacyProjectors(plan), 0, 'migration is idempotent');
assert.equal(plan.levels[0].devices.length, 2, 'idempotent migration adds no duplicate');

const standalone = markStandaloneProjectorScreen({ id: 'new-screen', kind: 'tv', style: 'projector', pos: [1, 1] });
const currentPlan = { levels: [{ height: 2.6, devices: [standalone] }] };
assert.equal(standalone.projector_screen_only, true, 'new screens carry the current standalone marker');
assert.equal(migrateLegacyProjectors(currentPlan), 0, 'new standalone screens are not treated as legacy combinations');
assert.equal(currentPlan.levels[0].devices.length, 1, 'reloading a standalone screen does not add a projector');

const collisionPlan = { levels: [{ height: 2.6, devices: [
  { id: 'cinema', kind: 'tv', style: 'projector', pos: [0, 0] },
  { id: 'cinema_projector', kind: 'speaker', pos: [1, 1] },
] }] };
assert.equal(migrateLegacyProjectors(collisionPlan), 1);
assert.equal(collisionPlan.levels[0].devices[0].projector_id, 'cinema_projector_2', 'migration avoids an existing device id');

const screenBuild = buildDevice(screen, { height: 2.8 });
assert.equal(screenBuild.root.children.some((child) => !child.userData.pool && child.position.z > 1), false, 'screen no longer contains a remote projector body or beam');
const projectorBuild = buildDevice(projector, { height: 2.8 });
const projectorBox = new THREE.Box3().setFromObject(projectorBuild.root);
close(projectorBox.min.y, 2.43, 'projector geometry starts at the migrated body height');
const lens = projectorBuild.root.children.find((child) => child.material?.emissive?.getHexString() === 'bcd3ff');
assert.ok(lens, 'projector has an emissive lens');
projectorBuild.update({ state: 'off' });
assert.equal(lens.material.emissiveIntensity, 0, 'lens is dark while off');
projectorBuild.update({ state: 'playing' });
assert.equal(lens.material.emissiveIntensity, 2, 'lens glows while playing');
projectorBuild.update({ state: 'paused' });
assert.equal(lens.material.emissiveIntensity, 2, 'lens stays lit while the media player is paused');
projectorBuild.update({ state: 'standby' });
assert.equal(lens.material.emissiveIntensity, 0, 'lens is dark in standby');
assert.equal(projectorBuild.root.children.some((child) => child.userData.roomEffect), false, 'unlinked projector renders no fake beam');

const { applyOps, migrate } = await import('../frontend/src/plan.js');
const persisted = {
  version: 2,
  name: 'Legacy cinema',
  site: {},
  levels: [{ id: 'ground', name: 'Ground', elevation: 0, height: 2.6, rooms: [], openings: [], furniture: [], devices: [
    { id: 'legacy-screen', kind: 'tv', style: 'projector', entity_id: 'media_player.cinema', pos: [2, 3], rot: 180, y: 0.6, length: 2.2 },
  ] }],
};
migrate(persisted);
assert.equal(persisted.levels[0].devices.length, 2, 'plan normalization runs the legacy split');
migrate(persisted);
assert.equal(persisted.levels[0].devices.length, 2, 'repeated plan normalization remains idempotent');

const current = { version: 2, name: 'Current cinema', site: {}, levels: [{ id: 'ground', name: 'Ground', elevation: 0, height: 2.6, rooms: [], openings: [], furniture: [], devices: [] }] };
assert.deepEqual(applyOps(current, [{ op: 'place_device', level_id: 'ground', id: 'screen-only', kind: 'tv', style: 'projector', pos: [1, 2] }]), [{ ok: true, id: 'screen-only' }]);
assert.equal(current.levels[0].devices[0].projector_screen_only, true, 'placing a current projector screen marks it as standalone');
migrate(current);
assert.equal(current.levels[0].devices.length, 1, 'current screen remains standalone after save/load normalization');

console.log('PASS: legacy projector combinations split into independently placeable screen and projector');
