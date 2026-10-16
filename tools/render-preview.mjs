#!/usr/bin/env node
// Renders preview.webp (transparent, 480×360) into each object folder and a review sheet
// (3/4, front, side, top + measured size) into .preview/<slug>-sheet.png for checking the model.
// Usage: node tools/render-preview.mjs [object-folder|id ...] [--params '{"w":1.6}'] [--no-write]
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { build } from 'esbuild';
import { ROOT, readJson, idOf, targets } from './lib.mjs';

const args = process.argv.slice(2);
const pi = args.indexOf('--params'); const params = pi >= 0 ? JSON.parse(args[pi + 1]) : {};
const NO_WRITE = args.includes('--no-write');
const dirs = targets(args.filter((a, i) => i !== pi + 1 || pi < 0));
if (!dirs.length) { console.error('No objects found.'); process.exit(1); }

let chromium;
try { ({ chromium } = await import('playwright')); } catch { console.error('Playwright missing. Run: npm install && npx playwright install chromium'); process.exit(1); }
const bundle = await build({ entryPoints: [join(ROOT, 'tools/render-page.js')], bundle: true, format: 'iife', write: false, logLevel: 'error' });
const html = `<!doctype html><html><body style="margin:0;background:transparent"><script>${bundle.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script></body></html>`;

const launch = async () => {
  const opts = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
  try { return await chromium.launch(opts); } catch (e) {
    for (const p of [process.env.HOMETWIN_CHROMIUM, '/opt/pw-browsers/chromium'].filter(Boolean)) if (existsSync(p)) return chromium.launch({ ...opts, executablePath: p });
    console.error('Could not start Chromium. Run: npx playwright install chromium'); throw e;
  }
};
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.setContent(html); await page.waitForFunction(() => window.ready === true);
mkdirSync(join(ROOT, '.preview'), { recursive: true });
let failed = 0;
for (const dir of dirs) {
  const id = idOf(dir);
  try {
    const obj = readJson(join(dir, 'object.json')), recipe = readJson(join(dir, 'recipe.json'));
    const r = await page.evaluate(([rc, pa, meta]) => window.renderRecipe(rc, pa, meta), [recipe, params, { title: `${obj.name?.en || id}  —  ${id}`, expected: obj.dimensions }]);
    const toBuf = (u) => Buffer.from(u.split(',')[1], 'base64');
    const sheet = join(ROOT, '.preview', `${basename(dir)}-sheet.png`);
    writeFileSync(sheet, toBuf(r.sheet));
    if (!NO_WRITE) writeFileSync(join(dir, 'preview.webp'), toBuf(r.preview));
    const s = r.bounds.size.map((v) => v.toFixed(3));
    console.log(`✔ ${id}\n    size W ${s[0]} × D ${s[2]} × H ${s[1]} m · ${r.stats.triangles} tris\n    preview: ${NO_WRITE ? '(not written)' : join(dir, 'preview.webp')}\n    sheet:   ${sheet}`);
  } catch (e) { failed++; console.log(`✘ ${id}: ${e.message}`); }
}
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
await browser.close();
process.exit(failed ? 1 : 0);
