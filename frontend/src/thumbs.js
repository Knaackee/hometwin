// Renders library preview images from the same builders the scene uses.
import * as THREE from 'three';
import { buildFurniture, FURNITURE, FURNITURE_CATS } from './furniture.js';
import { buildDevice, KINDS, LIGHT_STYLES, RADIATOR_STYLES, deviceDefaults } from './devices.js';

export function assetCatalog() {
  const out = [];
  for (const [style, label] of Object.entries(LIGHT_STYLES)) out.push({ key: `light:${style}`, cat: 'Licht', label, spec: { kind: 'light', style, ...deviceDefaults('light', style) } });
  for (const [style, label] of Object.entries(RADIATOR_STYLES)) out.push({ key: `radiator:${style}`, cat: 'Klima', label, spec: { kind: 'radiator', style } });
  for (const [kind, k] of Object.entries(KINDS)) if (!['light', 'radiator'].includes(kind)) out.push({ key: kind, cat: k.cat === 'Garten' ? 'Garten' : k.cat === 'Sicherheit' ? 'Sensoren' : k.cat, label: k.label, spec: { kind, ...deviceDefaults(kind) } });
  for (const [type, f] of Object.entries(FURNITURE)) out.push({ key: `f:${type}`, cat: f.cat, label: f.label, spec: { type }, furniture: true });
  return out;
}
export const CATALOG_CATS = ['Licht', 'Klima', 'Sensoren', 'Geräte', 'Medien', ...FURNITURE_CATS];

const cache = new Map();
export function thumbFor(key) { return cache.get(key); }
export function setThumb(key, url) { cache.set(key, url); }
export function renderThumbs(catalog) {
  if (cache.size) return;
  let r;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setSize(112, 112); r.toneMapping = THREE.ACESFilmicToneMapping; r.setClearColor(0, 0);
    const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xdfe6ff, 0x30333c, 2.2)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(3, 5, 4); sc.add(dl);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
    for (const a of catalog) {
      let obj;
      if (a.furniture) obj = buildFurniture(a.spec);
      else {
        const b = buildDevice({ ...a.spec, pos: [0, 0] }, { height: 2.6 });
        b.update({ entity_id: 'x.x', state: { light: 'on', tv: 'playing', camera: 'idle' }[a.spec.kind] || 'on', attributes: { brightness: 255, color_temp_kelvin: 2700, hvac_action: 'heating', device_class: 'smoke' } }, 1, 0.2, { room: null });
        obj = b.root; const drop = []; obj.traverse((m) => { if (m.isLight || m.userData.pool) drop.push(m); }); drop.forEach((m) => m.parent.remove(m));
        if (a.spec.kind === 'light' && ['ceiling', 'downlights', 'track', 'pendant', 'pendantTrio'].includes(a.spec.style) || ['fan', 'smoke'].includes(a.spec.kind)) obj.position.y = -2;
      }
      sc.add(obj);
      const bb = new THREE.Box3().setFromObject(obj); const c = bb.getCenter(new THREE.Vector3()); const sz = bb.getSize(new THREE.Vector3()).length() || 1;
      cam.position.set(c.x + sz * 1.1, c.y + sz * 0.9, c.z + sz * 1.5); cam.lookAt(c); r.render(sc, cam);
      cache.set(a.key, r.domElement.toDataURL()); sc.remove(obj);
    }
  } catch (e) { console.warn('hometwin: thumbnails unavailable', e); }
  finally { if (r) { r.dispose(); r.forceContextLoss(); } }
}
