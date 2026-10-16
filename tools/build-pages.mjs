#!/usr/bin/env node
// Publishes the library for GitHub Pages: docs/library/library.json (index + recipes) and the preview images.
// The panel and the website load this file, so merged objects appear without a new release.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { LIBRARY } from './lib.mjs';

const index = JSON.parse(readFileSync(join(LIBRARY, 'index.json'), 'utf8'));
const out = join(LIBRARY, '..', 'docs', 'library');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const items = index.items.map((it) => {
  const dir = join(LIBRARY, it.id); const recipe = existsSync(join(dir, 'recipe.json')) ? JSON.parse(readFileSync(join(dir, 'recipe.json'), 'utf8')) : null;
  if (it.preview) { const dst = join(out, it.preview); mkdirSync(dirname(dst), { recursive: true }); copyFileSync(join(LIBRARY, it.preview), dst); }
  return { ...it, recipe };
});
writeFileSync(join(out, 'index.json'), JSON.stringify(index));
writeFileSync(join(out, 'library.json'), JSON.stringify({ schema: 1, generated: index.generated, count: items.length, categories: index.categories, items }));
console.log(`docs/library: ${items.length} objects published`);
