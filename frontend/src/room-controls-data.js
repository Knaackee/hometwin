// Data helpers for room controls.  This module deliberately has no DOM or HA calls.

const AUTO_DOMAINS = new Set([
  'light', 'switch', 'fan', 'cover', 'climate', 'media_player', 'camera', 'image',
  'sensor', 'binary_sensor', 'input_boolean', 'scene', 'script', 'automation',
  'vacuum', 'lawn_mower', 'valve', 'lock', 'button', 'number', 'select', 'humidifier',
]);

const hasValue = (value) => value !== undefined && value !== null && value !== '';

function hassFor(app) {
  return app?._hass || app?.hass || {};
}

function statesFor(app, hass) {
  if (typeof app?.states === 'function') return app.states() || {};
  return hass.states || {};
}

function visibleLevels(app) {
  const levels = app?.plan?.levels || [];
  if (app?.stage?.walk) return levels.filter(level => level.id === app.stage.walk.levelId);
  return levels.filter((level) => !app?.stage?.isVisible || app.stage.isVisible(level));
}

function roomArea(room) {
  return room?.area_id || room?.area || null;
}

function areaFor(id, state, registry, hass) {
  const device = registry?.device_id && hass.devices?.[registry.device_id];
  return registry?.area_id || device?.area_id || state?.attributes?.area || state?.attributes?.area_id || null;
}

function roomForArea(levels, area) {
  if (!area) return null;
  for (const level of levels) {
    const room = (level.rooms || []).find((candidate) => candidate.kind !== 'void' && roomArea(candidate) === area);
    if (room) return { room: room.id, level };
  }
  return null;
}

function registryExcludes(entry) {
  if (!entry) return false;
  if (hasValue(entry.disabled_by) || hasValue(entry.hidden_by)) return true;
  const category = String(entry.entity_category || '').toLowerCase();
  return category === 'config' || category === 'diagnostic';
}

/** Return the UI category used for an entity control. */
export function categoryFor(id, state = {}) {
  const domain = String(id || state.entity_id || '').split('.')[0];
  if (domain === 'light') return 'lights';
  if (domain === 'cover') return 'covers';
  if (domain === 'climate' || domain === 'fan' || domain === 'humidifier') return 'climate';
  if (domain === 'media_player' || domain === 'camera' || domain === 'image') return 'media';
  if (domain === 'sensor' || domain === 'binary_sensor') return 'sensors';
  return 'other';
}

/**
 * Combine explicit 3D bindings with HA entities assigned to a visible plan room.
 * Explicit bindings win on duplicate ids and are retained regardless of registry flags.
 */
export function collectRoomEntities(app) {
  const hass = hassFor(app);
  const states = statesFor(app, hass);
  const registry = hass.entities || {};
  const levels = visibleLevels(app);
  const out = [];
  const seen = new Set();
  const bound = typeof app?.boundEntities === 'function' ? app.boundEntities() || [] : [];

  for (const item of bound) {
    if (!item?.id || !states[item.id] || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ id: item.id, room: item.room ?? null, kind: item.kind || categoryFor(item.id, states[item.id]), level: item.level });
  }

  const ids = new Set([...Object.keys(states), ...Object.keys(registry)]);
  for (const id of ids) {
    if (seen.has(id)) continue;
    const domain = String(id).split('.')[0];
    if (!AUTO_DOMAINS.has(domain)) continue;
    const entry = registry[id];
    if (registryExcludes(entry)) continue;
    const state = states[id];
    if (!state) continue;
    const mapped = roomForArea(levels, areaFor(id, state, entry, hass));
    if (!mapped) continue;
    seen.add(id);
    out.push({ id, room: mapped.room, kind: categoryFor(id, state), level: mapped.level });
  }
  return out;
}

