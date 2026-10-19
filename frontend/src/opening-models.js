import { buildRecipe } from '../../engine/recipe.js';
import { LIBRARY } from './furniture.js';

export function openingModels(type, site) {
  const all = new Map([...LIBRARY.values()].map(item => [item.id, item]));
  for (const item of Object.values(site?.library || {})) if (item?.id) all.set(item.id, item);
  return [...all.values()].filter(it => it.mount === 'opening' && it.opening === type);
}

// Recipes fit the actual opening; no mesh scaling that would stretch frames or handles.
// The fixed group remains in the wall, the leaf group follows the existing door hinge.
export function buildOpeningModel(opening, site, width, height, depth) {
  const item = site.library?.[opening.model] || LIBRARY.get(opening.model);
  if (!item || item.mount !== 'opening' || item.opening !== opening.type) return null;
  const recipe = item.recipe;
  if (!recipe?.parts?.some(p => p.name === 'fixed')) return null;
  const params = { w: width, h: height, d: depth };
  for (const key of ['color', 'leafColor', 'glazed']) {
    const override = key === 'color' ? opening.frameColor : opening[key];
    params[key] = override ?? recipe.params?.[key]?.default;
  }
  if (params.color == null) params.color = '#d6d0c4';
  for (const key of ['w', 'h', 'd']) {
    const p = recipe.params?.[key];
    if (!p || params[key] < (p.min ?? 0) || params[key] > (p.max ?? Infinity)) return null;
  }
  try {
    const build = name => {
      const object = buildRecipe({ ...recipe, parts: recipe.parts.filter(p => p.name === name) }, params).object;
      object.traverse(m => { if (m.isMesh && m.material.transparent) { m.castShadow = false; m.userData.glassPane = true; } });
      return object;
    };
    const fixed = build('fixed');
    let glassMat = null; fixed.traverse(m => { if (m.isMesh && m.material.transparent) glassMat = m.material; });
    return { fixed, glassMat, leaf: opening.type === 'door' ? build('leaf') : null };
  } catch (error) {
    console.warn('Invalid opening recipe; keeping the built-in model', opening.model, error);
    return null;
  }
}

// Keep legacy defaults while allowing the cover and its surround independent colours.
export function shutterColors(opening, site) {
  const model = site.library?.[opening.model] || LIBRARY.get(opening.model);
  return {
    slats: opening.shutterColor || '#a3abb8',
    frame: opening.shutterFrameColor || opening.frameColor || model?.recipe?.params?.color?.default || site.facade?.frame || '#2c3142',
  };
}
