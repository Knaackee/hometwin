// HomeTwin recipe engine.
// Builds a Three.js object from a declarative recipe (recipe.json). Recipes are data only:
// expressions are parsed by a small safe evaluator, nothing from a recipe is ever executed as code.
//
// Conventions (same as the HomeTwin panel):
//   units metres, y up, the object stands on y = 0, centred on x/z, front faces +z.
//   Wall-mounted objects: back face at z = -d/2 (touches the wall).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const RECIPE_SCHEMA_VERSION = 1;

/* ---------------- safe expressions ---------------- */
const FUNCS = { min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, sin: (d) => Math.sin((d * Math.PI) / 180), cos: (d) => Math.cos((d * Math.PI) / 180), tan: (d) => Math.tan((d * Math.PI) / 180), round: Math.round, floor: Math.floor, pow: Math.pow, exp: Math.exp, log: Math.log, ceil: Math.ceil, clamp: (v, a, b) => Math.min(b, Math.max(a, v)) };
const CONSTS = { pi: Math.PI };
const exprCache = new Map();

function tokenize(src) {
  const t = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i)); if (num) { t.push({ k: 'n', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)); if (id) { t.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(<=|>=|==|!=|&&|\|\||[-+*/%()<>,?:!])/.exec(src.slice(i)); if (op) { t.push({ k: 'op', v: op[0] }); i += op[0].length; continue; }
    throw new Error(`Unexpected character "${c}" in expression "${src}"`);
  }
  return t;
}
// Recursive-descent parser producing a closure tree.
function compile(src) {
  if (exprCache.has(src)) return exprCache.get(src);
  const t = tokenize(src); let p = 0;
  const peek = (v) => t[p] && t[p].k === 'op' && t[p].v === v;
  const eat = (v) => { if (!peek(v)) throw new Error(`Expected "${v}" in "${src}"`); p++; };
  const bin = (next, ops) => () => { let l = next(); while (t[p]?.k === 'op' && ops[t[p].v]) { const f = ops[t[p++].v], a = l, b = next(); l = (s) => f(a(s), b(s)); } return l; };
  let ternary;
  const primary = () => {
    const tok = t[p++]; if (!tok) throw new Error(`Unexpected end of "${src}"`);
    if (tok.k === 'n') return () => tok.v;
    if (tok.k === 'op' && tok.v === '(') { const e = ternary(); eat(')'); return e; }
    if (tok.k === 'op' && tok.v === '-') { const e = unary(); return (s) => -e(s); }
    if (tok.k === 'op' && tok.v === '!') { const e = unary(); return (s) => (e(s) ? 0 : 1); }
    if (tok.k === 'id') {
      if (peek('(')) {
        const f = FUNCS[tok.v]; if (!f) throw new Error(`Unknown function "${tok.v}" in "${src}"`);
        p++; const args = []; if (!peek(')')) { args.push(ternary()); while (peek(',')) { p++; args.push(ternary()); } } eat(')');
        return (s) => f(...args.map((a) => a(s)));
      }
      if (tok.v in CONSTS) return () => CONSTS[tok.v];
      return (s) => { if (!(tok.v in s)) throw new Error(`Unknown name "${tok.v}" in "${src}"`); return s[tok.v]; };
    }
    throw new Error(`Unexpected "${tok.v}" in "${src}"`);
  };
  const unary = primary;
  const mul = bin(unary, { '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b });
  const add = bin(mul, { '+': (a, b) => a + b, '-': (a, b) => a - b });
  const cmp = bin(add, { '<': (a, b) => +(a < b), '>': (a, b) => +(a > b), '<=': (a, b) => +(a <= b), '>=': (a, b) => +(a >= b), '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b) });
  const and = bin(cmp, { '&&': (a, b) => +(a && b) });
  const or = bin(and, { '||': (a, b) => +(a || b) });
  ternary = () => { const c = or(); if (peek('?')) { p++; const a = ternary(); eat(':'); const b = ternary(); return (s) => (c(s) ? a(s) : b(s)); } return c; };
  const fn = ternary(); if (p !== t.length) throw new Error(`Unexpected "${t[p].v}" in "${src}"`);
  exprCache.set(src, fn); return fn;
}
export function evalExpr(v, scope) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') throw new Error(`Expected number or expression, got ${JSON.stringify(v)}`);
  const r = compile(v)(scope);
  if (!Number.isFinite(r)) throw new Error(`Expression "${v}" is not a finite number`);
  return r;
}
const vec = (a, scope, n = 3, def = 0) => { const out = []; for (let i = 0; i < n; i++) out.push(a && a[i] !== undefined ? evalExpr(a[i], scope) : def); return out; };

/* ---------------- materials ---------------- */
export const MATERIAL_PRESETS = {
  wood_oak: { color: '#b48d63', rough: 0.75 },
  wood_light: { color: '#d8c3a0', rough: 0.75 },
  wood_walnut: { color: '#5a4636', rough: 0.7 },
  wood_white: { color: '#eceae5', rough: 0.7 },
  laminate_white: { color: '#f1f0ec', rough: 0.55 },
  laminate_black: { color: '#2a2b2f', rough: 0.55 },
  metal_black: { color: '#24272e', rough: 0.45, metal: 0.6 },
  metal_white: { color: '#e9e9e6', rough: 0.4, metal: 0.4 },
  steel: { color: '#a8adb5', rough: 0.35, metal: 0.8 },
  chrome: { color: '#d9dde2', rough: 0.15, metal: 1 },
  brass: { color: '#c8a24a', rough: 0.3, metal: 0.9 },
  copper: { color: '#b87333', rough: 0.35, metal: 0.9 },
  plastic_white: { color: '#eceae5', rough: 0.5 },
  plastic_grey: { color: '#9a9ea6', rough: 0.5 },
  plastic_black: { color: '#22252b', rough: 0.5 },
  rubber: { color: '#1d1f23', rough: 0.95 },
  fabric: { color: '#7d8597', rough: 1 },
  leather: { color: '#6b4a35', rough: 0.6 },
  glass: { color: '#cfe3ee', rough: 0.05, metal: 0.1, opacity: 0.35 },
  glass_frosted: { color: '#f2f4f5', rough: 0.6, opacity: 0.8 },
  ceramic: { color: '#f3f3f1', rough: 0.3 },
  marble: { color: '#e8e6e1', rough: 0.35 },
  concrete: { color: '#9a9a96', rough: 0.95 },
  stone: { color: '#7d7a73', rough: 0.9 },
  paper: { color: '#f4efe4', rough: 1 },
  screen: { color: '#0b0d12', rough: 0.15, metal: 0.2 },
  led: { color: '#fff4dc', rough: 0.4, emissive: '#fff1d0', glow: true },
  plant: { color: '#4f7a3a', rough: 0.9 },
  soil: { color: '#3b2d22', rough: 1 },
};
function shadeHex(hex, a) { const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + a))); return `#${c.getHexString()}`; }
function resolveColor(v, params) {
  if (typeof v !== 'string') return undefined;
  if (v.startsWith('$')) { const k = v.slice(1); if (typeof params[k] !== 'string') throw new Error(`Colour parameter "${k}" missing`); return params[k]; }
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`Invalid colour "${v}" (use #rrggbb or $param)`);
  return v;
}
function makeMaterials(recipe, params) {
  const defs = recipe.materials || {}; const out = new Map();
  const get = (name) => {
    if (out.has(name)) return out.get(name);
    const def = defs[name] || (MATERIAL_PRESETS[name] ? { base: name } : null);
    if (!def) throw new Error(`Unknown material "${name}"`);
    const base = def.base ? MATERIAL_PRESETS[def.base] : {}; if (def.base && !base) throw new Error(`Unknown base material "${def.base}"`);
    const s = { ...base, ...def };
    let color = resolveColor(s.color, params) || '#cccccc'; if (s.shade) color = shadeHex(color, s.shade);
    const m = new THREE.MeshStandardMaterial({ color, roughness: s.rough ?? 0.8, metalness: s.metal ?? 0 });
    if ((s.opacity ?? 1) < 1) { m.transparent = true; m.opacity = s.opacity; m.depthWrite = false; }
    if (s.emissive) { m.emissive = new THREE.Color(resolveColor(s.emissive, params)); m.emissiveIntensity = s.emissiveIntensity ?? 0.6; }
    if (s.double) m.side = THREE.DoubleSide;
    m.userData.glow = !!s.glow; m.name = name;
    out.set(name, m); return m;
  };
  return get;
}

/* ---------------- shapes ---------------- */
export const SHAPES = ['box', 'cylinder', 'cone', 'sphere', 'dome', 'torus', 'lathe', 'extrude', 'tube', 'screen', 'group'];
// Adaptive tessellation: segments follow the real size (max chord length CHORD), never more than requested.
// A 5 mm knob does not need 24 segments; a 60 cm lamp shade keeps them. Keeps small objects light.
export const CHORD = 0.006;
const SEG = (s, scope, d, r = null, arc = Math.PI * 2, min = 6, adaptive = true) => {
  const req = Math.max(3, Math.min(64, Math.round(evalExpr(s ?? d, scope))));
  if (!adaptive || r == null || !(r > 0)) return req;
  return Math.max(Math.min(req, min), Math.min(req, Math.ceil((Math.abs(arc) * r) / CHORD)));
};
const pts2 = (a, scope) => a.map((q) => new THREE.Vector2(evalExpr(q[0], scope), evalExpr(q[1], scope)));

function geometryOf(part, scope, adaptive) {
  const E = (v, d) => evalExpr(v ?? d, scope);
  switch (part.shape) {
    case 'box': { // bottom centre at origin
      const [w, h, d] = vec(part.size, scope).map((x) => Math.max(0.001, x)); const r = Math.max(0, Math.min(E(part.round, 0), Math.min(w, h, d) / 2 - 0.0005));
      const g = r > 0.0015 ? new RoundedBoxGeometry(w, h, d, adaptive && r < 0.005 ? 1 : 2, r) : new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return g;
    }
    case 'cylinder': { // bottom centre at origin
      const r = E(part.r, 0.05), rt = E(part.rTop, r), rb = E(part.rBottom, r), h = Math.max(0.001, E(part.h, 0.1));
      const g = new THREE.CylinderGeometry(rt, rb, h, SEG(part.seg, scope, 24, Math.max(rt, rb), Math.PI * 2, 6, adaptive), 1, !!part.open); g.translate(0, h / 2, 0); return g;
    }
    case 'cone': { const r = E(part.r, 0.05), h = E(part.h, 0.1); const g = new THREE.ConeGeometry(r, h, SEG(part.seg, scope, 24, r, Math.PI * 2, 6, adaptive), 1, !!part.open); g.translate(0, h / 2, 0); return g; }
    case 'sphere': { const r = E(part.r, 0.05), n = SEG(part.seg, scope, 24, r, Math.PI * 2, 6, adaptive); return new THREE.SphereGeometry(r, n, Math.max(4, n * 0.66 | 0)); } // centre at origin
    case 'dome': { const r = E(part.r, 0.05), n = SEG(part.seg, scope, 24, r, Math.PI * 2, 6, adaptive); return new THREE.SphereGeometry(r, n, Math.max(3, Math.min(12, n / 2 | 0)), 0, Math.PI * 2, 0, Math.PI / 2); } // flat side on y = 0
    case 'torus': { const r = E(part.r, 0.05), tb = E(part.tube, 0.01), arc = (E(part.arc, 360) * Math.PI) / 180; return new THREE.TorusGeometry(r, tb, SEG(10, scope, 10, tb, Math.PI * 2, 4, adaptive), SEG(part.seg, scope, 32, r, arc, 6, adaptive), arc); } // in the x/y plane, centre at origin
    case 'lathe': { // profile [[radius, y], ...] revolved around y
      if (!Array.isArray(part.profile) || part.profile.length < 2) throw new Error('lathe needs a profile with at least 2 points');
      const pr = pts2(part.profile, scope); return new THREE.LatheGeometry(pr, SEG(part.seg, scope, 32, Math.max(...pr.map((q) => Math.abs(q.x))), Math.PI * 2, 6, adaptive));
    }
    case 'extrude': { // profile [[x, y], ...] in the x/y plane, extruded along z, centred on z
      if (!Array.isArray(part.profile) || part.profile.length < 3) throw new Error('extrude needs a profile with at least 3 points');
      const depth = Math.max(0.001, E(part.depth, 0.02)); const bev = E(part.bevel, 0);
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts2(part.profile, scope)), { depth, bevelEnabled: bev > 0, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, curveSegments: 8 });
      g.translate(0, 0, -depth / 2); return g;
    }
    case 'tube': { // path [[x, y, z], ...], radius r
      if (!Array.isArray(part.path) || part.path.length < 2) throw new Error('tube needs a path with at least 2 points');
      const ps = part.path.map((q) => new THREE.Vector3(...vec(q, scope)));
      let curve; if (part.smooth !== false && ps.length > 2) curve = new THREE.CatmullRomCurve3(ps); else { curve = new THREE.CurvePath(); for (let i = 1; i < ps.length; i++) curve.add(new THREE.LineCurve3(ps[i - 1], ps[i])); }
      const tr = E(part.r, 0.01), len = curve.getLength(), straight = part.smooth === false || ps.length === 2; const tub = !adaptive ? Math.max(8, ps.length * 12) : straight ? ps.length - 1 : Math.max(Math.min(8, ps.length * 4), Math.min(ps.length * 12, Math.ceil(len / (CHORD * 2))));
      return new THREE.TubeGeometry(curve, tub, tr, SEG(10, scope, 10, tr, Math.PI * 2, tr < 0.002 ? 4 : 5, adaptive), false);
    }
    case 'screen': { // display surface for live content (TV, monitor, frame): w × h, bottom centre at origin, faces +z.
      // radius > 0 curves it (concave towards the viewer, like a curved TV). UVs always span 0..1 over the visible area.
      return screenGeometry(Math.max(0.01, E(part.w, 1)), Math.max(0.01, E(part.h, 0.5625)), E(part.radius, 0), adaptive);
    }
    default: throw new Error(`Unknown shape "${part.shape}" (allowed: ${SHAPES.join(', ')})`);
  }
}

// Display surface w × h (bottom centre at origin, faces +z); radius > 0 bends it concave towards the viewer.
export function screenGeometry(w, h, R = 0, adaptive = true) {
  if (!(R > 0)) { const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0); return g; }
  const th = Math.min(Math.PI * 0.9, w / R), n = adaptive ? Math.max(8, Math.min(48, Math.ceil(w / CHORD))) : 48; const g = new THREE.PlaneGeometry(1, h, n, 1); const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) { const a = pos.getX(i) * th; pos.setXYZ(i, R * Math.sin(a), pos.getY(i) + h / 2, R * (1 - Math.cos(a))); }
  g.computeVertexNormals(); return g;
}

/* ---------------- builder ---------------- */
// Resolves parameter defaults and overrides into a flat scope.
export function resolveParams(recipe, overrides = {}) {
  const scope = {};
  for (const [k, def] of Object.entries(recipe.params || {})) {
    const d = typeof def === 'object' && def !== null ? def : { default: def };
    let v = overrides[k] ?? d.default;
    if (d.type === 'color') { scope[k] = v; continue; }
    if (d.type === 'bool') { scope[k] = v ? 1 : 0; continue; }
    v = Number(v); if (!Number.isFinite(v)) throw new Error(`Parameter "${k}" is not a number`);
    if (d.min !== undefined) v = Math.max(d.min, v); if (d.max !== undefined) v = Math.min(d.max, v);
    if (d.type === 'int') v = Math.round(v);
    scope[k] = v;
  }
  // derived values: "derived": { "inner": "w - 2*t" }
  for (const [k, e] of Object.entries(recipe.derived || {})) scope[k] = evalExpr(e, scope);
  return scope;
}

function addParts(parent, parts, scope, getMat, stats, adaptive) {
  for (const part of parts || []) {
    const reps = part.repeat ? Math.max(0, Math.min(500, Math.round(evalExpr(part.repeat.n, scope)))) : 1;
    const v = part.repeat?.var || 'i';
    for (let i = 0; i < reps; i++) {
      let s = part.repeat ? { ...scope, [v]: i } : scope;
      if (part.let) { s = { ...s }; for (const [k, e] of Object.entries(part.let)) s[k] = evalExpr(e, s); } // per-copy helper values
      if (part.when !== undefined && !evalExpr(part.when, s)) continue;
      const mirrors = { x: [[1, 1], [-1, 1]], z: [[1, 1], [1, -1]], xz: [[1, 1], [-1, 1], [1, -1], [-1, -1]] }[part.mirror || ''] || [[1, 1]];
      for (const [mx, mz] of mirrors) {
        let obj;
        if (part.shape === 'group') { obj = new THREE.Group(); addParts(obj, part.parts, s, getMat, stats, adaptive); }
        else {
          const g = geometryOf(part, s, adaptive); stats.triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
          obj = new THREE.Mesh(g, getMat(part.mat || 'plastic_white')); obj.castShadow = true; obj.receiveShadow = true;
          if (obj.material.userData.glow) obj.userData.glow = true;
        }
        const [x, y, z] = vec(part.pos, s); const [rx, ry, rz] = vec(part.rot, s);
        obj.position.set(x * mx, y, z * mz);
        obj.rotation.set((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180, 'YXZ');
        if (mx < 0 || mz < 0) obj.scale.set(mx, 1, mz); // mirrored copy (Three.js fixes the face winding)
        if (part.name) obj.name = part.name;
        const role = part.role || (part.shape === 'screen' ? 'screen' : null); if (role) { obj.userData.role = role; obj.castShadow = false; }
        parent.add(obj); stats.parts++;
        if (stats.parts > 2000) throw new Error('Too many parts (limit 2000)');
      }
    }
  }
}

// Builds the recipe. Returns { object, scope, stats }.
// opts.merge (default true): merge all static parts with the same material into one mesh
// (a 50-part object becomes ~10 draw calls). Parts with a `role` (e.g. screen) stay separate.
// opts.adaptive (default true): size-dependent tessellation (see CHORD).
export function buildRecipe(recipe, overrides = {}, opts = {}) {
  if (!recipe || typeof recipe !== 'object') throw new Error('Recipe must be an object');
  const adaptive = opts.adaptive !== false;
  const scope = resolveParams(recipe, overrides);
  const colorParams = Object.fromEntries(Object.entries(recipe.params || {}).filter(([, d]) => d?.type === 'color').map(([k]) => [k, scope[k]]));
  const getMat = makeMaterials(recipe, colorParams);
  const root = new THREE.Group(); root.name = 'recipe';
  const stats = { parts: 0, triangles: 0 };
  addParts(root, recipe.parts, scope, getMat, stats, adaptive);
  root.updateMatrixWorld(true);
  const object = opts.merge === false ? root : mergeByMaterial(root);
  let drawCalls = 0; object.traverse((o) => { if (o.isMesh) drawCalls++; });
  return { object, scope, stats: { ...stats, triangles: Math.round(stats.triangles), drawCalls } };
}

// Bakes every mesh without a role into one geometry per material (world space of the root).
export function mergeByMaterial(root) {
  const out = new THREE.Group().copy(root, false); const groups = new Map(), keep = [];
  root.updateWorldMatrix(true, true);
  const toRoot = root.matrixWorld.clone().invert();
  const localMatrix = (o) => toRoot.clone().multiply(o.matrixWorld);
  const visit = (o) => {
    const semanticData = Object.keys(o.userData).some((k) => k !== 'glow');
    const animatedMesh = o.isMesh && (o.isSkinnedMesh || o.isInstancedMesh || o.morphTargetInfluences || Object.keys(o.geometry?.morphAttributes || {}).length);
    if (o !== root && (!o.visible || semanticData || o.animations?.length || o.isLight || o.isSprite || o.isLine || o.isPoints || animatedMesh)) { keep.push([o, localMatrix(o)]); return; } // kept whole, with children
    o.children.forEach(visit);
    if (!o.isMesh) return;
    // multi-material meshes (e.g. walls with a different face material) are split per material group
    const parts = Array.isArray(o.material) ? (o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }]).map((gr) => [subGeometry(o.geometry, gr), o.material[gr.materialIndex]]).filter(([, m]) => m) : [[null, o.material]];
    for (const [sub, material] of parts) add(o, sub, material);
  };
  const add = (o, sub, material) => {
    let g = sub || (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    const matrix = localMatrix(o); g.applyMatrix4(matrix);
    if (matrix.determinant() < 0) { // mirrored copy: restore the face winding
      for (const a of Object.values(g.attributes)) { const n = a.itemSize, arr = a.array; for (let t = 0; t < a.count; t += 3) for (let c = 0; c < n; c++) { const i1 = (t + 1) * n + c, i2 = (t + 2) * n + c, v = arr[i1]; arr[i1] = arr[i2]; arr[i2] = v; } }
    }
    g.clearGroups(); const k = `${material.uuid}|${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}|${o.renderOrder}`; if (!groups.has(k)) groups.set(k, { mat: material, cast: o.castShadow, recv: o.receiveShadow, order: o.renderOrder, list: [] }); groups.get(k).list.push(g);
  };
  visit(root);
  for (const { mat, cast, recv, order, list } of groups.values()) {
    const m = new THREE.Mesh(list.length === 1 ? list[0] : mergeGeometries(list, false), mat); m.castShadow = cast; m.receiveShadow = recv; m.renderOrder = order; if (mat.userData.glow) m.userData.glow = true; out.add(m);
    if (list.length > 1) list.forEach((x) => x.dispose());
  }
  for (const [o, matrix] of keep) { out.add(o); matrix.decompose(o.position, o.quaternion, o.scale); o.updateMatrix(); } // moved, not copied: outside references stay valid
  return out;
}
function subGeometry(geo, gr) {
  const g = geo.index ? geo.toNonIndexed() : geo; const start = geo.index ? gr.start : gr.start, end = Math.min(start + gr.count, g.attributes.position.count);
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) out.setAttribute(k, new THREE.BufferAttribute(a.array.slice(start * a.itemSize, end * a.itemSize), a.itemSize, a.normalized));
  return out;
}

export function boundsOf(object) {
  object.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(object, true);
  const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  return { min: b.min.toArray(), max: b.max.toArray(), size: size.toArray(), center: c.toArray() };
}
