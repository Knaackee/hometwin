#!/usr/bin/env node
// Builds library/index.json, the catalogue the HomeTwin panel and the website read.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LIBRARY, readJson, idOf, findObjects } from './lib.mjs';

const items = findObjects().map((dir) => {
  const o = readJson(join(dir, 'object.json'));
  return { id: idOf(dir), name: o.name, category: o.category, manufacturer: o.manufacturer || null, model: o.model || null, variant: o.variant || null, dimensions: o.dimensions, mount: o.mount, ...(o.opening ? { opening: o.opening } : {}), ha: o.ha || {}, tags: o.tags || [], license: o.license, author: o.author, format: existsSync(join(dir, 'recipe.json')) ? 'recipe' : 'glb', preview: existsSync(join(dir, 'preview.webp')) ? `${idOf(dir)}/preview.webp` : null };
});
const categories = [...new Set(items.map((i) => i.category))].sort();
const indexPath = join(LIBRARY, 'index.json');
const previous = existsSync(indexPath) ? readJson(indexPath) : null;
const unchanged = JSON.stringify(previous?.items) === JSON.stringify(items);
writeFileSync(indexPath, JSON.stringify({ schema: 1, generated: unchanged ? previous.generated : new Date().toISOString(), count: items.length, categories, items }, null, 1) + '\n');
console.log(`index.json: ${items.length} objects in ${categories.length} categories`);
