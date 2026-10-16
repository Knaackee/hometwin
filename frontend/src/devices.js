// Entity-bound assets. Each builder returns
//   { root, hit: [w, h, d, yCenter], emitters: [{ anchor, color, power }], update(state, dt, t, env) }
// root stands on the floor at the device position; emitters are picked up by the scene's
// shared pool of real lights (only the brightest ones get a THREE light, the rest glow).
import * as THREE from 'three';
import { box, cyl, sphere, at, group, mat, lightPool, pulseRing } from './kit.js';

const DARK = '#23262e', METAL = '#a8adb5';

export const KINDS = {
  light: { label: 'Leuchte', icon: 'bulb', cat: 'Licht', domains: ['light'] },
  radiator: { label: 'Heizkörper', icon: 'flame', cat: 'Klima', domains: ['climate'] },
  thermostat: { label: 'Thermostat', icon: 'thermo', cat: 'Klima', domains: ['climate'] },
  ac: { label: 'Klimagerät', icon: 'wind', cat: 'Klima', domains: ['climate', 'fan'] },
  fan: { label: 'Deckenventilator', icon: 'fan', cat: 'Klima', domains: ['fan', 'switch'] },
  temp: { label: 'Temperatursensor', icon: 'thermo', cat: 'Sensoren', domains: ['sensor'], dc: ['temperature', 'humidity'] },
  motion: { label: 'Bewegungsmelder', icon: 'motion', cat: 'Sensoren', domains: ['binary_sensor'], dc: ['motion', 'occupancy', 'presence'] },
  smoke: { label: 'Rauchmelder', icon: 'alarm', cat: 'Sensoren', domains: ['binary_sensor'], dc: ['smoke', 'carbon_monoxide', 'gas', 'safety', 'moisture'] },
  plug: { label: 'Steckdose / Schalter', icon: 'plug', cat: 'Geräte', domains: ['switch', 'input_boolean'] },
  tv: { label: 'Fernseher', icon: 'tv', cat: 'Medien', domains: ['media_player'] },
  speaker: { label: 'Lautsprecher', icon: 'speaker', cat: 'Medien', domains: ['media_player'] },
  vacuum: { label: 'Saugroboter', icon: 'robot', cat: 'Geräte', domains: ['vacuum'] },
  mower: { label: 'Mähroboter', icon: 'robot', cat: 'Garten', domains: ['lawn_mower'] },
  valve: { label: 'Bewässerung', icon: 'drop', cat: 'Garten', domains: ['valve', 'switch'] },
  camera: { label: 'Kamera', icon: 'camera', cat: 'Sicherheit', domains: ['camera'] },
};
export const LIGHT_STYLES = {
  ceiling: 'Deckenleuchte', downlights: 'Einbauspots', pendant: 'Pendelleuchte', pendantTrio: 'Pendelgruppe', arc: 'Bogenlampe', floor: 'Stehlampe',
  table: 'Tischlampe', wall: 'Wandleuchte', track: 'Strahlerschiene', strip: 'LED-Streifen', outdoorWall: 'Außenwandleuchte', bollard: 'Wegeleuchte',
};
export const RADIATOR_STYLES = { panel: 'Flachheizkörper', towel: 'Handtuchheizkörper', convector: 'Bodenkonvektor' };
export const KIND_STYLES = { light: LIGHT_STYLES, radiator: RADIATOR_STYLES };
// Default extra fields for a new device of this kind/style.
export function deviceDefaults(kind, style) {
  if (kind === 'light') return ({ table: { y: 0.5 }, strip: { y: 1.1, length: 1.2 }, wall: { y: 1.8 }, outdoorWall: { y: 2.0 }, pendant: { y: 1.75 }, pendantTrio: { y: 1.75, length: 1.4 }, track: { length: 1.2 } })[style] || {};
  return ({ temp: { y: 1.5 }, motion: { y: 2.3 }, thermostat: { y: 1.5 }, ac: { y: 2.15 }, tv: { y: 0.55 }, speaker: { y: 0.8 }, camera: { y: 2.4 }, plug: { y: 0.3 } })[kind] || {};
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
      for (let i = 0; i < 5; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.18), am.clone()); p.rotation.x = -0.9; root.add(p); air.push(p); }
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
      const yy = y ?? 0.55, scr = new THREE.MeshStandardMaterial({ color: '#05070c', roughness: 0.25, emissive: '#000', emissiveIntensity: 1 });
      const w = dev.length || 1.42, h = w * 0.5625;
      root.add(at(box(0.36, 0.02, 0.2, mat('#24272e'), 0.005), 0, yy, 0), at(box(0.04, 0.12, 0.04, mat('#24272e')), 0, yy, -0.02), at(box(w, h + 0.04, 0.04, mat('#24272e', { rough: 0.4 }), 0.008), 0, yy + 0.1, -0.02), at(box(w - 0.04, h, 0.005, scr, 0), 0, yy + 0.12, 0.002));
      const pl = lightPool(2.2); pl.position.set(0, 0.04, 1.0); root.add(pl);
      const anchor = new THREE.Object3D(); anchor.position.set(0, yy + 0.5, 0.6); root.add(anchor); const em = { anchor, color: new THREE.Color(), power: 0 };
      let cur = 0;
      return ret({ hit: [w + 0.1, h + 0.2, 0.3, yy + 0.5], emitters: [em], update(s, dt, t) {
        cur += ((s?.state === 'playing' || s?.state === 'on' ? 1 : 0) - cur) * Math.min(1, dt * 4);
        tmp.setHSL(0.58 + 0.06 * Math.sin(t * 0.7), 0.6, 0.5); scr.emissive.copy(tmp); scr.emissiveIntensity = cur * (1.1 + 0.25 * Math.sin(t * 3.1) * Math.sin(t * 1.3));
        em.color.copy(tmp); em.power = cur * 2.5; pl.material.color.copy(tmp); pl.material.opacity = cur * 0.25;
      } });
    }
    case 'speaker': {
      const yy = y ?? 0, lr = new THREE.MeshStandardMaterial({ color: '#2a2d35', emissive: '#ffffff', emissiveIntensity: 0 });
      root.add(at(cyl(0.07, 0.075, 0.2, mat('#3a3e48', { rough: 0.95 }), 24), 0, yy, 0), at(cyl(0.072, 0.072, 0.01, lr, 24), 0, yy + 0.2, 0));
      const rings = [pulseRing('#ffb35c'), pulseRing('#ffb35c')]; rings.forEach((r) => { r.position.y = yy + 0.02; root.add(r); });
      return ret({ hit: [0.3, 0.35, 0.3, yy + 0.1], update(s, dt, t) { const p = s?.state === 'playing'; lr.emissiveIntensity = p ? 0.6 + 0.4 * Math.sin(t * 6) : 0; rings.forEach((r, i) => { const q = (t * 0.8 + i * 0.5) % 1; r.scale.setScalar(0.1 + q * 0.6); r.material.opacity = p ? (1 - q) * 0.6 : 0; }); } });
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
      for (let i = 0; i < 24; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), dm.clone()); root.add(d); drops.push({ m: d, a: (i / 24) * Math.PI * 2, o: i / 24 }); }
      return ret({ hit: [0.4, 0.4, 0.4, 0.15], update(s, dt, t) { const on = s?.state === 'on' || s?.state === 'open'; drops.forEach((d) => { const q = (t * 0.7 + d.o) % 1; const rr = q * 2.2; d.m.position.set(Math.cos(d.a + t * 0.3) * rr, 0.2 + Math.sin(q * Math.PI) * 0.9, Math.sin(d.a + t * 0.3) * rr); d.m.material.opacity = on ? 0.7 * (1 - q) : 0; }); } });
    }
    case 'camera': {
      const yy = y ?? 2.4; const head = new THREE.Group(); head.position.set(0, yy, 0.08); head.rotation.x = 0.45;
      head.add(at(box(0.1, 0.09, 0.2, mat('#f1f1ee', { rough: 0.4 }), 0.03), 0, -0.045, 0), at(cyl(0.03, 0.03, 0.02, mat('#0d0f14', { rough: 0.1 }), 16), 0, 0, 0.11));
      head.children[1].rotation.x = Math.PI / 2; head.children[1].position.set(0, 0, 0.1);
      const rec = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#ff3b3b', emissiveIntensity: 0 }); head.add(at(box(0.012, 0.012, 0.004, rec, 0), 0.035, 0.02, 0.1));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4, 4, 1, true), new THREE.MeshBasicMaterial({ color: '#79a6ff', transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
      cone.geometry.translate(0, -2, 0); cone.rotation.x = -Math.PI / 2; cone.rotation.y = Math.PI / 4; cone.position.z = 0.1; cone.userData.pool = true; head.add(cone);
      root.add(at(box(0.08, 0.12, 0.03, mat('#f1f1ee'), 0.01), 0, yy - 0.06, 0.015), head);
      return ret({ hit: [0.3, 0.3, 0.4, yy], camera: true, update(s, dt, t, env) { rec.emissiveIntensity = (s?.state === 'recording' || s?.state === 'streaming') && Math.sin(t * 4) > 0 ? 2 : 0.3; cone.visible = env.editing || env.showCones; } });
    }
  }
  root.add(at(box(0.2, 0.2, 0.2, mat('#888')), 0, 0, 0));
  return ret({ hit: [0.3, 0.3, 0.3, 0.15] });
}
