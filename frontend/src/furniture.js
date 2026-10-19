// Procedural furniture library. Every builder returns a Group standing on y = 0,
// centred on its footprint, front facing +z. Parameters are plain numbers/colours,
// so a sofa can be any width and every item can be described by an AI as JSON.
import * as THREE from 'three';
import { box, cyl, sphere, at, group, mat, shade, rng } from './kit.js';
import { buildRecipe, mergeByMaterial } from '../../engine/recipe.js';
import { BUNDLED_LIBRARY } from './library.gen.js';
import { t, localize } from './i18n.js';

const C = { WOOD: '#b48d63', DARK: '#5a4636', BLACK: '#24272e', WHITE: '#eceae5', METAL: '#a8adb5', CERAMIC: '#f3f3f1' };
const legs = (w, d, h, m, inset = 0.06, r = 0.022) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => at(cyl(r, r, h, m, 10), sx * (w / 2 - inset), 0, sz * (d / 2 - inset)));
const lines = (w, h, y, z, n, m) => { const out = []; for (let i = 1; i < n; i++) out.push(at(box(0.008, h, 0.006, m, 0), -w / 2 + (w / n) * i, y, z)); return out; };

function seating(w, d, color, n, { back = 0.52, arms = true } = {}) {
  const base = mat(color, { rough: 1 }), dark = mat(shade(color, -0.12), { rough: 1 });
  const g = group(at(box(w, 0.2, d, dark, 0.04), 0, 0.08, 0), at(box(w, back, 0.22, base, 0.07), 0, 0.2, -d / 2 + 0.11), ...legs(w, d, 0.08, mat(C.BLACK), 0.1, 0.02));
  if (arms) g.add(at(box(0.18, 0.42, d, base, 0.07), -w / 2 + 0.09, 0.12, 0), at(box(0.18, 0.42, d, base, 0.07), w / 2 - 0.09, 0.12, 0));
  const inner = arms ? w - 0.36 : w; const cw = inner / n;
  for (let i = 0; i < n; i++) g.add(at(box(cw - 0.02, 0.14, d - 0.26, base, 0.06), -inner / 2 + cw * (i + 0.5), 0.28, 0.08));
  return g;
}
function foliage(g, r, height, spread, colors, count = 9, y0 = 0.35) {
  for (let i = 0; i < count; i++) {
    const s = spread * (0.5 + r() * 0.5);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat(colors[i % colors.length], { rough: 0.9 }));
    m.position.set((r() - 0.5) * spread * 1.6, y0 + r() * (height - y0 - s * 0.5), (r() - 0.5) * spread * 1.6); m.rotation.set(r() * 3, r() * 3, 0); g.add(m);
  }
  return g;
}

export const FURNITURE = {
  /* Wohnen */
  sofa: { get label() { return t('data.furniture.sofa'); }, get cat() { return t('data.category.living'); }, w: 2.2, d: 0.95, color: '#7d8597', build: (p) => seating(p.w, p.d, p.color, p.w > 2 ? 3 : 2) },
  cornerSofa: { get label() { return t('data.furniture.cornerSofa'); }, get cat() { return t('data.category.living'); }, w: 2.8, d: 2.0, color: '#6f7686', build: (p) => {
    const g = seating(p.w, 0.95, p.color, 3); g.position.z = -p.d / 2 + 0.475;
    const wing = seating(p.d - 0.95 + 0.18, 0.95, p.color, 1); wing.rotation.y = -Math.PI / 2; wing.position.set(p.w / 2 - 0.475, 0, (0.95 - 0.18) / 2);
    return group(g, wing);
  } },
  armchair: { get label() { return t('data.furniture.armchair'); }, get cat() { return t('data.category.living'); }, w: 0.9, d: 0.88, color: '#c28a5a', build: (p) => seating(p.w, p.d, p.color, 1) },
  loungeChair: { get label() { return t('data.furniture.loungeChair'); }, get cat() { return t('data.category.living'); }, w: 0.85, d: 0.9, color: '#3f4656', build: (p) => {
    const g = group(at(box(p.w, 0.12, p.d * 0.75, mat(p.color, { rough: 1 }), 0.05), 0, 0.3, 0.05), ...legs(p.w * 0.8, p.d * 0.6, 0.3, mat(C.DARK), 0.05, 0.018));
    const back = at(box(p.w, 0.6, 0.12, mat(p.color, { rough: 1 }), 0.05), 0, 0.36, -p.d / 2 + 0.12); back.rotation.x = -0.25; g.add(back); return g;
  } },
  coffeeTable: { get label() { return t('data.furniture.coffeeTable'); }, get cat() { return t('data.category.living'); }, w: 1.1, d: 0.58, build: (p) => group(at(box(p.w, 0.04, p.d, mat(C.WOOD, { rough: 0.6 }), 0.015), 0, 0.36, 0), ...legs(p.w, p.d, 0.36, mat(C.BLACK), 0.07, 0.015)) },
  book: { get label() { return t('data.furniture.book'); }, get cat() { return t('data.category.living'); }, w: 0.24, d: 0.17, h: 0.035, lift: 0, color: '#c9553f', build: (p) => group(at(box(p.w, p.h, p.d, mat(p.color, { rough: 0.9 }), 0.006), 0, p.lift, 0)) },
  cup: { get label() { return t('data.furniture.cup'); }, get cat() { return t('data.category.living'); }, w: 0.1, d: 0.1, h: 0.09, lift: 0, build: (p) => group(at(cyl(p.w / 2, p.w * 0.4, p.h, mat(C.WHITE, { rough: 0.4 }), 16), 0, p.lift, 0)) },
  sideTable: { get label() { return t('data.furniture.sideTable'); }, get cat() { return t('data.category.living'); }, w: 0.45, d: 0.45, build: (p) => group(at(cyl(p.w / 2, p.w / 2, 0.03, mat(C.WOOD, { rough: 0.5 }), 32), 0, 0.5, 0), at(cyl(0.02, 0.02, 0.5, mat(C.BLACK), 10)), at(cyl(0.16, 0.16, 0.02, mat(C.BLACK), 24))) },
  rug: { get label() { return t('data.furniture.rug'); }, get cat() { return t('data.category.living'); }, w: 2.0, d: 1.4, color: '#3b4a66', flat: true, build: (p) => group(at(box(p.w, 0.014, p.d, mat(p.color, { rough: 1 }), 0.005)), at(box(p.w - 0.24, 0.016, p.d - 0.24, mat(shade(p.color, 0.06), { rough: 1 }), 0.005))) },
  roundRug: { get label() { return t('data.furniture.roundRug'); }, get cat() { return t('data.category.living'); }, w: 1.6, d: 1.6, color: '#8a6a4f', flat: true, build: (p) => group(at(cyl(p.w / 2, p.w / 2, 0.014, mat(p.color, { rough: 1 }), 48)), at(cyl(p.w / 2 - 0.15, p.w / 2 - 0.15, 0.016, mat(shade(p.color, 0.07), { rough: 1 }), 48))) },
  sideboard: { get label() { return t('data.furniture.sideboard'); }, get cat() { return t('data.category.living'); }, w: 1.6, d: 0.42, h: 0.6, build: (p) => group(...legs(p.w, p.d, 0.16, mat(C.BLACK), 0.07, 0.015), at(box(p.w, p.h - 0.16, p.d, mat(C.WOOD, { rough: 0.6 }), 0.015), 0, 0.16, 0), ...lines(p.w, p.h - 0.22, 0.19, p.d / 2, Math.max(2, Math.round(p.w / 0.5)), mat(C.DARK))) },
  tvBoard: { get label() { return t('data.furniture.tvBoard'); }, get cat() { return t('data.category.living'); }, w: 1.8, d: 0.4, build: (p) => group(at(box(p.w, 0.42, p.d, mat('#2f333c', { rough: 0.5 }), 0.012), 0, 0.12, 0), ...legs(p.w, p.d, 0.12, mat(C.BLACK), 0.08, 0.015), ...lines(p.w, 0.36, 0.15, p.d / 2, 3, mat('#1d2027'))) },
  bookshelf: { get label() { return t('data.furniture.bookshelf'); }, get cat() { return t('data.category.living'); }, w: 1.0, d: 0.32, h: 1.9, build: (p) => group(at(box(p.w, p.h, p.d, mat(C.WOOD, { rough: 0.6 }), 0.01))) },
  standingBook: { get label() { return t('data.furniture.standingBook'); }, get cat() { return t('data.category.living'); }, w: 0.05, d: 0.22, h: 0.28, lift: 0, color: '#7a3b2e', build: (p) => group(at(box(p.w, p.h, p.d, mat(p.color, { rough: 0.9 }), 0.004), 0, p.lift, 0)) },
  fireplace: { get label() { return t('data.furniture.fireplace'); }, get cat() { return t('data.category.living'); }, w: 1.2, d: 0.45, h: 1.1, fire: true, build: (p) => {
    const fire = new THREE.MeshStandardMaterial({ color: '#2a1408', emissive: '#ff7a2a', emissiveIntensity: 1.6 });
    const g = group(at(box(p.w, p.h, p.d, mat('#d8d4cc', { rough: 0.9 }), 0.01)), at(box(p.w * 0.55, p.h * 0.45, 0.04, mat('#151515'), 0.01), 0, 0.2, p.d / 2 - 0.01), at(box(p.w * 0.45, 0.12, 0.02, fire, 0.01), 0, 0.24, p.d / 2 + 0.01));
    g.userData.fire = fire; return g;
  } },
  piano: { get label() { return t('data.furniture.piano'); }, get cat() { return t('data.category.living'); }, w: 1.5, d: 0.6, build: (p) => group(at(box(p.w, 1.25, p.d * 0.6, mat('#121316', { rough: 0.25 }), 0.02), 0, 0, -p.d * 0.2), at(box(p.w, 0.06, p.d * 0.4, mat('#121316', { rough: 0.25 }), 0.01), 0, 0.72, p.d * 0.18), at(box(p.w - 0.1, 0.02, 0.15, mat(C.WHITE, { rough: 0.3 }), 0.004), 0, 0.78, p.d * 0.2)) },
  plant: { get label() { return t('data.furniture.plant'); }, get cat() { return t('data.category.living'); }, w: 0.45, d: 0.45, h: 1.2, build: (p) => foliage(group(at(cyl(0.16, 0.12, 0.3, mat('#d8d2c6', { rough: 0.7 })))), rng(Math.round(p.h * 1000)), p.h, 0.2, ['#3f6b45', '#4f7d52', '#2f5638']) },
  bigPlant: { get label() { return t('data.furniture.bigPlant'); }, get cat() { return t('data.category.living'); }, w: 0.7, d: 0.7, h: 2.0, build: (p) => { const g = group(at(cyl(0.22, 0.17, 0.42, mat('#3a3d44', { rough: 0.7 }))), at(cyl(0.025, 0.03, p.h * 0.6, mat(C.DARK), 8), 0, 0.4, 0)); return foliage(g, rng(Math.round(p.h * 777)), p.h, 0.28, ['#2f5d3a', '#3c7046', '#285031'], 12, p.h * 0.45); } },

  /* Essen & Küche */
  diningTable: { get label() { return t('data.furniture.diningTable'); }, get cat() { return t('data.category.diningKitchen'); }, w: 1.8, d: 0.9, build: (p) => group(at(box(p.w, 0.05, p.d, mat('#b48d63', { rough: 0.55 }), 0.02), 0, 0.71, 0), ...legs(p.w, p.d, 0.71, mat(C.BLACK), 0.1, 0.026)) },
  roundTable: { get label() { return t('data.furniture.roundTable'); }, get cat() { return t('data.category.diningKitchen'); }, w: 1.1, d: 1.1, build: (p) => group(at(cyl(p.w / 2, p.w / 2, 0.04, mat('#e9e6df', { rough: 0.5 }), 40), 0, 0.72, 0), at(cyl(0.05, 0.05, 0.72, mat(C.BLACK), 12)), at(cyl(0.3, 0.3, 0.03, mat(C.BLACK), 24))) },
  chair: { get label() { return t('data.furniture.chair'); }, get cat() { return t('data.category.diningKitchen'); }, w: 0.44, d: 0.44, color: '#2b2e37', build: (p) => group(at(box(0.44, 0.05, 0.44, mat(p.color || '#2b2e37', { rough: 0.8 }), 0.02), 0, 0.44, 0), at(box(0.44, 0.42, 0.04, mat(p.color || '#2b2e37', { rough: 0.8 }), 0.02), 0, 0.49, -0.2), ...legs(0.44, 0.44, 0.44, mat(C.BLACK), 0.04, 0.014)) },
  barStool: { get label() { return t('data.furniture.barStool'); }, get cat() { return t('data.category.diningKitchen'); }, w: 0.4, d: 0.4, color: '#c28a5a', build: (p) => group(at(cyl(0.17, 0.15, 0.06, mat(p.color, { rough: 0.9 })), 0, 0.68, 0), at(cyl(0.016, 0.016, 0.68, mat(C.METAL, { rough: 0.3, metal: 0.8 }), 10)), at(cyl(0.16, 0.16, 0.012, mat(C.BLACK, { rough: 0.4 })))) },
  bench: { get label() { return t('data.furniture.bench'); }, get cat() { return t('data.category.diningKitchen'); }, w: 1.4, d: 0.38, build: (p) => group(at(box(p.w, 0.05, p.d, mat(C.WOOD, { rough: 0.6 }), 0.015), 0, 0.42, 0), ...legs(p.w, p.d, 0.42, mat(C.BLACK), 0.06, 0.018)) },
  kitchen: { get label() { return t('data.furniture.kitchen'); }, get cat() { return t('data.category.diningKitchen'); }, w: 3.0, d: 0.62, color: '#e4e1da', build: (p) => {
    const front = mat(p.color, { rough: 0.6 }); const n = Math.max(2, Math.round(p.w / 0.6));
    return group(at(box(p.w, 0.86, 0.6, front, 0.008)), ...lines(p.w, 0.78, 0.06, 0.3, n, mat(shade(p.color, -0.18))), at(box(p.w + 0.02, 0.04, 0.63, mat('#33363d', { rough: 0.35 }), 0.008), 0, 0.86, 0.005));
  } },
  kitchenTall: { get label() { return t('data.furniture.kitchenTall'); }, get cat() { return t('data.category.diningKitchen'); }, w: 0.6, d: 0.62, color: '#e4e1da', build: (p) => group(at(box(p.w, 2.15, 0.6, mat(p.color, { rough: 0.6 }), 0.008))) },
  island: { get label() { return t('data.furniture.island'); }, get cat() { return t('data.category.diningKitchen'); }, w: 2.0, d: 1.0, build: (p) => group(at(box(p.w - 0.12, 0.88, p.d - 0.3, mat('#39424f', { rough: 0.7 }), 0.015), 0, 0, -0.1), at(box(p.w, 0.05, p.d, mat('#e9e7e2', { rough: 0.3 }), 0.015), 0, 0.88, 0)) },
  hob: { get label() { return t('data.furniture.hob'); }, get cat() { return t('data.category.diningKitchen'); }, w: 0.58, d: 0.5, h: 0.012, lift: 0, build: (p) => group(at(box(p.w, p.h, p.d, mat('#0c0d10', { rough: 0.15 }), 0), 0, p.lift, 0)) },
  sink: { get label() { return t('data.furniture.sink'); }, get cat() { return t('data.category.diningKitchen'); }, w: 0.5, d: 0.38, h: 0.012, lift: 0, build: (p) => group(at(box(p.w, p.h, p.d, mat(C.METAL, { rough: 0.3, metal: 0.9 }), 0), 0, p.lift, 0)) },
  tap: { get label() { return t('data.furniture.tap'); }, get cat() { return t('data.category.diningKitchen'); }, w: 0.03, d: 0.03, h: 0.24, lift: 0, build: (p) => group(at(cyl(p.w / 2, p.w / 2, p.h, mat(C.METAL, { rough: 0.25, metal: 0.9 }), 10), 0, p.lift, 0)) },
  upperCabinet: { get label() { return t('data.furniture.upperCabinet'); }, get cat() { return t('data.category.diningKitchen'); }, w: 0.6, d: 0.35, h: 0.7, lift: 0, color: '#e4e1da', build: (p) => group(at(box(p.w, p.h, p.d, mat(p.color, { rough: 0.6 }), 0.008), 0, p.lift, 0), ...lines(p.w, p.h - 0.06, p.lift + 0.03, p.d / 2, Math.max(1, Math.round(p.w / 0.6)), mat(shade(p.color, -0.18)))) },
  hood: { get label() { return t('data.furniture.hood'); }, get cat() { return t('data.category.diningKitchen'); }, w: 0.7, d: 0.42, h: 0.08, lift: 0, build: (p) => group(at(box(p.w, p.h, p.d, mat('#2f3239', { rough: 0.4, metal: 0.4 }), 0.008), 0, p.lift, 0)) },
  oven: { get label() { return t('data.furniture.oven'); }, get cat() { return t('data.category.diningKitchen'); }, w: 0.54, d: 0.03, h: 0.55, lift: 0, build: (p) => group(at(box(p.w, p.h, 0.01, mat('#0f1013', { rough: 0.2 }), 0.004), 0, p.lift, 0), at(box(Math.max(0.08, p.w - 0.06), 0.02, p.d, mat(C.METAL, { metal: 0.8, rough: 0.3 }), 0.005), 0, p.lift + 0.5, 0.01)) },
  fridge: { get label() { return t('data.furniture.fridge'); }, get cat() { return t('data.category.diningKitchen'); }, w: 0.7, d: 0.68, build: (p) => group(at(box(p.w, 1.92, p.d, mat('#c5c9d0', { rough: 0.35, metal: 0.5 }), 0.025)), at(box(p.w - 0.04, 0.008, 0.005, mat('#7c8088'), 0), 0, 1.25, p.d / 2), at(box(0.02, 0.5, 0.03, mat('#70747c', { metal: 0.7, rough: 0.3 }), 0.008), -p.w / 2 + 0.08, 1.34, p.d / 2 + 0.01)) },

  /* Schlafen */
  bed: { get label() { return t('data.furniture.bed'); }, get cat() { return t('data.category.bedroom'); }, w: 1.8, d: 2.1, color: '#7f8fb5', build: (p) => {
    const linen = mat('#f1efea', { rough: 1 }), w = p.w, d = p.d;
    return group(at(box(w + 0.1, 0.26, d + 0.04, mat(C.DARK, { rough: 0.7 }), 0.03), 0, 0.04, 0), at(box(w + 0.16, 1.0, 0.1, mat(shade(p.color, -0.15), { rough: 1 }), 0.04), 0, 0, -d / 2),
      at(box(w, 0.2, d - 0.06, linen, 0.07), 0, 0.28, 0.02), at(box(w + 0.04, 0.08, d * 0.62, mat(p.color, { rough: 1 }), 0.04), 0, 0.45, d * 0.18),
      at(box(w * 0.42, 0.13, 0.36, linen, 0.06), -w * 0.24, 0.46, -d / 2 + 0.3), at(box(w * 0.42, 0.13, 0.36, linen, 0.06), w * 0.24, 0.46, -d / 2 + 0.3));
  } },
  singleBed: { get label() { return t('data.furniture.singleBed'); }, get cat() { return t('data.category.bedroom'); }, w: 0.95, d: 2.05, color: '#86a37f', build: (p) => {
    const linen = mat('#f1efea', { rough: 1 });
    return group(at(box(p.w + 0.06, 0.3, p.d, mat(C.WOOD, { rough: 0.7 }), 0.03)), at(box(p.w + 0.06, 0.75, 0.06, mat(C.WOOD, { rough: 0.7 }), 0.02), 0, 0, -p.d / 2), at(box(p.w - 0.04, 0.18, p.d - 0.08, linen, 0.06), 0, 0.3, 0), at(box(p.w, 0.07, p.d * 0.6, mat(p.color, { rough: 1 }), 0.03), 0, 0.45, p.d * 0.18), at(box(p.w * 0.7, 0.12, 0.34, linen, 0.05), 0, 0.46, -p.d / 2 + 0.28));
  } },
  crib: { get label() { return t('data.furniture.crib'); }, get cat() { return t('data.category.bedroom'); }, w: 0.66, d: 1.26, build: (p) => { const g = group(at(box(p.w, 0.12, p.d, mat(C.WHITE), 0.02), 0, 0.3, 0)); for (let i = 0; i < 9; i++) { const x = -p.w / 2 + 0.03 + i * (p.w - 0.06) / 8; g.add(at(box(0.02, 0.6, 0.02, mat(C.WHITE), 0.005), x, 0.3, p.d / 2 - 0.02), at(box(0.02, 0.6, 0.02, mat(C.WHITE), 0.005), x, 0.3, -p.d / 2 + 0.02)); } g.add(...legs(p.w, p.d, 0.3, mat(C.WHITE), 0.03, 0.02)); return g; } },
  nightstand: { get label() { return t('data.furniture.nightstand'); }, get cat() { return t('data.category.bedroom'); }, w: 0.46, d: 0.4, build: (p) => group(at(box(p.w, 0.48, p.d, mat(C.DARK, { rough: 0.6 }), 0.015)), at(box(p.w - 0.06, 0.006, 0.005, mat('#3b2e24'), 0), 0, 0.3, p.d / 2)) },
  wardrobe: { get label() { return t('data.furniture.wardrobe'); }, get cat() { return t('data.category.bedroom'); }, w: 1.6, d: 0.6, h: 2.1, color: '#dcd8d0', build: (p) => group(at(box(p.w, p.h, p.d, mat(p.color, { rough: 0.7 }), 0.01)), ...lines(p.w, p.h - 0.1, 0.05, p.d / 2, Math.max(2, Math.round(p.w / 0.55)), mat(shade(p.color, -0.2)))) },
  dresser: { get label() { return t('data.furniture.dresser'); }, get cat() { return t('data.category.bedroom'); }, w: 1.2, d: 0.45, build: (p) => { const g = group(at(box(p.w, 0.85, p.d, mat(C.WHITE, { rough: 0.6 }), 0.012), 0, 0.08, 0), ...legs(p.w, p.d, 0.08, mat(C.DARK), 0.05, 0.015)); for (let i = 1; i < 4; i++) g.add(at(box(p.w - 0.04, 0.006, 0.005, mat('#b9b6ae'), 0), 0, 0.08 + i * 0.212, p.d / 2)); return g; } },

  /* Bad */
  bathtub: { get label() { return t('data.furniture.bathtub'); }, get cat() { return t('data.category.bathroom'); }, w: 1.7, d: 0.78, build: (p) => group(at(box(p.w, 0.56, p.d, mat(C.CERAMIC, { rough: 0.25 }), 0.08)), at(box(p.w - 0.2, 0.05, p.d - 0.2, mat('#9fc1dc', { rough: 0.1 }), 0.05), 0, 0.5, 0)) },
  shower: { get label() { return t('data.furniture.shower'); }, get cat() { return t('data.category.bathroom'); }, w: 0.9, d: 0.9, build: (p) => group(at(box(p.w, 0.05, p.d, mat(C.CERAMIC, { rough: 0.3 }), 0.01)), at(box(0.01, 2.0, p.d, new THREE.MeshStandardMaterial({ color: '#cfe3f0', transparent: true, opacity: 0.25, roughness: 0.05 }), 0), p.w / 2, 0.05, 0), at(box(p.w, 2.0, 0.01, new THREE.MeshStandardMaterial({ color: '#cfe3f0', transparent: true, opacity: 0.25, roughness: 0.05 }), 0), 0, 0.05, p.d / 2), at(cyl(0.12, 0.12, 0.01, mat(C.METAL, { metal: 0.9, rough: 0.2 }), 24), 0, 2.0, -p.d / 2 + 0.25), at(cyl(0.01, 0.01, 0.3, mat(C.METAL, { metal: 0.9 }), 8), 0, 2.0, -p.d / 2 + 0.05)) },
  toilet: { get label() { return t('data.furniture.toilet'); }, get cat() { return t('data.category.bathroom'); }, w: 0.4, d: 0.62, build: () => group(at(box(0.38, 0.4, 0.5, mat(C.CERAMIC, { rough: 0.25 }), 0.12), 0, 0, 0.06), at(box(0.42, 0.5, 0.16, mat(C.CERAMIC, { rough: 0.25 }), 0.03), 0, 0.3, -0.24)) },
  vanity: { get label() { return t('data.furniture.vanity'); }, get cat() { return t('data.category.bathroom'); }, w: 0.9, d: 0.5, build: (p) => group(at(box(p.w, 0.55, p.d - 0.02, mat(C.DARK, { rough: 0.6 }), 0.012), 0, 0.3, 0), at(box(p.w, 0.04, p.d, mat(C.CERAMIC, { rough: 0.25 }), 0.012), 0, 0.85, 0), at(cyl(0.012, 0.012, 0.18, mat(C.METAL, { metal: 0.9, rough: 0.2 }), 8), 0, 0.89, -p.d / 2 + 0.1)) },
  vanityMirror: { get label() { return t('data.furniture.vanityMirror'); }, get cat() { return t('data.category.bathroom'); }, w: 0.76, d: 0.02, h: 0.7, lift: 0, build: (p) => group(at(box(p.w, p.h, p.d, new THREE.MeshStandardMaterial({ color: '#c7d6e6', roughness: 0.05, metalness: 0.9 }), 0.01), 0, p.lift, 0)) },
  washer: { get label() { return t('data.furniture.washer'); }, get cat() { return t('data.category.bathroom'); }, w: 0.6, d: 0.6, build: (p) => { const door = cyl(0.2, 0.2, 0.03, mat('#5f6b78', { rough: 0.1, metal: 0.3 }), 32); door.rotation.x = Math.PI / 2; door.position.set(0, 0.42, p.d / 2); return group(at(box(p.w, 0.85, p.d, mat(C.WHITE, { rough: 0.4 }), 0.02)), door); } },
  towelRack: { get label() { return t('data.furniture.towelRack'); }, get cat() { return t('data.category.bathroom'); }, w: 0.6, d: 0.3, build: (p) => group(at(box(p.w, 1.6, p.d, mat(C.WOOD, { rough: 0.6 }), 0.01))) },
  towel: { get label() { return t('data.furniture.towel'); }, get cat() { return t('data.category.bathroom'); }, w: 0.5, d: 0.24, h: 0.2, lift: 0, color: '#e8dccb', build: (p) => group(at(box(p.w, p.h, p.d, mat(p.color, { rough: 1 }), 0.04), 0, p.lift, 0)) },

  /* Büro */
  desk: { get label() { return t('data.furniture.desk'); }, get cat() { return t('data.category.office'); }, w: 1.4, d: 0.7, build: (p) => group(at(box(p.w, 0.04, p.d, mat('#e9e6df', { rough: 0.5 }), 0.012), 0, 0.72, 0), ...legs(p.w, p.d, 0.72, mat(C.BLACK), 0.05, 0.02)) },
  officeChair: { get label() { return t('data.furniture.officeChair'); }, get cat() { return t('data.category.office'); }, w: 0.6, d: 0.6, color: '#2d3240', build: (p) => {
    const g = group(at(box(0.48, 0.07, 0.46, mat(p.color, { rough: 0.9 }), 0.03), 0, 0.46, 0), at(box(0.46, 0.55, 0.06, mat(p.color, { rough: 0.9 }), 0.03), 0, 0.55, -0.22), at(cyl(0.025, 0.025, 0.4, mat(C.METAL, { metal: 0.7, rough: 0.3 }), 10), 0, 0.06, 0));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const leg = at(box(0.3, 0.03, 0.04, mat(C.BLACK), 0.01), Math.cos(a) * 0.14, 0.04, Math.sin(a) * 0.14); leg.rotation.y = -a; g.add(leg); }
    return g;
  } },
  shelf: { get label() { return t('data.furniture.shelf'); }, get cat() { return t('data.category.office'); }, w: 1.2, d: 0.35, h: 1.8, build: (p) => { const g = group(); for (const sx of [-1, 1]) g.add(at(box(0.03, p.h, p.d, mat(C.BLACK), 0.005), sx * (p.w / 2 - 0.015), 0, 0)); for (let i = 0; i < 5; i++) g.add(at(box(p.w, 0.025, p.d, mat(C.WOOD, { rough: 0.6 }), 0.005), 0, 0.1 + i * (p.h - 0.15) / 4, 0)); return g; } },

  /* Flur & Treppe */
  stairs: { get label() { return t('data.furniture.stairs'); }, get cat() { return t('data.category.hallStairs'); }, w: 1.0, d: 3.2, h: 2.8, build: (p) => {
    if (p.shape === 'quarter' || p.shape === 'half') return turnedStairs(p);
    const n = Math.max(6, Math.round(p.h / 0.18)), run = p.d / n, rise = p.h / n, g = group(), m = mat(C.WOOD, { rough: 0.6 }), sm = mat('#3a3f4b', { rough: 0.7 });
    for (let i = 0; i < n; i++) g.add(at(box(p.w, 0.04, run + 0.02, m, 0.006), 0, (i + 1) * rise - 0.04, p.d / 2 - (i + 0.5) * run));
    for (const sx of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.25, Math.hypot(p.d, p.h)), sm); st.position.set(sx * (p.w / 2 + 0.025), p.h / 2, 0); st.rotation.x = Math.atan2(p.h, p.d); g.add(st); }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, Math.hypot(p.d, p.h), 8), mat(C.METAL, { metal: 0.8, rough: 0.3 })); rail.rotation.x = Math.PI / 2 - Math.atan2(p.h, p.d); rail.position.set(p.w / 2 + 0.03, p.h / 2 + 0.9, 0); g.add(rail);
    return g;
  } },
  shoeCabinet: { get label() { return t('data.furniture.shoeCabinet'); }, get cat() { return t('data.category.hallStairs'); }, w: 1.0, d: 0.3, build: (p) => group(at(box(p.w, 1.0, p.d, mat(C.WHITE, { rough: 0.6 }), 0.01), 0, 0.05, 0), ...lines(p.w, 0.9, 0.1, p.d / 2, 3, mat('#b9b6ae'))) },
  coatRack: { get label() { return t('data.furniture.coatRack'); }, get cat() { return t('data.category.hallStairs'); }, w: 0.9, d: 0.35, build: (p) => group(at(box(p.w, 0.45, p.d, mat(C.WOOD, { rough: 0.6 }), 0.01)), at(box(p.w, 0.04, 0.04, mat(C.BLACK), 0.005), 0, 1.75, -p.d / 2 + 0.03)) },
  coat: { get label() { return t('data.furniture.coat'); }, get cat() { return t('data.category.hallStairs'); }, w: 0.32, d: 0.12, h: 0.8, lift: 0, color: '#4b5563', build: (p) => group(at(box(p.w, p.h, p.d, mat(p.color, { rough: 1 }), 0.05), 0, p.lift, 0)) },
  mirror: { get label() { return t('data.furniture.mirror'); }, get cat() { return t('data.category.hallStairs'); }, w: 0.6, d: 0.05, build: (p) => group(at(box(p.w, 1.5, 0.03, new THREE.MeshStandardMaterial({ color: '#c7d6e6', roughness: 0.05, metalness: 0.9 }), 0.02), 0, 0.5, 0)) },

  /* Garage & Technik */
  car: { get label() { return t('data.furniture.car'); }, get cat() { return t('data.category.garageUtility'); }, w: 1.85, d: 4.5, color: '#355c8c', build: (p) => {
    const body = mat(p.color, { rough: 0.3, metal: 0.4 }), glass = mat('#1b2433', { rough: 0.1, metal: 0.5 }), tire = mat('#16171a', { rough: 0.8 });
    const g = group(at(box(p.w, 0.62, p.d, body, 0.18), 0, 0.22, 0), at(box(p.w - 0.16, 0.5, p.d * 0.5, glass, 0.16), 0, 0.78, -0.1), at(box(p.w - 0.2, 0.06, p.d * 0.46, body, 0.03), 0, 1.25, -0.1));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 24), tire); w.rotation.z = Math.PI / 2; w.position.set(sx * (p.w / 2 - 0.1), 0.33, sz * (p.d / 2 - 0.8)); g.add(w); }
    const head = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff4d6', emissiveIntensity: 0.4 });
    for (const sx of [-1, 1]) g.add(at(box(0.3, 0.08, 0.02, head, 0.01), sx * (p.w / 2 - 0.28), 0.6, p.d / 2 + 0.0));
    return g;
  } },
  bike: { get label() { return t('data.furniture.bike'); }, get cat() { return t('data.category.garageUtility'); }, w: 0.6, d: 1.75, build: () => { const g = group(); for (const z of [-0.55, 0.55]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 8, 32), mat('#1a1b1f')); w.rotation.y = Math.PI / 2; w.position.set(0, 0.36, z); g.add(w); } const fr = at(box(0.04, 0.04, 1.0, mat('#c84b3a', { metal: 0.5, rough: 0.3 }), 0.01), 0, 0.6, 0); g.add(fr, at(box(0.05, 0.4, 0.04, mat('#c84b3a'), 0.01), 0, 0.36, -0.1), at(box(0.12, 0.04, 0.24, mat('#1a1b1f'), 0.01), 0, 0.82, -0.2), at(box(0.5, 0.025, 0.025, mat('#1a1b1f'), 0.01), 0, 0.98, 0.5)); return g; } },
  workbench: { get label() { return t('data.furniture.workbench'); }, get cat() { return t('data.category.garageUtility'); }, w: 1.8, d: 0.7, build: (p) => group(at(box(p.w, 0.06, p.d, mat('#a07850', { rough: 0.8 }), 0.01), 0, 0.88, 0), ...legs(p.w, p.d, 0.88, mat('#3a3f4b'), 0.05, 0.03), at(box(p.w, 0.9, 0.03, mat('#596273', { rough: 0.8 }), 0), 0, 1.0, -p.d / 2 + 0.02), at(box(p.w - 0.1, 0.03, p.d - 0.1, mat('#3a3f4b'), 0.005), 0, 0.2, 0)) },
  rack: { get label() { return t('data.furniture.rack'); }, get cat() { return t('data.category.garageUtility'); }, w: 1.2, d: 0.5, h: 2.0, build: (p) => { const g = group(); for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(at(box(0.04, p.h, 0.04, mat('#3d6fa8', { metal: 0.4 }), 0.005), sx * (p.w / 2 - 0.02), 0, sz * (p.d / 2 - 0.02))); for (let i = 0; i < 4; i++) g.add(at(box(p.w, 0.025, p.d, mat('#b9a27f'), 0.004), 0, 0.1 + i * (p.h - 0.15) / 3, 0)); return g; } },
  storageBox: { get label() { return t('data.furniture.storageBox'); }, get cat() { return t('data.category.garageUtility'); }, w: 0.4, d: 0.35, h: 0.3, lift: 0, color: '#7a5b3e', build: (p) => group(at(box(p.w, p.h, p.d, mat(p.color, { rough: 0.8 }), 0.02), 0, p.lift, 0)) },
  heatPump: { get label() { return t('data.furniture.heatPump'); }, get cat() { return t('data.category.garageUtility'); }, w: 1.1, d: 0.45, build: (p) => { const g = group(at(box(p.w, 0.95, p.d, mat('#e4e6e8', { rough: 0.5 }), 0.03)), at(cyl(0.33, 0.33, 0.02, mat('#2a2d33'), 32), -p.w * 0.18, 0.47, p.d / 2)); g.children[1].rotation.x = Math.PI / 2; g.children[1].position.y = 0.5; return g; } },
  box: { get label() { return t('data.furniture.box'); }, get cat() { return t('data.category.garageUtility'); }, w: 0.8, d: 0.6, h: 0.8, color: '#a0a6b2', build: (p) => group(at(box(p.w, p.h, p.d, mat(p.color, { rough: 0.7 }), 0.02))) },

  /* Garten */
  tree: { get label() { return t('data.furniture.tree'); }, get cat() { return t('data.category.garden'); }, w: 3.0, d: 3.0, h: 5.5, outdoor: true, build: (p) => foliage(group(at(cyl(0.12, 0.18, p.h * 0.55, mat('#5b4636', { rough: 1 }), 10))), rng(Math.round(p.h * 31 + p.w * 7)), p.h, p.w * 0.3, ['#3e6b3a', '#4b7a40', '#335d33'], 14, p.h * 0.42) },
  conifer: { get label() { return t('data.furniture.conifer'); }, get cat() { return t('data.category.garden'); }, w: 1.8, d: 1.8, h: 6, outdoor: true, build: (p) => { const g = group(at(cyl(0.1, 0.14, 1.0, mat('#4f3c2e'), 8))); for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(p.w / 2 * (1 - i * 0.2), p.h * 0.32, 10), mat(['#24503a', '#2b5c42', '#2f6446', '#356b4b'][i], { rough: 0.95 })); c.position.y = 1.0 + i * p.h * 0.18 + p.h * 0.16; g.add(c); } return g; } },
  bush: { get label() { return t('data.furniture.bush'); }, get cat() { return t('data.category.garden'); }, w: 1.0, d: 1.0, h: 1.0, outdoor: true, build: (p) => foliage(group(), rng(Math.round(p.w * 100 + p.h * 10)), p.h, p.w * 0.35, ['#4c7a3e', '#5a8a46', '#3f6a35'], 8, 0.2) },
  hedge: { get label() { return t('data.furniture.hedge'); }, get cat() { return t('data.category.garden'); }, w: 3.0, d: 0.6, h: 1.6, outdoor: true, build: (p) => { const g = group(at(box(p.w, p.h, p.d, mat('#355f32', { rough: 1 }), 0.15))); const r = rng(Math.round(p.w * 37)); for (let i = 0; i < p.w * 3; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18 + r() * 0.1, 0), mat(r() < 0.5 ? '#3e6b3a' : '#2f5a30', { rough: 1 })); m.position.set(-p.w / 2 + r() * p.w, r() * p.h, (r() < 0.5 ? -1 : 1) * p.d / 2 * 0.9); g.add(m); } return g; } },
  fence: { get label() { return t('data.furniture.fence'); }, get cat() { return t('data.category.garden'); }, w: 3.0, d: 0.06, h: 1.2, outdoor: true, build: (p) => { const g = group(); const n = Math.max(2, Math.round(p.w / 0.12)); for (let i = 0; i < n; i++) g.add(at(box(0.08, p.h, 0.025, mat('#8f7a62', { rough: 0.9 }), 0.004), -p.w / 2 + 0.04 + i * (p.w - 0.08) / (n - 1), 0, 0)); for (const y of [0.25, p.h - 0.25]) g.add(at(box(p.w, 0.08, 0.03, mat('#6e5b47'), 0.004), 0, y, -0.025)); return g; } },
  gardenSet: { get label() { return t('data.furniture.gardenSet'); }, get cat() { return t('data.category.garden'); }, w: 1.6, d: 1.6, outdoor: true, build: () => group(at(box(1.2, 0.04, 0.8, mat('#8b6b4c', { rough: 0.8 }), 0.01), 0, 0.72, 0), ...legs(1.2, 0.8, 0.72, mat('#3a3f4b'), 0.06, 0.02)) },
  lounger: { get label() { return t('data.furniture.lounger'); }, get cat() { return t('data.category.garden'); }, w: 0.7, d: 1.95, outdoor: true, build: (p) => { const g = group(at(box(p.w, 0.08, p.d * 0.7, mat('#e8e2d6', { rough: 1 }), 0.03), 0, 0.3, p.d * 0.15), ...legs(p.w, p.d * 0.9, 0.3, mat('#4b5563'), 0.05, 0.02)); const back = at(box(p.w, 0.08, p.d * 0.32, mat('#e8e2d6', { rough: 1 }), 0.03), 0, 0.42, -p.d * 0.32); back.rotation.x = 0.6; g.add(back); return g; } },
  umbrella: { get label() { return t('data.furniture.umbrella'); }, get cat() { return t('data.category.garden'); }, w: 2.6, d: 2.6, outdoor: true, build: (p) => { const c = new THREE.Mesh(new THREE.ConeGeometry(p.w / 2, 0.5, 8, 1, true), new THREE.MeshStandardMaterial({ color: '#e9e3d5', roughness: 1, side: THREE.DoubleSide })); c.position.y = 2.25; return group(at(cyl(0.025, 0.025, 2.3, mat('#5b4636'), 8)), at(cyl(0.25, 0.25, 0.06, mat('#3a3f4b'), 20)), c); } },
  grill: { get label() { return t('data.furniture.grill'); }, get cat() { return t('data.category.garden'); }, w: 1.2, d: 0.6, outdoor: true, build: (p) => group(at(box(p.w * 0.6, 0.45, p.d, mat('#2a2d33', { rough: 0.5, metal: 0.4 }), 0.05), 0, 0.85, 0), at(box(p.w, 0.04, p.d, mat('#3a3f4b'), 0.01), 0, 0.82, 0), ...legs(p.w * 0.6, p.d, 0.82, mat('#3a3f4b'), 0.05, 0.02)) },
  raisedBed: { get label() { return t('data.furniture.raisedBed'); }, get cat() { return t('data.category.garden'); }, w: 2.0, d: 0.8, outdoor: true, build: (p) => foliage(group(at(box(p.w, 0.7, p.d, mat('#8a6a4c', { rough: 0.9 }), 0.01)), at(box(p.w - 0.08, 0.02, p.d - 0.08, mat('#4a3628', { rough: 1 }), 0.005), 0, 0.68, 0)), rng(Math.round(p.w * 53)), 1.0, 0.12, ['#5c8f45', '#77a650', '#4a7a3c'], 10, 0.72) },
  trampoline: { get label() { return t('data.furniture.trampoline'); }, get cat() { return t('data.category.garden'); }, w: 3.0, d: 3.0, outdoor: true, build: (p) => { const g = group(at(cyl(p.w / 2, p.w / 2, 0.06, mat('#2a6db0', { rough: 0.6 }), 40), 0, 0.75, 0), at(cyl(p.w / 2 - 0.25, p.w / 2 - 0.25, 0.065, mat('#1a1b1f'), 40), 0, 0.752, 0)); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(at(cyl(0.02, 0.02, 0.75, mat(C.METAL, { metal: 0.6 }), 8), Math.cos(a) * p.w / 2 * 0.95, 0, Math.sin(a) * p.w / 2 * 0.95)); } return g; } },
};

const FURNITURE_CAT_KEYS = ['library', 'living', 'diningKitchen', 'bedroom', 'bathroom', 'office', 'hallStairs', 'garageUtility', 'garden'];
export const FURNITURE_CATS = new Proxy(FURNITURE_CAT_KEYS, { get: (keys, prop) => /^\d+$/.test(String(prop)) ? t(`data.category.${keys[prop]}`) : Reflect.get(keys, prop) });
// Objects of the HomeTwin library (recipes): registered as furniture types 'lib:<id>', scaled to width/depth/height.
export const LIBRARY = new Map();
const PROTO = new Map();
export function registerLibrary(items, { source = 'bundled' } = {}) {
  let n = 0;
  for (const it of items || []) {
    if (!it?.id || !it.recipe) continue; const key = `lib:${it.id}`; if (FURNITURE[key] && source !== 'plan') continue;
    const d = it.dimensions || { w: 1, d: 1, h: 1 }; LIBRARY.set(it.id, it); n++;
    if (it.mount === 'opening') continue;
    const name = it.name?.de || it.name?.en || it.id.split('/').pop();
    FURNITURE[key] = { label: it.manufacturer ? `${name}` : name, cat: 'Bibliothek', w: d.w, d: d.d, h: d.h, lib: it.id, noShadow: Math.max(d.w, d.d, d.h) < 0.3, /* small things: no shadow pass */ screen: /"(shape|role)":\s*"screen"/.test(JSON.stringify(it.recipe)), build: (p) => {
      // built once per object (merged per material), instances share geometry and materials
      let proto = PROTO.get(it.id); if (!proto || proto.recipe !== it.recipe) { proto = { recipe: it.recipe, obj: buildRecipe(it.recipe).object }; PROTO.set(it.id, proto); }
      const object = proto.obj.clone(); const g = new THREE.Group(); g.add(object);
      object.scale.set((p.w || d.w) / d.w, (p.h || d.h) / d.h, (p.d || d.d) / d.d);
      if (it.mount === 'wall') object.position.y = 0;
      return g;
    } };
    Object.defineProperty(FURNITURE[key], 'cat', { configurable: true, get: () => t('data.category.library') });
  }
  return n;
}
registerLibrary(BUNDLED_LIBRARY);

// Parameters with defaults resolved from the type definition.
// Stairs that turn by 90° (quarter) or 180° (half) with a landing; rises towards local -z, starts at +z.
export function stairInfo(p) {
  const n = Math.max(6, Math.round(p.h / 0.18)), rise = p.h / n, fw = Math.min(p.fw || (p.shape === 'half' ? p.w / 2 - 0.05 : 1.0), p.shape === 'half' ? p.w / 2 - 0.02 : Math.min(p.w, p.d) - 0.3);
  let runLen; if (p.shape === 'quarter') runLen = (p.d - fw) + (p.w - fw); else if (p.shape === 'half') runLen = 2 * (p.d - fw); else runLen = p.d;
  const tread = runLen / (p.shape === 'quarter' || p.shape === 'half' ? n - 1 : n);
  return { n, rise, tread, fw, rule: 2 * rise + tread };
}
function turnedStairs(p) {
  const g = group(), m = mat(C.WOOD, { rough: 0.6 }), lm = mat('#3a3f4b', { rough: 0.7 }); const { n, rise, fw } = stairInfo(p);
  const sgn = p.turn === 'left' ? -1 : 1, hw = p.w / 2, hd = p.d / 2;
  const step = (x0, x1, z0, z1, i) => { const y = (i + 1) * rise; const b = box(Math.abs(x1 - x0), 0.04, Math.abs(z1 - z0) + 0.02, m, 0.006); g.add(at(b, (x0 + x1) / 2, y - 0.04, (z0 + z1) / 2)); const c = box(Math.abs(x1 - x0), y - 0.04, 0.03, lm, 0.002); g.add(at(c, (x0 + x1) / 2, 0, Math.max(z0, z1))); };
  // first flight along -z on the side opposite to the turn
  const xa = sgn > 0 ? -hw : hw - fw, xb = xa + fw; const run1 = p.d - fw;
  if (p.shape === 'quarter') {
    const run2 = p.w - fw, n1 = Math.max(1, Math.round((n - 1) * run1 / (run1 + run2))), n2 = n - 1 - n1, t1 = run1 / n1, t2 = run2 / Math.max(1, n2);
    for (let i = 0; i < n1; i++) step(xa, xb, hd - (i + 1) * t1, hd - i * t1, i);
    step(xa, xb, -hd, -hd + fw, n1);
    for (let j = 0; j < n2; j++) { const x0 = sgn > 0 ? xb + j * t2 : xa - (j + 1) * t2; const i = n1 + 1 + j, y = (i + 1) * rise; g.add(at(box(t2 + 0.02, 0.04, fw, m, 0.006), x0 + t2 / 2, y - 0.04, -hd + fw / 2)); g.add(at(box(0.03, y - 0.04, fw, lm, 0.002), sgn > 0 ? x0 : x0 + t2, 0, -hd + fw / 2)); }
  } else {
    const n1 = Math.floor((n - 1) / 2), n2 = n - 1 - n1, t1 = run1 / n1, t2 = run1 / Math.max(1, n2), xc = sgn > 0 ? hw - fw : -hw, xd = xc + fw;
    for (let i = 0; i < n1; i++) step(xa, xb, hd - (i + 1) * t1, hd - i * t1, i);
    step(-hw, hw, -hd, -hd + fw, n1);
    for (let j = 0; j < n2; j++) { const i = n1 + 1 + j, y = (i + 1) * rise; g.add(at(box(fw, 0.04, t2 + 0.02, m, 0.006), (xc + xd) / 2, y - 0.04, -hd + fw + (j + 0.5) * t2)); g.add(at(box(fw, y - 0.04, 0.03, lm, 0.002), (xc + xd) / 2, 0, -hd + fw + j * t2)); }
  }
  return g;
}
export function furnitureParams(item) {
  const def = FURNITURE[item.type] || FURNITURE.box;
  const p = { ...def, ...item };
  p.w = item.width ?? def.w; p.d = item.depth ?? def.d; p.h = item.height ?? def.h; p.color = item.color ?? def.color;
  return p;
}
export function buildFurniture(item) {
  const def = FURNITURE[item.type] || FURNITURE.box;
  // procedural furniture: merge the parts of one item per material (fewer draw calls); library objects are merged already
  const o = def.lib ? def.build(furnitureParams(item)) : mergeByMaterial(def.build(furnitureParams(item)));
  o.traverse((m) => { if (m.isMesh) { m.castShadow = !def.flat && !def.noShadow; m.receiveShadow = true; } });
  return o;
}
