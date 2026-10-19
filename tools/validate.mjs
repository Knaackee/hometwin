#!/usr/bin/env node
// Validates library objects: schema, folder layout, recipe build, dimensions, size limits, duplicates.
// Usage: node tools/validate.mjs [object-folder|id ...] [--strict] [--json]
//   --strict  missing preview.webp is an error (used in CI)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import Ajv from 'ajv';
import { LIBRARY, readJson, idOf, findObjects, targets } from './lib.mjs';
import { buildRecipe, boundsOf, resolveParams } from '../engine/recipe.js';

const args = process.argv.slice(2);
const STRICT = args.includes('--strict'), JSON_OUT = args.includes('--json');
const ajv = new Ajv({ allErrors: true, strict: false });
const vObject = ajv.compile(readJson(join(LIBRARY, 'schema/object.schema.json')));
const vRecipe = ajv.compile(readJson(join(LIBRARY, 'schema/recipe.schema.json')));
const ALLOWED = new Set(['object.json', 'recipe.json', 'model.glb', 'preview.webp', 'review.png', 'README.md']);
const LIMITS = { recipeBytes: 64 * 1024, glbBytes: 2 * 1024 * 1024, previewBytes: 150 * 1024, triangles: 20000, drawCalls: 12 };
// Triangle budget by the largest outer dimension (after adaptive tessellation of the engine).
export function triangleBudget(m) { return m < 0.3 ? 4000 : m < 1 ? 8000 : 15000; }

function check(dir) {
  const errors = [], warnings = [], info = {};
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  const id = idOf(dir);
  // files
  for (const f of readdirSync(dir)) {
    if (statSync(join(dir, f)).isDirectory()) { err(`unexpected sub-folder "${f}" (objects must not be nested)`); continue; }
    if (!ALLOWED.has(f)) err(`unexpected file "${f}" (allowed: ${[...ALLOWED].join(', ')}; reference photos are linked in sources, never committed)`);
  }
  if (!/^(generic|manufacturers\/[a-z0-9-]+)(\/[a-z0-9-]+)+$/.test(id)) err(`folder path "${id}" must be generic/<category>/.../<slug> or manufacturers/<maker>/<category>/.../<slug>, lowercase-with-dashes`);
  let obj, recipe;
  try { obj = readJson(join(dir, 'object.json')); } catch (e) { err(`object.json: ${e.message}`); return { id, errors, warnings, info }; }
  if (!vObject(obj)) for (const e of vObject.errors) err(`object.json${e.instancePath || ''} ${e.message}${e.params?.allowedValues ? ' ' + JSON.stringify(e.params.allowedValues) : ''}${e.params?.additionalProperty ? ` ("${e.params.additionalProperty}")` : ''}`);
  if (obj.id !== id) err(`object.json id "${obj.id}" must equal the folder path "${id}"`);
  const isMaker = id.startsWith('manufacturers/');
  if (isMaker && !obj.manufacturer) err('objects below manufacturers/ need "manufacturer"');
  if (isMaker && !obj.model) err('objects below manufacturers/ need "model"');
  if (!isMaker && obj.manufacturer) warn('generic objects should not name a manufacturer; move it to manufacturers/<maker>/');
  if (!obj.name?.de) warn('no German name (name.de) – translations are welcome');
  if (!(obj.sources || []).length) warn('no sources – add the product page or datasheet you measured from');
  const catPath = id.split('/').slice(isMaker ? 2 : 1, -1).join('/');
  if (obj.category && obj.category !== catPath) err(`category "${obj.category}" must match the folder "${catPath}"`);

  const hasRecipe = existsSync(join(dir, 'recipe.json')), hasGlb = existsSync(join(dir, 'model.glb'));
  if (!hasRecipe && !hasGlb) err('needs recipe.json (preferred) or model.glb');
  if (hasGlb && statSync(join(dir, 'model.glb')).size > LIMITS.glbBytes) err(`model.glb larger than ${LIMITS.glbBytes / 1024 / 1024} MB`);
  if (hasRecipe) {
    const bytes = statSync(join(dir, 'recipe.json')).size; if (bytes > LIMITS.recipeBytes) err(`recipe.json larger than ${LIMITS.recipeBytes / 1024} KB`);
    try { recipe = readJson(join(dir, 'recipe.json')); } catch (e) { err(`recipe.json: ${e.message}`); }
    if (recipe && !vRecipe(recipe)) for (const e of vRecipe.errors.slice(0, 15)) err(`recipe.json${e.instancePath || ''} ${e.message}${e.params?.additionalProperty ? ` ("${e.params.additionalProperty}")` : ''}${e.params?.allowedValues ? ' ' + JSON.stringify(e.params.allowedValues) : ''}`);
  }
  if (recipe && !errors.some((e) => e.startsWith('recipe.json'))) {
    if (obj.mount === 'opening') {
      if (!['door', 'window'].includes(obj.opening)) err('opening mount requires opening: door or window');
      for (const key of ['w', 'h', 'd']) if (!recipe.params?.[key]) err(`opening recipe requires ${key} parameter`);
      const names = recipe.parts.map(p => p.name);
      if (!names.includes('fixed') || (obj.opening === 'door' && !names.includes('leaf'))) err('opening recipe requires fixed group and doors require leaf group');
      if (recipe.parts.some(p => p.shape !== 'group' || !['fixed', 'leaf'].includes(p.name))) err('opening top-level parts must be fixed/leaf groups');
    }
    // parameter sanity
    for (const [k, d] of Object.entries(recipe.params || {})) {
      if (typeof d !== 'object') continue;
      if (d.min !== undefined && d.max !== undefined && d.min > d.max) err(`param "${k}": min > max`);
      if (typeof d.default === 'number' && ((d.min !== undefined && d.default < d.min) || (d.max !== undefined && d.default > d.max))) err(`param "${k}": default outside min/max`);
    }
    try {
      const { object, stats } = buildRecipe(recipe); const b = boundsOf(object);
      info.size = b.size.map((v) => +v.toFixed(3)); info.triangles = stats.triangles; info.parts = stats.parts; info.drawCalls = stats.drawCalls;
      // Detail follows size: a small object covers few pixels in a house, so it gets a small budget.
      const big = Math.max(...b.size), budget = triangleBudget(big); info.budget = budget;
      if (stats.triangles > LIMITS.triangles) err(`${stats.triangles} triangles (hard limit ${LIMITS.triangles})`);
      else if (stats.triangles > budget) (STRICT ? err : warn)(`${stats.triangles} triangles for an object of ${big.toFixed(2)} m – budget ${budget}. Use fewer segments ("seg"), fewer tiny parts, flat details instead of tubes.`);
      if (stats.drawCalls > LIMITS.drawCalls) (STRICT ? err : warn)(`${stats.drawCalls} materials/draw calls (budget ${LIMITS.drawCalls}) – reuse materials`);
      const D = obj.dimensions || {}; const [w, h, d] = b.size;
      for (const [k, real, want] of [['w (x)', w, D.w], ['h (y)', h, D.h], ['d (z)', d, D.d]]) {
        if (want === undefined) continue; const tol = Math.max(0.02, want * 0.03);
        if (Math.abs(real - want) > tol) err(`model ${k} is ${real.toFixed(3)} m but dimensions say ${want} m (tolerance ±${tol.toFixed(3)})`);
      }
      const [minx, miny, minz] = b.min, [maxx, , maxz] = b.max;
      if (Math.abs(miny) > 0.01) err(`model must stand on y = 0 (lowest point is ${miny.toFixed(3)})`);
      if (Math.abs((minx + maxx) / 2) > 0.02) err(`model must be centred on x (centre at ${((minx + maxx) / 2).toFixed(3)})`);
      if (Math.abs((minz + maxz) / 2) > 0.02) err(`model must be centred on z (centre at ${((minz + maxz) / 2).toFixed(3)})`);
      // extremes of the parameter ranges must still build
      const lo = {}, hi = {};
      for (const [k, dd] of Object.entries(recipe.params || {})) if (typeof dd === 'object' && dd.min !== undefined) { lo[k] = dd.min; hi[k] = dd.max ?? dd.default; }
      if (Object.keys(lo).length) for (const o of [lo, hi]) { try { buildRecipe(recipe, o); } catch (e) { err(`does not build at ${JSON.stringify(o)}: ${e.message}`); } }
      if (!object.children.length) err('recipe produced no geometry');
      const glow = []; object.traverse((m) => m.userData.glow && glow.push(m));
      if ((obj.ha?.domains || []).includes('light') && !glow.length) warn('light object without a "glow" material – the panel cannot show it switched on');
    } catch (e) { err(`recipe does not build: ${e.message}`); }
  }
  const prev = join(dir, 'preview.webp');
  if (!existsSync(prev)) (STRICT ? err : warn)('preview.webp missing – run: npm run preview -- ' + id);
  else if (statSync(prev).size > LIMITS.previewBytes) err(`preview.webp larger than ${LIMITS.previewBytes / 1024} KB`);
  return { id, obj, errors, warnings, info };
}

const dirs = targets(args);
if (!dirs.length) { console.error('No objects found.'); process.exit(1); }
const results = dirs.map(check);
// duplicates across the whole library
const all = findObjects().map((d) => { try { return { id: idOf(d), o: readJson(join(d, 'object.json')) }; } catch { return null; } }).filter(Boolean);
for (const r of results) {
  if (!r.obj?.manufacturer || !r.obj?.model) continue;
  const key = (o) => [o.manufacturer, o.model, o.variant || ''].join('|').toLowerCase();
  const dup = all.filter((x) => x.id !== r.id && x.o.manufacturer && key(x.o) === key(r.obj));
  if (dup.length) r.errors.push(`duplicate of ${dup.map((x) => x.id).join(', ')} (same manufacturer, model and variant)`);
}
for (const r of results) {
  const slug = basename(r.id); const same = all.filter((x) => x.id !== r.id && basename(x.id) === slug && x.id.split('/').slice(0, -1).join('/') === r.id.split('/').slice(0, -1).join('/'));
  if (same.length) r.errors.push(`slug "${slug}" already used in this category`);
}
if (JSON_OUT) console.log(JSON.stringify(results.map(({ obj, ...r }) => r), null, 2));
else for (const r of results) {
  const ok = !r.errors.length;
  console.log(`${ok ? '✔' : '✘'} ${r.id}${r.info.size ? `  ${r.info.size.join(' × ')} m (w×h×d), ${r.info.parts} parts → ${r.info.drawCalls} draw calls, ${r.info.triangles}/${r.info.budget} tris` : ''}`);
  for (const e of r.errors) console.log(`    error: ${e}`);
  for (const w of r.warnings) console.log(`    warn:  ${w}`);
}
const bad = results.filter((r) => r.errors.length).length;
if (!JSON_OUT) console.log(`\n${results.length - bad}/${results.length} objects valid`);
process.exit(bad ? 1 : 0);
