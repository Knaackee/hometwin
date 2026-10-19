// Small, DOM-only opening model picker used by the editor inspector.
export function openingModelFits(model, width, height, depth) {
  const p = model?.recipe?.params || {};
  return [['w', width], ['h', height], ['d', depth]].every(([key, value]) => {
    const range = p[key];
    return !!range && (value >= (range.min ?? -Infinity) && value <= (range.max ?? Infinity));
  });
}

export function openingModelPreview(model) {
  if (model?.thumbnail?.startsWith?.('data:')) return model.thumbnail;
  if (!model?.id) return '';
  return `https://knaackee.github.io/hometwin/library/${model.id.split('/').map(encodeURIComponent).join('/')}/preview.webp`;
}

const labelFor = (model, language) => model.name?.[language] || model.name?.en || model.id;

export function openingPickerHtml({ models, current, opening, width, height, depth, language, t, esc }) {
  const selected = models.find((model) => model.id === opening.model);
  const card = (model, currentCard = false) => {
    const fits = openingModelFits(model, width, height, depth);
    const image = openingModelPreview(model);
    return `<button type="button" class="opening-model-card${model.id === opening.model ? ' selected' : ''}" aria-pressed="${model.id === opening.model}" data-opening-model="${esc(model.id)}" ${!fits ? 'disabled' : ''} title="${esc(labelFor(model, language))}" style="text-align:left;display:flex;gap:8px;align-items:center;width:100%;padding:7px;border:1px solid var(--line,#d5d7dc);border-radius:6px;background:var(--panel,#18202c);color:inherit;opacity:${fits ? 1 : .48};cursor:${fits ? 'pointer' : 'not-allowed'}">
      ${image ? `<img src="${esc(image)}" alt="" loading="lazy" style="width:58px;height:48px;object-fit:contain;background:var(--surface,#f3f4f6);border-radius:4px">` : '<span style="width:58px;height:48px"></span>'}
      <span style="min-width:0"><b>${esc(labelFor(model, language))}</b>${!fits ? `<small style="display:block;color:var(--danger,#b42318)">${esc(t('editor.opening.incompatible'))}</small>` : currentCard ? `<small style="display:block;color:var(--muted,#6b7280)">${esc(t('editor.opening.currentModel'))}</small>` : ''}</span>
    </button>`;
  };
  const currentLabel = selected ? labelFor(selected, language) : t('editor.opening.builtin');
  return `<details class="opening-model-picker" ${selected ? 'open' : ''}><summary>${esc(t('editor.opening.model'))}: ${esc(currentLabel)}</summary>
    <div class="opening-model-current" style="margin:8px 0">${selected ? card(selected, true) : `<div class="hint">${esc(t('editor.opening.builtin'))}</div>`}</div>
    <label class="field" style="display:block"><span>${esc(t('editor.opening.searchModels'))}</span><input type="search" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:inherit" id="oModelSearch" value="" placeholder="${esc(t('editor.opening.searchModels'))}"></label>
    <button type="button" class="btn small" data-opening-model="">${esc(t('editor.opening.builtin'))}</button><div class="opening-model-list" style="display:grid;gap:6px;max-height:240px;overflow:auto">${models.map((model) => card(model)).join('')}</div>
  </details>`;
}

export function openingRecipeColorFields(model, opening, { t, esc }) {
  const params = model?.recipe?.params || {};
  const fields = ['color', 'leafColor'].filter((key) => params[key]?.type === 'color').map((key) => {
    const value = opening[key === 'color' ? 'frameColor' : key] || params[key].default || '#d6d0c4';
    return `<div class="field"><label for="o${key === 'color' ? 'Frame' : 'Leaf'}Color">${esc(t(`editor.opening.${key === 'color' ? 'frameColor' : 'leafColor'}`))}</label><input type="color" id="o${key === 'color' ? 'Frame' : 'Leaf'}Color" value="${esc(value)}"></div>`;
  }).join('');
  return fields + (fields ? `<div class="actions"><button type="button" class="btn small" data-act="resetOpeningModel">${esc(t('editor.opening.resetModelDefaults'))}</button></div>` : '');
}

export function openingRecipeDefaults(model, opening) {
  const params = model?.recipe?.params || {};
  if (!model) return;
  opening.frameColor = params.color?.default || undefined;
  opening.leafColor = params.leafColor?.default || undefined;
  if (params.glazed) opening.glazed = params.glazed.default ?? false;
  else delete opening.glazed;
}
