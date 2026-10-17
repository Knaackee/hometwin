// Entity-bound assets. Each builder returns
//   { root, hit: [w, h, d, yCenter], emitters: [{ anchor, color, power }], update(state, dt, t, env) }
// root stands on the floor at the device position; emitters are picked up by the scene's
// shared pool of real lights (only the brightest ones get a THREE light, the rest glow).
import * as THREE from 'three';
import { box, cyl, sphere, at, group, mat, lightPool, pulseRing } from './kit.js';
import { bindScreen, screenMaterial, Label, generativeArt } from './media.js';
import { screenGeometry } from '../../engine/recipe.js';
import { t } from './i18n.js';

const DARK = '#23262e', METAL = '#a8adb5';

export const KINDS = {
  light: { get label() { return t('data.device.light'); }, icon: 'bulb', get cat() { return t('data.category.light'); }, domains: ['light'] },
  radiator: { get label() { return t('data.device.radiator'); }, icon: 'flame', get cat() { return t('data.category.climate'); }, domains: ['climate'] },
  thermostat: { get label() { return t('data.device.thermostat'); }, icon: 'thermo', get cat() { return t('data.category.climate'); }, domains: ['climate'] },
  ac: { get label() { return t('data.device.ac'); }, icon: 'wind', get cat() { return t('data.category.climate'); }, domains: ['climate', 'fan'] },
  fan: { get label() { return t('data.device.fan'); }, icon: 'fan', get cat() { return t('data.category.climate'); }, domains: ['fan', 'switch'] },
  temp: { get label() { return t('data.device.temp'); }, icon: 'thermo', get cat() { return t('data.category.sensors'); }, domains: ['sensor'], dc: ['temperature', 'humidity'] },
  motion: { get label() { return t('data.device.motion'); }, icon: 'motion', get cat() { return t('data.category.sensors'); }, domains: ['binary_sensor'], dc: ['motion', 'occupancy', 'presence'] },
  smoke: { get label() { return t('data.device.smoke'); }, icon: 'alarm', get cat() { return t('data.category.sensors'); }, domains: ['binary_sensor'], dc: ['smoke', 'carbon_monoxide', 'gas', 'safety', 'moisture'] },
  plug: { get label() { return t('data.device.plug'); }, icon: 'plug', get cat() { return t('data.category.devices'); }, domains: ['switch', 'input_boolean'] },
  tv: { get label() { return t('data.device.tv'); }, icon: 'tv', get cat() { return t('data.category.media'); }, domains: ['media_player', 'camera', 'image'] },
  projector: { get label() { return t('data.device.projector'); }, icon: 'tv', get cat() { return t('data.category.media'); }, domains: ['media_player', 'switch', 'input_boolean'] },
  frame: { get label() { return t('data.device.frame'); }, icon: 'image', get cat() { return t('data.category.media'); }, domains: ['image', 'camera', 'media_player'] },
  speaker: { get label() { return t('data.device.speaker'); }, icon: 'speaker', get cat() { return t('data.category.media'); }, domains: ['media_player'] },
  vacuum: { get label() { return t('data.device.vacuum'); }, icon: 'robot', get cat() { return t('data.category.devices'); }, domains: ['vacuum'] },
  washer: { get label() { return t('data.device.washer'); }, icon: 'drop', get cat() { return t('data.category.devices'); }, domains: ['sensor', 'switch', 'binary_sensor', 'input_boolean'] },
  fireplace: { get label() { return t('data.device.fireplace'); }, icon: 'flame', get cat() { return t('data.category.climate'); }, domains: ['switch', 'climate', 'light', 'input_boolean'] },
  mower: { get label() { return t('data.device.mower'); }, icon: 'robot', get cat() { return t('data.category.garden'); }, domains: ['lawn_mower'] },
  valve: { get label() { return t('data.device.valve'); }, icon: 'drop', get cat() { return t('data.category.garden'); }, domains: ['valve', 'switch'] },
  camera: { get label() { return t('data.device.camera'); }, icon: 'camera', get cat() { return t('data.category.security'); }, domains: ['camera'] },
};
export const LIGHT_STYLES = {
  get ceiling() { return t('data.lightStyle.ceiling'); }, get downlights() { return t('data.lightStyle.downlights'); }, get pendant() { return t('data.lightStyle.pendant'); }, get pendantTrio() { return t('data.lightStyle.pendantTrio'); }, get arc() { return t('data.lightStyle.arc'); }, get floor() { return t('data.lightStyle.floor'); },
  get table() { return t('data.lightStyle.table'); }, get wall() { return t('data.lightStyle.wall'); }, get track() { return t('data.lightStyle.track'); }, get strip() { return t('data.lightStyle.strip'); }, get outdoorWall() { return t('data.lightStyle.outdoorWall'); }, get bollard() { return t('data.lightStyle.bollard'); },
};
export const RADIATOR_STYLES = { get panel() { return t('data.radiatorStyle.panel'); }, get towel() { return t('data.radiatorStyle.towel'); }, get convector() { return t('data.radiatorStyle.convector'); } };
export const TV_STYLES = { get stand() { return t('data.tvStyle.stand'); }, get wall() { return t('data.tvStyle.wall'); }, get curved() { return t('data.tvStyle.curved'); }, get monitor() { return t('data.tvStyle.monitor'); }, get projector() { return t('data.tvStyle.projector'); } };
export const PROJECTOR_STYLES = { get ceiling() { return t('data.projectorStyle.ceiling'); } };
export const FRAME_STYLES = { get black() { return t('data.frameStyle.black'); }, get white() { return t('data.frameStyle.white'); }, get oak() { return t('data.frameStyle.oak'); }, get alu() { return t('data.frameStyle.alu'); }, get none() { return t('data.frameStyle.none'); }, get canvas() { return t('data.frameStyle.canvas'); } };
export const FRAME_SIZES = { a4: ['A4', 0.21, 0.297], a3: ['A3', 0.297, 0.42], a2: ['A2', 0.42, 0.594], p50: ['50 × 70', 0.5, 0.7], p70: ['70 × 100', 0.7, 1.0], sq: ['50 × 50', 0.5, 0.5], pano: ['100 × 50', 1.0, 0.5] };
export const KIND_STYLES = { light: LIGHT_STYLES, radiator: RADIATOR_STYLES, tv: TV_STYLES, projector: PROJECTOR_STYLES };
// Default extra fields for a new device of this kind/style.
export function deviceDefaults(kind, style) {
  if (kind === 'light') return ({ table: { y: 0.5 }, strip: { y: 1.1, length: 1.2 }, wall: { y: 1.8 }, outdoorWall: { y: 2.0 }, pendant: { y: 1.75 }, pendantTrio: { y: 1.75, length: 1.4 }, track: { length: 1.2 } })[style] || {};
  if (kind === 'tv') return ({ stand: { y: 0.55 }, wall: { y: 0.9 }, curved: { y: 0.55 }, monitor: { y: 0.75 }, projector: { y: 0.6, length: 2.2 } })[style || 'stand'] || { y: 0.55 };
  if (kind === 'projector') return { style: 'ceiling' };
  return ({ temp: { y: 1.5 }, motion: { y: 2.3 }, thermostat: { y: 1.5 }, ac: { y: 2.15 }, speaker: { y: 0.8 }, camera: { y: 2.4 }, plug: { y: 0.3 }, frame: { y: 1.5, fw: 0.5, fh: 0.7, frame: 'black', src: 'art' } })[kind] || {};
}
export function entityMatchesKind(kind, stateObj) {
  const k = KINDS[kind]; if (!k || !stateObj) return false;
  const dom = stateObj.entity_id.split('.')[0]; if (!k.domains.includes(dom)) return false;
  if (k.dc && dom !== 'switch') return k.dc.includes(stateObj.attributes.device_class);
  return true;
}
// Suggests the kind (and style) that best represents an entity.
export function kindForEntity(s) {
  const dom = s.entity_id.split('.')[0], dc = s.attributes.device_class;
  if (dom === 'light') return { kind: 'light', style: 'ceiling' };
  if (dom === 'climate') return { kind: (s.attributes.hvac_modes || []).includes('cool') ? 'ac' : 'radiator', style: 'panel' };
  if (dom === 'sensor' && ['temperature', 'humidity'].includes(dc)) return { kind: 'temp' };
  if (dom === 'binary_sensor') { if (['motion', 'occupancy', 'presence'].includes(dc)) return { kind: 'motion' }; if (['smoke', 'carbon_monoxide', 'gas', 'safety', 'moisture'].includes(dc)) return { kind: 'smoke' }; return null; }
  if (dom === 'media_player') return { kind: dc === 'tv' || /tv|fernseh/i.test(s.entity_id) ? 'tv' : 'speaker' };
  if (dom === 'vacuum') return { kind: 'vacuum' };
  if (dom === 'lawn_mower') return { kind: 'mower' };
  if (dom === 'camera') return { kind: 'camera' };
  if (dom === 'image') return { kind: 'frame' };
  if (dom === 'fan') return { kind: 'fan' };
  if (dom === 'valve') return { kind: 'valve' };
  if (dom === 'switch' || dom === 'input_boolean') return { kind: 'plug' };
  return null;
}

const tmp = new THREE.Color();
export function lightColor(a, out = tmp) {
  if (a.rgb_color && (!a.color_mode || !['color_temp', 'white'].includes(a.color_mode))) return out.setRGB(a.rgb_color[0] / 255, a.rgb_color[1] / 255, a.rgb_color[2] / 255, THREE.SRGBColorSpace);
  const k = Math.min(6500, Math.max(2200, a.color_temp_kelvin || 3000));
  const stops = [[2200, '#ff9438'], [3000, '#ffbd7a'], [4200, '#ffe2c2'], [6500, '#dfe9ff']];
  for (let i = 0; i < stops.length - 1; i++) if (k <= stops[i + 1][0]) return out.set(stops[i][1]).lerp(new THREE.Color(stops[i + 1][1]), (k - stops[i][0]) / (stops[i + 1][0] - stops[i][0]));
  return out.set('#dfe9ff');
}
const glowMat = () => new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.6, emissive: '#000000', emissiveIntensity: 1 });
const isOn = (s) => s && ['on', 'open', 'opening', 'heat', 'cool', 'playing', 'cleaning', 'mowing', 'recording', 'streaming'].includes(s.state);

function buildLight(dev, H) {
  const st = dev.style || 'ceiling', root = new THREE.Group(), glow = glowMat(); const anchor = new THREE.Object3D(); root.add(anchor);
  const y = dev.y; let ps = 2.4, power = 6, hit = [0.5, 0.5, 0.5, 1];
  const add = (...m) => m.forEach((x) => root.add(x));
  switch (st) {
    case 'ceiling': { const yy = H - 0.12; add(at(cyl(0.28, 0.28, 0.05, glow, 40), 0, yy, 0)); anchor.position.y = yy - 0.1; ps = 3.6; power = 14; hit = [0.7, 0.4, 0.7, yy]; break; }
    case 'downlights': { const yy = H - 0.03; for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) add(at(cyl(0.05, 0.05, 0.02, glow, 20), x, yy, z)); anchor.position.y = yy - 0.2; ps = 3.8; power = 14; hit = [1.5, 0.3, 1.5, yy]; break; }
    case 'pendant': { const yy = y ?? 1.75; add(at(sphere(0.17, glow, 32, 18), 0, yy, 0), at(cyl(0.006, 0.006, H - yy - 0.15, mat(DARK), 6), 0, yy + 0.15, 0), at(cyl(0.05, 0.05, 0.02, mat(DARK)), 0, H - 0.03, 0)); anchor.position.y = yy - 0.1; ps = 2.6; power = 6; hit = [0.5, 0.6, 0.5, yy]; break; }
    case 'pendantTrio': { const yy = y ?? 1.75, L = dev.length || 1.4; add(at(box(L, 0.03, 0.08, mat(DARK), 0.01), 0, H - 0.03, 0)); for (const x of [-L / 2 + 0.2, 0, L / 2 - 0.2]) { const shade = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.18, 24, 1, true), glow); shade.material.side = THREE.DoubleSide; shade.position.set(x, yy + 0.09, 0); add(shade, at(cyl(0.004, 0.004, H - yy - 0.18, mat(DARK), 6), x, yy + 0.18, 0)); } anchor.position.y = yy - 0.1; ps = 3.0; power = 9; hit = [L, 0.5, 0.4, yy]; break; }
    case 'arc': { const base = at(box(0.3, 0.05, 0.3, mat('#f0eee9', { rough: 0.3 }), 0.02), 0, 0, -0.6); const arc = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.012, 8, 32, Math.PI * 0.62), mat(METAL, { metal: 0.8, rough: 0.3 })); arc.rotation.y = Math.PI / 2; arc.position.set(0, 1.3, 0.0); arc.rotation.z = 0; const sh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glow); sh.material.side = THREE.DoubleSide; sh.position.set(0, 1.85, 0.75); add(base, at(cyl(0.012, 0.012, 1.3, mat(METAL, { metal: 0.8 }), 8), 0, 0, -0.6), arc, sh); anchor.position.set(0, 1.7, 0.75); ps = 2.4; power = 5; hit = [0.5, 2, 1.6, 1]; break; }
    case 'floor': { add(at(cyl(0.15, 0.16, 0.025, mat(DARK, { rough: 0.4, metal: 0.5 }))), at(cyl(0.011, 0.011, 1.3, mat(DARK, { metal: 0.5, rough: 0.4 }), 8), 0, 0.02, 0), at(cyl(0.14, 0.19, 0.3, glow, 32), 0, 1.28, 0)); anchor.position.y = 1.4; ps = 2.4; power = 4; hit = [0.5, 1.6, 0.5, 0.8]; break; }
    case 'table': { const yy = y ?? 0.5; add(at(cyl(0.06, 0.07, 0.02, mat(DARK, { metal: 0.5, rough: 0.4 })), 0, yy, 0), at(cyl(0.01, 0.01, 0.18, mat(DARK), 8), 0, yy + 0.02, 0), at(cyl(0.09, 0.12, 0.16, glow, 28), 0, yy + 0.18, 0)); anchor.position.y = yy + 0.26; ps = 1.6; power = 1.6; hit = [0.35, 0.45, 0.35, yy + 0.2]; break; }
    case 'wall': { const yy = y ?? 1.8; add(at(box(0.12, 0.2, 0.06, mat(DARK), 0.02), 0, yy - 0.1, 0.03), at(cyl(0.07, 0.09, 0.16, glow, 24), 0, yy - 0.05, 0.13)); anchor.position.set(0, yy, 0.25); ps = 2.0; power = 3; hit = [0.3, 0.35, 0.35, yy]; break; }
    case 'track': { const yy = H - 0.06, L = dev.length || 1.2; add(at(box(L, 0.03, 0.04, mat(DARK), 0.008), 0, yy, 0)); for (let i = 0; i < 3; i++) { const x = -L / 2 + 0.2 + i * (L - 0.4) / 2; const c = at(cyl(0.04, 0.05, 0.14, glow, 16), x, yy - 0.2, 0); c.rotation.x = 0.4; add(c, at(cyl(0.006, 0.006, 0.08, mat(DARK), 6), x, yy - 0.08, 0)); } anchor.position.y = yy - 0.4; ps = 3; power = 9; hit = [L, 0.4, 0.4, yy - 0.15]; break; }
    case 'strip': { const L = dev.length || 1.5, yy = y ?? 1.1; add(at(box(L, 0.025, 0.03, glow, 0.008), 0, yy, 0)); anchor.position.y = yy - 0.05; ps = Math.max(1.4, L * 0.9); power = 2.2 * L; hit = [L, 0.2, 0.3, yy]; break; }
    case 'outdoorWall': { const yy = y ?? 2.0; add(at(box(0.14, 0.24, 0.12, mat('#2a2d33', { rough: 0.6 }), 0.02), 0, yy - 0.12, 0.06), at(box(0.1, 0.12, 0.02, glow, 0.005), 0, yy - 0.06, 0.13)); anchor.position.set(0, yy - 0.2, 0.4); ps = 3.2; power = 5; hit = [0.3, 0.4, 0.4, yy]; break; }
    case 'bollard': { add(at(cyl(0.07, 0.08, 0.7, mat('#2a2d33', { rough: 0.6, metal: 0.4 }), 16)), at(cyl(0.065, 0.065, 0.1, glow, 16), 0, 0.55, 0)); anchor.position.y = 0.6; ps = 2.2; power = 2.5; hit = [0.3, 0.8, 0.3, 0.4]; break; }
  }
  const pl = lightPool(ps); pl.position.y = 0.04; if (st === 'strip' || st === 'track' || st === 'pendantTrio') pl.scale.set(1.4, 0.7, 1); if (st === 'wall' || st === 'outdoorWall' || st === 'arc') pl.position.z = 0.6; root.add(pl);
  const em = { anchor, color: new THREE.Color(), power: 0, max: power };
  let cur = 0;
  return {
    root, hit, emitters: [em],
    update(s, dt, t, env) {
      const a = s?.attributes || {}; const tgt = s?.state === 'on' ? (a.brightness ?? 255) / 255 : 0;
      cur += (tgt - cur) * Math.min(1, dt * 7);
      const col = lightColor(a);
      glow.emissive.copy(col); glow.emissiveIntensity = cur * 2.4;
      em.color.copy(col); em.power = power * cur;
      pl.material.color.copy(col); pl.material.opacity = cur * (env.day ? 0.22 : 0.55);
    },
  };
}

export function buildDevice(dev, ctx) {
  const H = ctx.height ?? 2.6, y = dev.y, root = new THREE.Group();
  const ret = (o) => ({ emitters: [], update() {}, ...o, root });
  switch (dev.kind) {
    case 'light': return buildLight(dev, H);
    case 'radiator': {
      const st = dev.style || 'panel', m = new THREE.MeshStandardMaterial({ color: '#efeeea', roughness: 0.5, emissive: '#ff5a1f', emissiveIntensity: 0 });
      let w, h, y0;
      if (st === 'towel') { w = 0.5; h = 1.2; y0 = 0.3; for (let i = 0; i < 10; i++) root.add(at(box(w, 0.05, 0.06, m, 0.02), 0, y0 + i * (h / 10), 0)); for (const sx of [-1, 1]) root.add(at(box(0.04, h, 0.04, m, 0.01), sx * w / 2, y0, 0)); }
      else if (st === 'convector') { w = dev.length || 1.6; h = 0.02; y0 = 0; root.add(at(box(w, 0.02, 0.3, mat('#3a3f4b', { metal: 0.5 }), 0.004))); for (let i = 0; i < w / 0.04; i++) root.add(at(box(0.012, 0.022, 0.26, m, 0), -w / 2 + 0.02 + i * 0.04, 0.0, 0)); }
      else { w = dev.length || 0.9; h = 0.55; y0 = 0.12; const n = Math.round(w / 0.075); for (let i = 0; i < n; i++) root.add(at(box(0.05, h, 0.08, m, 0.02), -w / 2 + (i + 0.5) * (w / n), y0, 0)); root.add(at(cyl(0.025, 0.025, 0.07, mat('#d7d7d3'), 12), w / 2 + 0.04, y0 + h - 0.08, 0)); }
      const pl = lightPool(1.4); pl.position.set(0, 0.04, 0.4); pl.material.color.set('#ff6a2a'); root.add(pl);
      let cur = 0;
      return ret({ hit: [w + 0.1, Math.max(h, 0.2) + 0.1, 0.3, y0 + h / 2], update(s, dt, t) { const tgt = s?.attributes?.hvac_action === 'heating' ? 1 : 0; cur += (tgt - cur) * Math.min(1, dt * 2); m.emissiveIntensity = cur * (0.28 + 0.08 * Math.sin(t * 2)); pl.material.opacity = cur * 0.3; } });
    }
    case 'thermostat': {
      const yy = y ?? 1.5, disp = new THREE.MeshStandardMaterial({ color: '#0c0d10', emissive: '#ff8a3d', emissiveIntensity: 0.8 });
      root.add(at(box(0.09, 0.09, 0.025, mat('#f1f1ee', { rough: 0.4 }), 0.015), 0, yy, 0.012), at(box(0.05, 0.03, 0.004, disp, 0.002), 0, yy + 0.045, 0.026));
      return ret({ hit: [0.3, 0.3, 0.25, yy + 0.04], update(s) { disp.emissive.set(s?.attributes?.hvac_action === 'heating' ? '#ff8a3d' : s?.attributes?.hvac_action === 'cooling' ? '#5fb8ff' : '#5fd39a'); } });
    }
    case 'ac': {
      const yy = y ?? 2.15; root.add(at(box(0.9, 0.3, 0.22, mat('#f4f4f2', { rough: 0.35 }), 0.06), 0, yy, 0.11));
      const flap = at(box(0.8, 0.03, 0.06, mat('#d9d9d6'), 0.01), 0, yy + 0.02, 0.21); root.add(flap);
      const led = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#5fb8ff', emissiveIntensity: 0 }); root.add(at(box(0.03, 0.012, 0.004, led, 0.002), 0.36, yy + 0.22, 0.222));
      const air = []; const am = new THREE.MeshBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      for (let i = 0; i < 5; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.18), am.clone()); p.rotation.x = -0.9; p.userData.roomEffect = true; root.add(p); air.push(p); }
      let cur = 0;
      return ret({ hit: [1, 0.4, 0.4, yy + 0.15], update(s, dt, t) {
        const a = s?.attributes || {}; const act = ['cooling', 'heating', 'fan', 'drying'].includes(a.hvac_action) || (s?.entity_id?.startsWith('fan.') && s.state === 'on');
        cur += ((act ? 1 : 0) - cur) * Math.min(1, dt * 3); flap.rotation.x = cur * 0.7; led.emissiveIntensity = act ? 1.5 : 0.2;
        const col = a.hvac_action === 'heating' ? '#ffc6a3' : '#bfe3ff';
        air.forEach((p, i) => { const q = (t * 0.45 + i / air.length) % 1; p.position.set(0, yy - q * 1.1, 0.3 + q * 1.3); p.scale.set(1 + q * 0.8, 1, 1); p.material.color.set(col); p.material.opacity = cur * Math.sin(q * Math.PI) * 0.22; });
      } });
    }
    case 'fan': {
      const hub = new THREE.Group(); hub.position.y = H - 0.38; root.add(at(cyl(0.015, 0.015, 0.3, mat(DARK), 8), 0, H - 0.3, 0), at(cyl(0.09, 0.07, 0.12, mat('#d9d6cf', { rough: 0.5 }), 20), 0, H - 0.42, 0), hub);
      for (let i = 0; i < 4; i++) { const b = at(box(0.6, 0.012, 0.13, mat('#8a6a4c', { rough: 0.6 }), 0.01), 0.38, 0, 0); const pv = new THREE.Group(); pv.rotation.y = (i * Math.PI) / 2; pv.add(b); hub.add(pv); }
      let spd = 0;
      return ret({ hit: [1.6, 0.4, 1.6, H - 0.4], update(s, dt) { const on = s?.state === 'on'; const tgt = on ? 2 + ((s?.attributes?.percentage ?? 60) / 100) * 8 : 0; spd += (tgt - spd) * Math.min(1, dt * 1.2); hub.rotation.y += spd * dt; } });
    }
    case 'temp': {
      const yy = y ?? 1.5, led = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#5fd39a', emissiveIntensity: 1.5 });
      root.add(at(box(0.08, 0.08, 0.025, mat('#f1f1ee', { rough: 0.4 }), 0.012), 0, yy, 0.012), at(box(0.012, 0.012, 0.005, led, 0), 0.022, yy + 0.05, 0.026));
      return ret({ hit: [0.3, 0.3, 0.25, yy + 0.04], update(s) { const v = parseFloat(s?.state); led.emissive.set(s?.attributes?.device_class === 'humidity' ? (v > 65 ? '#ff7a45' : '#79a6ff') : v < 19 ? '#79a6ff' : v > 24 ? '#ff7a45' : '#5fd39a'); } });
    }
    case 'motion': case 'smoke': {
      const yy = y ?? (dev.kind === 'smoke' ? H - 0.02 : 2.3), smoke = dev.kind === 'smoke';
      const led = new THREE.MeshStandardMaterial({ color: '#f2f2ef', roughness: 0.3, emissive: smoke ? '#ff3b3b' : '#79a6ff', emissiveIntensity: 0 });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(smoke ? 0.07 : 0.05, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), led); dome.rotation.x = Math.PI; dome.position.y = yy; root.add(dome);
      if (smoke) root.add(at(cyl(0.075, 0.075, 0.02, mat('#f2f2ef'), 24), 0, yy - 0.02, 0));
      const rings = [pulseRing(smoke ? '#ff3b3b' : '#79a6ff'), pulseRing(smoke ? '#ff3b3b' : '#79a6ff')]; rings.forEach((r) => { r.position.y = 0.05; root.add(r); });
      return ret({ hit: [0.3, 0.3, 0.3, yy - 0.05], update(s, dt, t) {
        const act = s?.state === 'on'; led.emissiveIntensity = act ? (smoke ? (Math.sin(t * 12) > 0 ? 3 : 0) : 2) : 0;
        rings.forEach((r, i) => { const p = (t * (smoke ? 1.2 : 0.6) + i * 0.5) % 1; r.scale.setScalar(0.2 + p * (smoke ? 3 : 1.8)); r.material.opacity = act ? (1 - p) * 0.55 : 0; });
      } });
    }
    case 'plug': {
      const yy = y ?? 0.3, led = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#5fd39a', emissiveIntensity: 0 });
      root.add(at(box(0.08, 0.08, 0.02, mat('#f1f1ee', { rough: 0.4 }), 0.01), 0, yy, 0.01), at(cyl(0.025, 0.025, 0.035, mat('#e6e6e3'), 16), 0, yy + 0.04, 0.0), at(box(0.008, 0.008, 0.004, led, 0), 0.028, yy + 0.068, 0.022));
      root.children[1].rotation.x = Math.PI / 2; root.children[1].position.set(0, yy + 0.04, 0.02);
      return ret({ hit: [0.25, 0.25, 0.2, yy + 0.04], update(s) { led.emissiveIntensity = s?.state === 'on' ? 2 : 0; } });
    }
    case 'tv': {
      const st = dev.style || 'stand', proj = st === 'projector', mon = st === 'monitor';
      const w = dev.length || (proj ? 2.2 : mon ? 0.62 : 1.42), h = w * 0.5625, yy = y ?? (proj ? 0.6 : mon ? 0.75 : st === 'wall' ? 0.9 : 0.55);
      const scrM = screenMaterial(), bind = bindScreen(scrM, { glowPower: proj ? 1.6 : 2.5 }), dark = mat('#24272e', { rough: 0.4 });
      const R = st === 'curved' ? (dev.curve || 4) : 0; const front = 0.002;
      let sy; // bottom of the picture
      if (proj) { // independently placeable projector screen
        sy = yy; root.add(at(box(w + 0.1, h + 0.12, 0.02, mat('#1b1d22'), 0.004), 0, yy - 0.06, 0.01), at(box(w + 0.16, 0.08, 0.1, mat('#e9e9e6'), 0.02), 0, yy + h + 0.06, 0.05));
      } else if (st === 'wall') {
        sy = yy + 0.02; root.add(at(box(w, h + 0.04, 0.035, dark, 0.008), 0, yy, 0.0175));
      } else { // stand, monitor, curved
        sy = yy + 0.12; root.add(at(box(0.36, 0.02, 0.2, dark, 0.005), 0, yy, 0), at(box(0.04, 0.12, 0.04, dark), 0, yy, -0.02));
        if (R > 0) { const back = new THREE.Mesh(screenGeometry(w + 0.02, h + 0.04, R), new THREE.MeshStandardMaterial({ color: '#24272e', roughness: 0.4, side: THREE.DoubleSide })); back.position.set(0, yy + 0.1, -0.02); root.add(back); }
        else root.add(at(box(w, h + 0.04, 0.04, dark, 0.008), 0, yy + 0.1, -0.02));
      }
      const scr = new THREE.Mesh(screenGeometry(w - 0.04, h, R), scrM); scr.position.set(0, sy, proj ? 0.0215 : st === 'wall' ? 0.036 : front + (R > 0 ? 0.002 : 0)); scr.userData.role = 'screen'; root.add(scr);
      const pl = lightPool(proj ? 3 : 2.2); pl.position.set(0, 0.04, proj ? 1.6 : 1.0); root.add(pl);
      const anchor = new THREE.Object3D(); anchor.position.set(0, sy + h * 0.5, 0.6); root.add(anchor); bind.emitter.anchor = anchor;
      return ret({ hit: [w + 0.1, h + 0.2, 0.3, sy + h / 2], emitters: [bind.emitter], animating: bind.animating, dispose: () => bind.dispose(), update(s, dt, t, env) { bind.update(s, dt, t, env); const on = bind.emitter.power > 0.01 ? 1 : 0; bind.extra?.(on); pl.material.color.copy(bind.emitter.color); pl.material.opacity = Math.min(0.3, bind.emitter.power * 0.1); } });
    }
    case 'projector': {
      const yy = y ?? H - 0.37;
      const body = mat('#e9e9e6', { rough: 0.4 });
      const lens = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#bcd3ff', emissiveIntensity: 0 });
      root.add(at(box(0.32, 0.12, 0.26, body, 0.03), 0, yy, 0), at(cyl(0.012, 0.012, Math.max(0.05, H - yy - 0.12), mat(DARK), 8), 0, yy + 0.11, 0));
      const lensMesh = at(cyl(0.035, 0.035, 0.02, lens, 16), 0, yy + 0.06, -0.135); lensMesh.rotation.x = Math.PI / 2; root.add(lensMesh);
      return ret({ hit: [0.42, 0.3, 0.4, yy + 0.06], update(s) { lens.emissiveIntensity = s && !['off', 'standby', 'unavailable', 'unknown'].includes(s.state) ? 2 : 0; } });
    }
    case 'speaker': {
      const yy = y ?? 0, lr = new THREE.MeshStandardMaterial({ color: '#2a2d35', emissive: '#ffffff', emissiveIntensity: 0 });
      root.add(at(cyl(0.07, 0.075, 0.2, mat('#3a3e48', { rough: 0.95 }), 24), 0, yy, 0), at(cyl(0.072, 0.072, 0.01, lr, 24), 0, yy + 0.2, 0));
      const rings = [pulseRing('#ffb35c'), pulseRing('#ffb35c')]; rings.forEach((r) => { r.position.y = yy + 0.02; root.add(r); });
      const barM = new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.9 }); const bars = [];
      for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1, 0.018), barM); b.geometry.translate(0, 0.5, 0); b.position.set(-0.05 + i * 0.025, yy + 0.24, 0); b.visible = false; root.add(b); bars.push(b); }
      const label = new Label(); label.sprite.position.set(0, yy + 0.55, 0); label.sprite.visible = false; root.add(label.sprite);
      return ret({ hit: [0.3, 0.35, 0.3, yy + 0.1], animating: (s) => s?.state === 'playing', dispose: () => label.dispose(), update(s, dt, t, env) {
        const p = s?.state === 'playing', a = s?.attributes || {}; lr.emissiveIntensity = p ? 0.6 + 0.4 * Math.sin(t * 6) : 0;
        rings.forEach((r, i) => { const q = (t * 0.8 + i * 0.5) % 1; r.scale.setScalar(0.1 + q * 0.6); r.material.opacity = p && !env.perf ? (1 - q) * 0.6 : 0; });
        bars.forEach((b, i) => { b.visible = p; if (p) b.scale.y = env.perf ? 0.05 : 0.02 + 0.07 * Math.abs(Math.sin(t * (3.1 + i * 0.9) + i * 1.7) * Math.sin(t * (1.3 + i * 0.4))); });
        const txt = p && !env.editing && a.media_title ? `${a.media_title}${a.media_artist ? ' – ' + a.media_artist : ''}` : ''; label.set(txt); label.sprite.visible = !!txt;
      } });
    }
    case 'frame': {
      const fw = dev.fw || 0.5, fh = dev.fh || 0.7, yy = y ?? 1.5, style = dev.frame || 'black';
      const B = { black: 0.02, white: 0.03, oak: 0.035, alu: 0.012, none: 0, canvas: 0 }[style] ?? 0.02, D = style === 'canvas' ? 0.035 : style === 'none' ? 0.002 : 0.025;
      const fm = mat({ black: '#16171b', white: '#f2f1ec', oak: '#b68a5a', alu: '#b9bec5', none: '#fff', canvas: '#e8e4da' }[style] || '#16171b', { rough: style === 'alu' ? 0.35 : 0.6, metal: style === 'alu' ? 0.6 : 0 });
      const y0 = yy - fh / 2; if (style !== 'none') root.add(at(box(fw, fh, D, fm, style === 'canvas' ? 0.004 : 0.003), 0, y0, D / 2));
      const pass = dev.passe && style !== 'none' && style !== 'canvas' ? Math.min(fw, fh) * 0.12 : 0;
      if (pass) root.add(at(new THREE.Mesh(new THREE.PlaneGeometry(fw - 2 * B, fh - 2 * B), mat('#f7f5ef', { rough: 0.9 })), 0, yy, D + 0.001));
      const iw = fw - 2 * (B + pass), ih = fh - 2 * (B + pass); const pics = [0, 1].map((k) => { const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.08, transparent: k === 1, opacity: k === 1 ? 0 : 1 }); const p = new THREE.Mesh(new THREE.PlaneGeometry(iw, ih), m); p.position.set(0, yy, D + 0.002 + k * 0.0008); p.userData.role = 'screen'; root.add(p); return p; });
      const makeTexture = (img) => { const tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; const ia = (img.width || 1) / (img.height || 1), fa = iw / ih; if (ia > fa) { tex.repeat.set(fa / ia, 1); tex.offset.set((1 - fa / ia) / 2, 0); } else { tex.repeat.set(1, ia / fa); tex.offset.set(0, (1 - ia / fa) / 2); } return tex; };
      const art = generativeArt(dev.id || 'frame', 512, Math.round(512 * (ih / iw))); let shown = null, fade = 1, folder = { idx: -1, item: null, url: null, resolvedAt: 0, retryAt: 0, missingAt: 0, pending: false }, camAt = 0, camUrl = null;
      const show = (img) => { if (!img || img === shown) return; const tex = makeTexture(img); if (!shown) { pics[0].material.map = tex; pics[0].material.emissiveMap = tex; pics[0].material.needsUpdate = true; } else { const pending = pics[1].material.map; if (pending && pending !== pics[0].material.map) pending.dispose(); pics[1].material.map = tex; pics[1].material.emissiveMap = tex; pics[1].material.needsUpdate = true; fade = 0; } shown = img; };
      const resolveFolder = (media, item, idx, force = false) => { if (folder.pending) return; folder.pending = true; media.resolveItem(item, { maxAge: 2400000, force }).then((url) => { if (folder.idx === idx && folder.item === item) { folder.url = url; folder.resolvedAt = Date.now(); folder.retryAt = 0; folder.missingAt = 0; } }).catch(() => { folder.retryAt = Date.now() + 30000; }).finally(() => { folder.pending = false; }); };
      return ret({ hit: [fw + 0.05, fh + 0.05, 0.12, yy], animating: () => fade < 1, dispose() { const a = pics[0].material.map, b = pics[1].material.map; a?.dispose(); if (b && b !== a) b.dispose(); }, update(s, dt, t, env) {
        const media = env.media, src = dev.src || 'art', iv = Math.max(30, dev.interval || 60) * 1000, now = Date.now(); let img = null;
        if (src === 'upload') img = media?.image(`/api/hometwin/underlay/art_${dev.id}?v=${dev.artV || 0}`, { auth: true });
        else if (src === 'entity' && s) { const u = s.attributes?.entity_picture; if (s.entity_id.startsWith('camera.')) { if (!camUrl || now - camAt > iv) { camUrl = u; camAt = now; } img = media?.image(camUrl, { maxAge: iv }); } else if (s.entity_id.startsWith('image.')) { camUrl = u; img = media?.image(camUrl, { maxAge: 60000 }); } else { camUrl = media?.resolve(u) ? u : `/api/media_player_proxy/${s.entity_id}`; img = media?.image(camUrl, { maxAge: 60000 }); } }
        else if (src === 'folder' && dev.folder && media) { const items = media.folder(dev.folder) || []; if (items.length) { const idx = Math.floor(now / iv) % items.length, item = items[idx]; if (idx !== folder.idx || item !== folder.item) folder = { idx, item, url: null, resolvedAt: 0, retryAt: 0, missingAt: 0, pending: false }; if (!folder.pending && (!folder.url || now - folder.resolvedAt >= 2400000) && now >= folder.retryAt) resolveFolder(media, item, idx); img = media.image(folder.url, { maxAge: iv }); if (folder.url && !img) { folder.missingAt ||= now; if (!folder.pending && now - folder.missingAt >= 30000 && now >= folder.retryAt) resolveFolder(media, item, idx, true); } else if (img) folder.missingAt = 0; } }
        show(img || (src === 'art' || !shown ? art : null));
        if (fade < 1) { fade = Math.min(1, fade + dt / (env.perf ? 0.05 : 1.2)); pics[1].material.opacity = fade; if (fade >= 1) { const old = pics[0].material.map, next = pics[1].material.map; pics[0].material.map = next; pics[0].material.emissiveMap = next; pics[0].material.needsUpdate = true; pics[1].material.map = null; pics[1].material.emissiveMap = null; pics[1].material.opacity = 0; pics[1].material.needsUpdate = true; if (old && old !== next) old.dispose(); } }
      } });
    }
    case 'washer': {
      const body = mat('#f2f2ef', { rough: 0.35 }); root.add(at(box(0.6, 0.85, 0.6, body, 0.03), 0, 0, 0), at(box(0.6, 0.12, 0.02, mat('#dcdcd8'), 0.005), 0, 0.73, 0.3));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 32), mat('#b9bec5', { metal: 0.6, rough: 0.3 })); ring.position.set(0, 0.42, 0.305); root.add(ring);
      const drum = new THREE.Group(); drum.position.set(0, 0.42, 0.29); root.add(drum);
      const dm = new THREE.MeshStandardMaterial({ color: '#8e96a3', metalness: 0.5, roughness: 0.4 }); drum.add(new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), dm));
      for (let i = 0; i < 3; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.01), mat('#cfd3d8')); fin.position.set(Math.cos(i * 2.1) * 0.09, Math.sin(i * 2.1) * 0.09, 0.006); fin.rotation.z = i * 2.1 + Math.PI / 2; drum.add(fin); }
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), new THREE.MeshStandardMaterial({ color: '#9cc0ff', transparent: true, opacity: 0.25, roughness: 0.05 })); glass.position.set(0, 0.42, 0.31); root.add(glass);
      const led = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#5fd39a', emissiveIntensity: 0 }); root.add(at(box(0.05, 0.015, 0.004, led, 0), 0.18, 0.78, 0.312));
      let spd = 0; const active = (s) => { const v = parseFloat(s?.state); return ['on', 'running', 'wash', 'washing', 'rinse', 'spin', 'spinning', 'drying', 'dry'].includes(String(s?.state).toLowerCase()) || (Number.isFinite(v) && v > 5); };
      return ret({ hit: [0.65, 0.9, 0.65, 0.43], animating: active, update(s, dt, t) { const on = active(s); spd += ((on ? 6 + 4 * Math.max(0, Math.sin(t * 0.3)) : 0) - spd) * Math.min(1, dt); drum.rotation.z -= spd * dt; led.emissiveIntensity = on ? 1.5 : 0; } });
    }
    case 'fireplace': {
      const w = dev.length || 1.0, bm = mat('#2b2d31', { rough: 0.8 }), cw = w * 0.7; // body with an open fire box (cavity)
      root.add(at(box(w, 0.9, 0.2, bm, 0.01), 0, 0, 0.1), at(box(w, 0.15, 0.42, bm, 0.01), 0, 0, 0.21), at(box(w, 0.3, 0.42, bm, 0.01), 0, 0.6, 0.21), at(box((w - cw) / 2, 0.45, 0.42, bm, 0.005), -(w + cw) / 4, 0.15, 0.21), at(box((w - cw) / 2, 0.45, 0.42, bm, 0.005), (w + cw) / 4, 0.15, 0.21),
        at(box(cw, 0.45, 0.01, mat('#0b0b0c', { rough: 1 })), 0, 0.15, 0.205), at(box(w + 0.1, 0.06, 0.5, mat('#4a4744'), 0.01), 0, 0.9, 0.24));
      for (let i = 0; i < 3; i++) { const l = at(cyl(0.035, 0.035, cw * 0.8, mat('#5b3a22'), 8), cw * 0.4, 0.19 + (i === 1 ? 0.05 : 0), 0.26 + i * 0.05); l.rotation.z = Math.PI / 2; root.add(l); }
      const fm = new THREE.MeshBasicMaterial({ color: '#ff9a3c', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }); const flames = [];
      for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 6, 1, true), fm.clone()); f.geometry.translate(0, 0.11, 0); f.position.set(-cw * 0.32 + i * cw * 0.16, 0.22, 0.32); flames.push(f); root.add(f); }
      const anchor = new THREE.Object3D(); anchor.position.set(0, 0.4, 0.8); root.add(anchor); const em = { anchor, color: new THREE.Color('#ff8a3d'), power: 0 }; let cur = 0;
      const active = (s) => ['on', 'heat', 'heating'].includes(s?.state) || s?.attributes?.hvac_action === 'heating';
      return ret({ hit: [w + 0.1, 1.0, 0.5, 0.45], emitters: [em], animating: active, update(s, dt, t, env) {
        cur += ((active(s) ? 1 : 0) - cur) * Math.min(1, dt * 2);
        flames.forEach((f, i) => { const n = env.perf ? 0.85 : 0.7 + 0.3 * Math.sin(t * (7 + i) + i * 2) * Math.sin(t * (3.3 + i * 0.7)); f.scale.set(1, n * cur + 0.001, 1); f.material.opacity = cur * 0.85; });
        em.power = cur * (1.4 + (env.perf ? 0 : 0.3 * Math.sin(t * 9) * Math.sin(t * 4.1)));
      } });
    }
    case 'vacuum': case 'mower': {
      const mower = dev.kind === 'mower', body = new THREE.Group(), lr = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#5fd39a', emissiveIntensity: 1.2 });
      if (mower) body.add(at(box(0.55, 0.22, 0.7, mat('#e0e2df', { rough: 0.4 }), 0.1), 0, 0.06, 0), at(box(0.3, 0.02, 0.3, lr, 0.01), 0, 0.28, 0.05));
      else body.add(at(cyl(0.17, 0.17, 0.08, mat('#2a2d35', { rough: 0.4 }), 32), 0, 0.01, 0), at(cyl(0.06, 0.06, 0.012, lr, 24), 0, 0.09, 0.05), at(cyl(0.035, 0.035, 0.02, mat('#4a4f5b'), 16), 0, 0.09, -0.06));
      root.add(at(box(mower ? 0.7 : 0.3, mower ? 0.05 : 0.1, mower ? 0.9 : 0.1, mat(mower ? '#4a4f5b' : '#e8e7e2', { rough: 0.5 }), 0.02), 0, 0, mower ? 0 : -0.18), body);
      let ang = 0; const v = new THREE.Vector3(), axis = new THREE.Vector3(0, 1, 0);
      return ret({ hit: [0.6, 0.3, 0.7, 0.1], update(s, dt, t, env) {
        const working = s?.state === (mower ? 'mowing' : 'cleaning'); lr.emissive.set(working ? '#79a6ff' : s?.state === 'error' ? '#ff3b3b' : '#5fd39a');
        const r = env.room;
        if (working && r) {
          ang += dt * (mower ? 0.2 : 0.35);
          v.set(r.cx + Math.cos(ang) * (r.w / 2 - 0.8) - dev.pos[0], 0, r.cz + Math.sin(ang * 2) * (r.d / 2 - 0.9) - dev.pos[1]).applyAxisAngle(axis, -root.rotation.y);
          body.position.lerp(v, Math.min(1, dt * 3)); body.rotation.y = -ang * 2;
        } else { body.position.lerp(v.set(0, 0, 0), Math.min(1, dt * 1.5)); }
      } });
    }
    case 'valve': {
      root.add(at(cyl(0.05, 0.05, 0.12, mat('#3a3f4b'), 12)), at(cyl(0.02, 0.02, 0.06, mat('#5c8f45'), 8), 0, 0.12, 0));
      const drops = []; const dm = new THREE.MeshBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0, depthWrite: false });
      for (let i = 0; i < 24; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), dm.clone()); d.userData.roomEffect = true; root.add(d); drops.push({ m: d, a: (i / 24) * Math.PI * 2, o: i / 24 }); }
      return ret({ hit: [0.4, 0.4, 0.4, 0.15], update(s, dt, t) { const on = s?.state === 'on' || s?.state === 'open'; drops.forEach((d) => { const q = (t * 0.7 + d.o) % 1; const rr = q * 2.2; d.m.position.set(Math.cos(d.a + t * 0.3) * rr, 0.2 + Math.sin(q * Math.PI) * 0.9, Math.sin(d.a + t * 0.3) * rr); d.m.material.opacity = on ? 0.7 * (1 - q) : 0; }); } });
    }
    case 'camera': {
      const yy = y ?? 2.4; const head = new THREE.Group(); head.position.set(0, yy, 0.08); head.rotation.x = 0.45;
      head.add(at(box(0.1, 0.09, 0.2, mat('#f1f1ee', { rough: 0.4 }), 0.03), 0, -0.045, 0), at(cyl(0.03, 0.03, 0.02, mat('#0d0f14', { rough: 0.1 }), 16), 0, 0, 0.11));
      head.children[1].rotation.x = Math.PI / 2; head.children[1].position.set(0, 0, 0.1);
      const rec = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#ff3b3b', emissiveIntensity: 0 }); head.add(at(box(0.012, 0.012, 0.004, rec, 0), 0.035, 0.02, 0.1));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4, 4, 1, true), new THREE.MeshBasicMaterial({ color: '#79a6ff', transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
      cone.geometry.translate(0, -2, 0); cone.rotation.x = -Math.PI / 2; cone.rotation.y = Math.PI / 4; cone.position.z = 0.1; cone.userData.pool = true; cone.userData.roomEffect = true; head.add(cone);
      root.add(at(box(0.08, 0.12, 0.03, mat('#f1f1ee'), 0.01), 0, yy - 0.06, 0.015), head);
      return ret({ hit: [0.3, 0.3, 0.4, yy], camera: true, update(s, dt, t, env) { rec.emissiveIntensity = (s?.state === 'recording' || s?.state === 'streaming') && Math.sin(t * 4) > 0 ? 2 : 0.3; cone.visible = env.editing || env.showCones; } });
    }
  }
  root.add(at(box(0.2, 0.2, 0.2, mat('#888')), 0, 0, 0));
  return ret({ hit: [0.3, 0.3, 0.3, 0.15] });
}
