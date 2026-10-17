import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../frontend/src/locales/', import.meta.url);
const files = readdirSync(root).filter((name) => name.endsWith('.json'));
const names = files.filter((name) => name.endsWith('.en.json'));
const languages = [...new Set(files.map((name) => name.split('.').at(-2)))];
assert(names.length, 'No English source dictionaries found');
const keys = new Set();
const placeholders = (value) => [...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map((m) => m[1]).sort();
for (const name of names) {
  const en = JSON.parse(readFileSync(new URL(name, root), 'utf8'));
  for (const [key, value] of Object.entries(en)) {
    assert(!keys.has(key), `Duplicate key: ${key}`);
    keys.add(key);
    assert(typeof value === 'string' && value.trim(), `${key}: empty English text`);
  }
  for (const language of languages.filter((lang) => lang !== 'en')) {
    const translatedName = name.replace('.en.', `.${language}.`);
    const translated = JSON.parse(readFileSync(new URL(translatedName, root), 'utf8'));
    assert.deepEqual(Object.keys(translated).sort(), Object.keys(en).sort(), `${translatedName}: language keys differ`);
    for (const [key, value] of Object.entries(en)) {
      assert(typeof translated[key] === 'string' && translated[key].trim(), `${language}/${key}: empty text`);
      assert.deepEqual(placeholders(translated[key]), placeholders(value), `${language}/${key}: placeholders differ`);
    }
  }
}
for (const name of readdirSync(new URL('../frontend/src/', import.meta.url)).filter((f) => f.endsWith('.js'))) {
  const source = readFileSync(new URL(`../frontend/src/${name}`, import.meta.url), 'utf8');
  for (const match of source.matchAll(/\b(?:t|tr)\(['"]([^'"]+)['"]/g)) {
    assert(keys.has(match[1]), `${name}: missing translation ${match[1]}`);
  }
}
console.log(`PASS: ${keys.size} translation keys, ${languages.join('/')} placeholders and source references`);
