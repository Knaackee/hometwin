import assert from 'node:assert/strict';
import { build } from 'esbuild';

const source = `
  import { setLanguage } from './frontend/src/i18n.js';
  import { FURNITURE, FURNITURE_CATS } from './frontend/src/furniture.js';
  import { KINDS, LIGHT_STYLES } from './frontend/src/devices.js';
  import { ROOF_TYPES, ROOF_COVERS } from './frontend/src/roof.js';
  import { assetCatalog, CATALOG_CATS } from './frontend/src/thumbs.js';
  export { setLanguage, FURNITURE, FURNITURE_CATS, KINDS, LIGHT_STYLES, ROOF_TYPES, ROOF_COVERS, assetCatalog, CATALOG_CATS };
`;
const { outputFiles } = await build({
  stdin: { contents: source, resolveDir: process.cwd(), sourcefile: 'data-i18n-test.js' },
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
});
const noop = () => {};
const gradient = { addColorStop: noop };
const context = new Proxy({
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
  createPattern: () => null,
  measureText: () => ({ width: 0 }),
}, { get: (target, prop) => prop in target ? target[prop] : noop });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const data = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

data.setLanguage('en');
assert.equal(data.FURNITURE.cornerSofa.label, 'Corner sofa');
assert.equal(data.KINDS.radiator.label, 'Radiator');
assert.equal(data.LIGHT_STYLES.ceiling, 'Ceiling light');
assert.equal(data.ROOF_TYPES.gable, 'Gable roof');
assert.equal(data.ROOF_COVERS.gruen.label, 'Green roof (flat roof)');
assert(data.FURNITURE_CATS.includes('Dining & kitchen'));
let catalog = data.assetCatalog();
assert(catalog.every((item) => data.CATALOG_CATS.includes(item.cat)), 'every English asset category is available');

data.setLanguage('de');
assert.equal(data.FURNITURE.cornerSofa.label, 'Ecksofa');
assert.equal(data.KINDS.radiator.label, 'Heizkörper');
assert.equal(data.LIGHT_STYLES.ceiling, 'Deckenleuchte');
assert.equal(data.ROOF_TYPES.gable, 'Satteldach');
assert.equal(data.ROOF_COVERS.gruen.label, 'Gründach (Flachdach)');
assert(data.FURNITURE_CATS.includes('Essen & Küche'));
catalog = data.assetCatalog();
assert(catalog.every((item) => data.CATALOG_CATS.includes(item.cat)), 'every German asset category is available');

console.log('PASS: runtime labels and catalog categories switch between English and German');

