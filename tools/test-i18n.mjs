import assert from 'node:assert/strict';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['frontend/src/i18n.js'], bundle: true, format: 'esm', write: false, platform: 'node' });
const i18n = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
assert.equal(i18n.getLanguage(), 'en');
assert.equal(i18n.t('panel.saved'), 'Saved');
assert.equal(i18n.t('panel.saveError', { error: '$& <test>' }), 'Could not save: $& <test>');
assert.equal(i18n.setLanguage('de'), 'de');
assert.equal(i18n.t('panel.saved'), 'Gespeichert');
assert.equal(i18n.localize({ en: 'English fallback' }), 'English fallback');
assert.equal(i18n.localize({ en: 'Chair', de: 'Stuhl' }), 'Stuhl');
assert.equal(i18n.formatNumber(12.5), '12,5');
assert.equal(i18n.setLanguage('fr'), 'en');
assert.equal(i18n.formatNumber(12.5), '12.5');
assert.equal(i18n.setLanguage('__proto__'), 'en');
assert.equal(i18n.t('missing.key'), 'missing.key');
console.log('PASS: default language, switching, fallback, interpolation and number formats');
