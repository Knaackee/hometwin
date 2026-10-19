import assert from 'node:assert/strict';
import { categoryFor, collectRoomEntities } from '../frontend/src/room-controls-data.js';

const level = { id: 'ground', rooms: [{ id: 'living', area_id: 'living_area', kind: 'room' }, { id: 'void', area_id: 'void_area', kind: 'void' }] };
const states = {
  'light.bound': { entity_id: 'light.bound', attributes: {} },
  'sensor.temp': { entity_id: 'sensor.temp', attributes: {} },
  'switch.auto': { entity_id: 'switch.auto', attributes: {} },
  'scene.evening': { entity_id: 'scene.evening', attributes: {} },
  'light.disabled': { entity_id: 'light.disabled', attributes: {} },
  'light.diagnostic': { entity_id: 'light.diagnostic', attributes: {} },
};
const app = {
  plan: { levels: [level] },
  stage: { isVisible: () => true },
  states: () => states,
  boundEntities: () => [
    { id: 'light.bound', room: 'living', kind: 'light', level },
    { id: 'light.missing', room: 'living', kind: 'light', level },
  ],
  _hass: {
    states,
    entities: {
      'sensor.temp': { area_id: 'living_area' },
      'switch.auto': { device_id: 'device-1' },
      'scene.evening': { area_id: 'living_area' },
      'light.disabled': { area_id: 'living_area', disabled_by: 'integration' },
      'light.diagnostic': { area_id: 'living_area', entity_category: 'diagnostic' },
      'light.registry_only': { area_id: 'living_area' },
    },
    devices: { 'device-1': { area_id: 'living_area' } },
  },
};

assert.equal(categoryFor('light.lamp'), 'lights');
assert.equal(categoryFor('cover.blind'), 'covers');
assert.equal(categoryFor('climate.room'), 'climate');
assert.equal(categoryFor('fan.ceiling'), 'climate');
assert.equal(categoryFor('media_player.tv'), 'media');
assert.equal(categoryFor('sensor.temp'), 'sensors');
assert.equal(categoryFor('scene.evening'), 'other');

const entities = collectRoomEntities(app);
assert.deepEqual(entities.map(({ id }) => id), ['light.bound', 'sensor.temp', 'switch.auto', 'scene.evening']);
assert.equal(entities.find((entity) => entity.id === 'switch.auto').room, 'living');
assert.equal(entities.find((entity) => entity.id === 'light.bound').kind, 'light');

console.log('room-controls-data tests passed');
