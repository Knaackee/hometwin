import assert from 'node:assert/strict';
import { openingModelFits, openingModelPreview, openingPickerHtml, openingRecipeDefaults } from '../frontend/src/opening-picker.js';

const model = {
  id: 'generic/architecture/doors/glass-door',
  name: { en: 'Glass door' },
  thumbnail: 'data:image/webp;base64,abc',
  recipe: { params: { w: { min: .3, max: 2 }, h: { min: 1, max: 2.4 }, d: { min: .06, max: .6 }, color: { type: 'color', default: '#fff' }, glazed: { type: 'bool', default: true } } },
};
assert(openingModelFits(model, 1, 2.1, .2));
assert(!openingModelFits(model, 2.1, 2.1, .2));
assert.equal(openingModelPreview(model), model.thumbnail);
const opening = { type: 'door', model: model.id };
const html = openingPickerHtml({ models: [model], opening, width: 1, height: 2.1, depth: .2, language: 'en', t: (key) => key, esc: (value) => value });
assert.match(html, /data-opening-model="generic\/architecture\/doors\/glass-door"/);
assert.match(html, /oModelSearch/);
openingRecipeDefaults(model, opening);
assert.equal(opening.frameColor, '#fff');
assert.equal(opening.glazed, true);
console.log('PASS opening model picker filtering, previews and recipe defaults');
