// Shared helpers for the library tools.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const LIBRARY = join(ROOT, 'library');

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const idOf = (dir) => relative(LIBRARY, resolve(dir)).split(sep).join('/');

// All object folders (folders that contain object.json) below a directory.
export function findObjects(dir = LIBRARY) {
  const out = [];
  const walk = (d) => {
    if (existsSync(join(d, 'object.json'))) { out.push(d); return; }
    for (const n of readdirSync(d)) { const p = join(d, n); if (n !== 'schema' && !n.startsWith('.') && statSync(p).isDirectory()) walk(p); }
  };
  if (existsSync(dir)) walk(resolve(dir));
  return out.sort();
}
// Object folders from CLI arguments (folders, ids, or nothing = whole library).
export function targets(args) {
  const list = args.filter((a) => !a.startsWith('--'));
  if (!list.length) return findObjects();
  return list.flatMap((a) => { const p = existsSync(a) ? resolve(a) : join(LIBRARY, a); return findObjects(p); });
}
