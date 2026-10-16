#!/usr/bin/env node
// Creates a new object folder with object.json and recipe.json templates.
// Usage: node tools/new-object.mjs <id> [--name "English name"] [--author github-handle]
//   id examples: generic/furniture/storage/cube-shelf-4x4
//                manufacturers/ikea/furniture/storage/kallax-4x4
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LIBRARY } from './lib.mjs';

const args = process.argv.slice(2); const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const id = args[0];
if (!id || !/^(generic|manufacturers\/[a-z0-9-]+)(\/[a-z0-9-]+){2,}$/.test(id)) { console.error('Usage: node tools/new-object.mjs <generic|manufacturers/<maker>>/<category>/.../<slug>  (lowercase-with-dashes)'); process.exit(1); }
const dir = join(LIBRARY, id); if (existsSync(join(dir, 'object.json'))) { console.error(`${id} already exists`); process.exit(1); }
const parts = id.split('/'); const maker = parts[0] === 'manufacturers' ? parts[1] : null;
const category = parts.slice(maker ? 2 : 1, -1).join('/');
const today = new Date().toISOString().slice(0, 10);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'object.json'), JSON.stringify({
  schema: 1, id, name: { en: opt('--name') || parts.at(-1).replace(/-/g, ' ') }, category,
  manufacturer: maker ? maker : null, model: null, variant: null,
  dimensions: { w: 1, d: 0.5, h: 1 }, mount: 'floor', ha: { domains: [] }, tags: [],
  license: 'CC0-1.0', author: opt('--author') || 'your-github-handle', generated_by: 'hometwin add-object skill', sources: [], created: today,
}, null, 2) + '\n');
writeFileSync(join(dir, 'recipe.json'), JSON.stringify({
  schema: 1,
  params: { w: { default: 1, min: 0.3, max: 3, label: { en: 'Width', de: 'Breite' } }, d: { default: 0.5, min: 0.2, max: 1.5, label: { en: 'Depth', de: 'Tiefe' } }, h: { default: 1, min: 0.3, max: 2.5, label: { en: 'Height', de: 'Höhe' } }, color: { default: '#b48d63', type: 'color', label: { en: 'Colour', de: 'Farbe' } } },
  materials: { body: { base: 'wood_oak', color: '$color' } },
  parts: [{ name: 'body', shape: 'box', size: ['w', 'h', 'd'], round: 0.01, mat: 'body' }],
}, null, 2) + '\n');
console.log(`Created ${dir}\nNext: edit object.json and recipe.json, then npm run preview -- ${id} && npm run validate -- ${id}`);
