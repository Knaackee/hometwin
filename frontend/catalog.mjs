// Writes the shared catalog (device kinds, styles, furniture, surfaces) for the Python agent.
import { writeFileSync } from 'node:fs';
globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }), width: 0, height: 0 }) };
const { KINDS, LIGHT_STYLES, RADIATOR_STYLES } = await import('./src/devices.js');
const { FURNITURE } = await import('./src/furniture.js');
const { SURFACES } = await import('./src/kit.js');
const cat = {
  device_kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { label: v.label, domains: v.domains, device_classes: v.dc || null }])),
  styles: { light: LIGHT_STYLES, radiator: RADIATOR_STYLES },
  furniture: Object.fromEntries(Object.entries(FURNITURE).map(([k, v]) => [k, { label: v.label, category: v.cat, width: v.w, depth: v.d, height: v.h ?? null, outdoor: !!v.outdoor }])),
  surfaces: Object.fromEntries(Object.entries(SURFACES).map(([k, v]) => [k, { label: v.label, outdoor: !!v.outdoor }])),
  room_kinds: ['room', 'garage', 'outdoor', 'void'],
  opening_types: ['door', 'window', 'garage', 'open'],
};
writeFileSync('../custom_components/hometwin/catalog.json', JSON.stringify(cat, null, 1));
console.log('catalog', Object.keys(cat.furniture).length, 'furniture,', Object.keys(cat.device_kinds).length, 'device kinds');
