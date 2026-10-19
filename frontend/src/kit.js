import { t } from './i18n.js';
// Small modelling kit: cached materials, primitive helpers, procedural textures.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const matCache = new Map();
export function mat(color, { rough = 0.85, metal = 0, opacity = 1 } = {}) {
  const k = `${color}|${rough}|${metal}|${opacity}`;
  if (!matCache.has(k)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    if (opacity < 1) { m.transparent = true; m.opacity = opacity; }
    matCache.set(k, m);
  }
  return matCache.get(k);
}

// Box standing on y = 0, centred on x/z.
export function box(w, h, d, m, r = 0.02) {
  const rad = Math.max(0, Math.min(r, Math.min(w, h, d) / 2 - 0.001));
  const g = rad > 0.002 ? new RoundedBoxGeometry(w, h, d, 2, rad) : new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return new THREE.Mesh(g, m);
}
// Cylinder standing on y = 0.
export function cyl(rt, rb, h, m, seg = 24) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(0, h / 2, 0);
  return new THREE.Mesh(g, m);
}
export function sphere(r, m, ws = 24, hs = 16) { return new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m); }
export const at = (o, x = 0, y = 0, z = 0) => (o.position.set(x, y, z), o);
export const rotY = (o, a) => ((o.rotation.y = a), o);
export function group(...children) { const g = new THREE.Group(); children.flat().forEach((c) => c && g.add(c)); return g; }

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shade(hex, a) {
  const c = new THREE.Color(hex), h = {};
  c.getHSL(h); c.setHSL(h.h, h.s, Math.min(1, Math.max(0, h.l + a)));
  return `#${c.getHexString()}`;
}
export function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function planks(base, rows = 16) {
  return canvasTex(1024, (g, s) => {
    const rand = rng(base.charCodeAt(2) * 97 + rows); const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand() * s * 0.5;
      while (x < s) {
        const len = s * (0.35 + rand() * 0.35);
        g.fillStyle = shade(base, (rand() - 0.5) * 0.09); g.fillRect(x, r * rh, len, rh);
        g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, r * rh, 1.5, rh);
        x += len;
      }
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, r * rh, s, 1.5);
    }
  });
}
function tiles(base, n, grout) {
  return canvasTex(512, (g, s) => {
    const rand = rng(n * 31 + base.charCodeAt(2)); const t = s / n;
    g.fillStyle = grout; g.fillRect(0, 0, s, s);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = shade(base, (rand() - 0.5) * 0.05); g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4); }
  });
}
function noise(base, amount, dots = 9000, size = 512) {
  return canvasTex(size, (g, s) => {
    const rand = rng(base.charCodeAt(1) * 13 + dots);
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let i = 0; i < dots; i++) { g.fillStyle = shade(base, (rand() - 0.5) * amount); const r = 1 + rand() * 2.5; g.fillRect(rand() * s, rand() * s, r, r); }
  });
}
function grass() {
  return canvasTex(512, (g, s) => {
    const rand = rng(7); g.fillStyle = '#4f6b3a'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 14000; i++) { g.strokeStyle = shade('#55743d', (rand() - 0.5) * 0.16); g.beginPath(); const x = rand() * s, y = rand() * s; g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 3, y - 3 - rand() * 4); g.stroke(); }
  });
}
function water() {
  return canvasTex(256, (g, s) => {
    const gr = g.createLinearGradient(0, 0, s, s); gr.addColorStop(0, '#3fa7c9'); gr.addColorStop(1, '#2b86ad'); g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,.18)'; const rand = rng(3);
    for (let i = 0; i < 40; i++) { g.beginPath(); const y = rand() * s; g.moveTo(0, y); g.bezierCurveTo(s / 3, y - 6, (2 * s) / 3, y + 6, s, y); g.stroke(); }
  });
}

export const SURFACES = {
  oak: { get label() { return t('panel.surface.oak'); }, make: () => planks('#c4a17a'), rough: 0.75 },
  walnut: { get label() { return t('panel.surface.walnut'); }, make: () => planks('#8f6c56'), rough: 0.75 },
  ash: { get label() { return t('panel.surface.ash'); }, make: () => planks('#ddc9a8'), rough: 0.75 },
  tile: { get label() { return t('panel.surface.tile'); }, make: () => tiles('#d3d8dd', 4, '#a9afb7'), rough: 0.55 },
  tileDark: { get label() { return t('panel.surface.tileDark'); }, make: () => tiles('#5b6068', 4, '#3f444b'), rough: 0.5 },
  stone: { get label() { return t('panel.surface.stone'); }, make: () => tiles('#9ea3aa', 3, '#7a8089'), rough: 0.55 },
  concrete: { get label() { return t('panel.surface.concrete'); }, make: () => noise('#9a9c9e', 0.08), rough: 0.9 },
  carpet: { get label() { return t('panel.surface.carpet'); }, make: () => noise('#7b7f8c', 0.07, 20000), rough: 1 },
  lawn: { get label() { return t('panel.surface.lawn'); }, make: grass, rough: 1, outdoor: true },
  terrace: { get label() { return t('panel.surface.terrace'); }, make: () => planks('#9b7a5a', 10), rough: 0.8, outdoor: true },
  paving: { get label() { return t('panel.surface.paving'); }, make: () => tiles('#a59c90', 6, '#7f776c'), rough: 0.85, outdoor: true },
  gravel: { get label() { return t('panel.surface.gravel'); }, make: () => noise('#b9b2a5', 0.22, 26000), rough: 1, outdoor: true },
  driveway: { get label() { return t('panel.surface.driveway'); }, make: () => noise('#4a4d52', 0.1, 20000), rough: 0.95, outdoor: true },
  pool: { get label() { return t('panel.surface.pool'); }, make: water, rough: 0.05, outdoor: true },
};
const surfaceMats = new Map();
export function surfaceMat(kind) {
  const k = SURFACES[kind] ? kind : 'oak';
  if (!surfaceMats.has(k)) surfaceMats.set(k, new THREE.MeshStandardMaterial({ map: SURFACES[k].make(), roughness: SURFACES[k].rough, metalness: k === 'pool' ? 0.1 : 0 }));
  return surfaceMats.get(k);
}

export const poolTex = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
export const slatTex = canvasTex(64, (g, s) => { g.fillStyle = '#a3abb8'; g.fillRect(0, 0, s, s); g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 0; y < s; y += 8) g.fillRect(0, y, s, 1.5); });
export const neutralSlatTex = canvasTex(64, (g, s) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s); g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 0; y < s; y += 8) g.fillRect(0, y, s, 1.5); });
export const garageTex = canvasTex(128, (g, s) => { g.fillStyle = '#d9dcdf'; g.fillRect(0, 0, s, s); g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < s; y += 32) g.fillRect(0, y, s, 3); g.fillStyle = 'rgba(0,0,0,.06)'; for (let x = 0; x < s; x += 8) g.fillRect(x, 0, 1, s); });

// A soft additive light pool lying on the floor.
export function lightPool(size) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 2; m.userData.pool = true; m.userData.roomEffect = true;
  return m;
}
export function pulseRing(color = '#79a6ff') {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.userData.pool = true; m.userData.roomEffect = true;
  return m;
}
// Invisible mesh that still casts shadows (ceilings, cut-away walls).
export const blockerMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
