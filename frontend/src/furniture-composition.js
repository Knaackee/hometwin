// One-time expansion of furniture that historically rendered several independently
// useful objects as one mesh. New furniture is stamped at insertion time so only
// saved pre-split items are expanded when a plan is loaded.
export const FURNITURE_COMPOSITION_VERSION = 1;

const LEGACY_COMPOUNDS = new Set([
  'coffeeTable', 'bookshelf', 'diningTable', 'roundTable', 'kitchen', 'kitchenTall',
  'island', 'vanity', 'towelRack', 'desk', 'shelf', 'coatRack', 'rack', 'gardenSet',
]);

const round = (n) => Math.round(n * 1000) / 1000;
const size = (item, key, fallback) => Number.isFinite(item[key]) ? item[key] : fallback;
function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function markFurnitureCompositionCurrent(item) {
  if (LEGACY_COMPOUNDS.has(item?.type)) item.compositionVersion = FURNITURE_COMPOSITION_VERSION;
  return item;
}

function childrenFor(item) {
  const w = size(item, 'width', {
    coffeeTable: 1.1, bookshelf: 1, diningTable: 1.8, roundTable: 1.1, kitchen: 3,
    kitchenTall: 0.6, island: 2, vanity: 0.9, towelRack: 0.6, desk: 1.4, shelf: 1.2,
    coatRack: 0.9, rack: 1.2, gardenSet: 1.6,
  }[item.type]);
  const d = size(item, 'depth', {
    coffeeTable: 0.58, bookshelf: 0.32, diningTable: 0.9, roundTable: 1.1, kitchen: 0.62,
    kitchenTall: 0.62, island: 1, vanity: 0.5, towelRack: 0.3, desk: 0.7, shelf: 0.35,
    coatRack: 0.35, rack: 0.5, gardenSet: 1.6,
  }[item.type]);
  const h = size(item, 'height', { bookshelf: 1.9, shelf: 1.8, rack: 2 }[item.type]);
  const child = (suffix, type, x, z, rot = 0, extra = {}) => ({ suffix, type, x, z, rot, ...extra });

  switch (item.type) {
    case 'coffeeTable': return [
      child('book', 'book', w * 0.2, 0.05, 0, { lift: 0.4, color: '#c9553f' }),
      child('cup', 'cup', -w * 0.27, -0.08, 0, { lift: 0.4 }),
    ];
    case 'bookshelf': {
      const shelves = Math.max(2, Math.floor(h / 0.42)), random = seededRandom(Math.round(w * 100)), books = [];
      for (let shelf = 0; shelf < shelves; shelf++) {
        let x = -w / 2 + 0.06, index = 1;
        while (x < w / 2 - 0.12) {
          const width = 0.03 + random() * 0.04, height = 0.22 + random() * 0.12;
          const color = ['#7a3b2e', '#2f4d6b', '#c9a54d', '#3e5a45', '#d9d4c7'][Math.floor(random() * 5)];
          books.push(child(`book-${shelf + 1}-${index++}`, 'standingBook', x + width / 2, 0.03, 0, { width, depth: d * 0.7, height, lift: 0.06 + shelf * (h / shelves), color }));
          x += width + 0.005 + (random() < 0.1 ? 0.12 : 0);
        }
      }
      return books;
    }
    case 'diningTable': {
      const count = Math.max(0, Math.round(item.chairs ?? 6)), per = Math.ceil(count / 2);
      return Array.from({ length: count }, (_, i) => {
        const side = i < per ? 1 : -1, k = i < per ? i : i - per, n = i < per ? per : count - per;
        return child(`chair-${i + 1}`, 'chair', -w / 2 + (w / n) * (k + 0.5), side * (d / 2 + 0.14), side > 0 ? 180 : 0, { color: '#2b2e37' });
      });
    }
    case 'roundTable': {
      const count = Math.max(0, Math.round(item.chairs ?? 4));
      return Array.from({ length: count }, (_, i) => { const a = (i / count) * Math.PI * 2; return child(`chair-${i + 1}`, 'chair', Math.sin(a) * (w / 2 + 0.12), Math.cos(a) * (w / 2 + 0.12), (a * 180) / Math.PI + 180, { color: '#c8b49a' }); });
    }
    case 'kitchen': return [
      child('hob', 'hob', -w / 4, 0, 0, { lift: 0.9 }),
      child('sink', 'sink', w / 4, 0.02, 0, { lift: 0.9 }),
      child('tap', 'tap', w / 4, -0.22, 0, { lift: 0.9 }),
      ...(item.upper === false ? [] : [
        child('upper', 'upperCabinet', 0, -0.125, 0, { width: w, color: item.color || '#e4e1da', lift: 1.45 }),
        child('hood', 'hood', -w / 4, -0.09, 0, { lift: 1.4 }),
      ]),
    ];
    case 'kitchenTall': return [child('oven', 'oven', 0, d / 2 - 0.01, 0, { width: Math.max(0.2, w - 0.06), lift: 0.85 })];
    case 'island': {
      const count = Math.max(0, Math.round(item.stools ?? 3));
      return [child('hob', 'hob', 0, -0.12, 0, { lift: 0.935 }), ...Array.from({ length: count }, (_, i) => child(`stool-${i + 1}`, 'barStool', -w / 2 + (w / count) * (i + 0.5), d / 2 + 0.2, 0, { color: '#c28a5a' }))];
    }
    case 'vanity': return [child('mirror', 'vanityMirror', 0, -d / 2 + 0.03, 0, { width: w * 0.85, lift: 1.25 })];
    case 'towelRack': return [
      child('towel-1', 'towel', 0, 0.02, 0, { width: w - 0.1, depth: d - 0.06, lift: 0.9, color: '#e8dccb' }),
      child('towel-2', 'towel', 0, 0.02, 0, { width: w - 0.1, depth: d - 0.06, lift: 0.5, color: '#c9d7e2' }),
    ];
    case 'desk': return item.monitor === false ? [] : [child('monitor', null, -0.1, -d / 2 + 0.15, 0, { target: 'device', kind: 'tv', style: 'monitor', y: 0.75, length: 0.62 })];
    case 'shelf': return Array.from({ length: 4 }, (_, i) => child(`box-${i + 1}`, 'storageBox', -w / 2 + 0.25 + i * 0.25, 0, 0, { width: 0.3, depth: 0.25, height: 0.25, lift: 0.125 + i * (h - 0.15) / 4, color: ['#d8c9a8', '#a7b6c8', '#c9a54d', '#e5e1d8'][i] }));
    case 'coatRack': return ['#4b5563', '#8a5a44', '#c4b8a2'].map((color, i) => child(`coat-${i + 1}`, 'coat', -w / 3 + i * w / 3, -d / 2 + 0.1, 0, { lift: 0.95, color }));
    case 'rack': return Array.from({ length: 4 }, (_, i) => child(`box-${i + 1}`, 'storageBox', -0.2 + (i % 2) * 0.35, 0, 0, { width: 0.4, depth: 0.35, height: 0.3, lift: 0.125 + i * (h - 0.15) / 3, color: ['#7a5b3e', '#4b5563', '#c9a54d', '#6e8b6a'][i] }));
    case 'gardenSet': return [[-0.35, 0.6, 180], [0.35, 0.6, 180], [-0.35, -0.6, 0], [0.35, -0.6, 0]].map(([x, z, rot], i) => child(`chair-${i + 1}`, 'chair', x, z, rot, { color: '#8b6b4c' }));
    default: return [];
  }
}

export function migrateFurnitureCompositions(level) {
  const items = level?.furniture;
  if (!Array.isArray(items)) return 0;
  level.devices ||= [];
  const used = new Set([...items, ...level.devices].map((item) => item.id)); let added = 0;
  for (const parent of [...items]) {
    if (!LEGACY_COMPOUNDS.has(parent?.type) || parent.compositionVersion >= FURNITURE_COMPOSITION_VERSION || !Array.isArray(parent.pos)) continue;
    const angle = ((parent.rot || 0) * Math.PI) / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    for (const spec of childrenFor(parent)) {
      const { suffix, x, z, rot, target, ...rest } = spec;
      const pos = [round(parent.pos[0] + cos * x + sin * z), round(parent.pos[1] - sin * x + cos * z)];
      if (target === 'device' && level.devices.some((device) => device.kind === rest.kind && device.style === rest.style && Math.hypot(device.pos?.[0] - pos[0], device.pos?.[1] - pos[1]) < 0.05)) continue;
      let id = `${parent.id}__${suffix}`, n = 2; while (used.has(id)) id = `${parent.id}__${suffix}-${n++}`; used.add(id);
      const item = { id, pos, rot: round((parent.rot || 0) + rot), ...rest };
      if (target === 'device') delete item.type;
      if (!item.rot) delete item.rot;
      if (parent.hidden) item.hidden = true;
      if (parent.locked) item.locked = true;
      (target === 'device' ? level.devices : items).push(item); added++;
    }
    parent.compositionVersion = FURNITURE_COMPOSITION_VERSION;
  }
  return added;
}
