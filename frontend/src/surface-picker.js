import { normalizeSurfaceDefinition, normalizeSurfaceOptions } from '../../engine/surface.js';
import { FLOOR_SURFACES, surfacePreview } from './surfaces.js';
import { t, getLanguage } from './i18n.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function surfacePickerHtml(room) {
  let current = null, options = {};
  try { if (room.surfaceSpec) current = normalizeSurfaceDefinition(room.surfaceSpec); } catch { /* Keep malformed imported data untouched until the user selects a replacement. */ }
  try { options = normalizeSurfaceOptions(room.surfaceOptions); } catch { /* Render safe defaults. */ }
  const specs = current && !FLOOR_SURFACES.some(s => s.id === current.id) ? [...FLOOR_SURFACES, current] : FLOOR_SURFACES;
  const label = spec => spec.name[getLanguage()] || spec.name.en;
  return `<div class="surface-palette" role="group" aria-label="${t('editor.floor.title')}">${specs.map(spec => `<button type="button" class="surface-card" data-surface="${escape(spec.id)}" aria-pressed="${current?.id === spec.id}"><img src="${surfacePreview(spec)}" alt="" width="112" height="64"><span>${escape(label(spec))}</span></button>`).join('')}</div>
    ${current ? `<div class="field"><label for="floorColor">${t('editor.common.color')}</label><input id="floorColor" type="color" value="${escape(options.color || current.color)}"></div>
    ${current.pattern !== 'noise' ? `<div class="field"><label for="floorRotation">${t('editor.floor.rotation')}</label><input id="floorRotation" type="number" value="${options.rotation || 0}" min="0" max="360" step="15"></div><div class="row2">${['width','length'].map(key => `<div class="field"><label for="floor${key}">${t(`editor.floor.${key}`)}</label><input id="floor${key}" type="number" min="0.02" max="10" step="0.01" value="${options[key] ?? current[key]}"></div>`).join('')}</div>` : ''}
    <button class="btn small" type="button" data-surface-reset>${t('editor.floor.reset')}</button>` : `<p class="hint">${t('editor.floor.legacy')}</p>`}
    ${current ? `<button class="btn small" type="button" data-surface-legacy>${t('editor.floor.restore')}</button>` : ''}`;
}

export function surfacePickerClick(editor, event) {
  const button = event.target.closest('[data-surface],[data-surface-reset],[data-surface-legacy]');
  if (!button || editor.app.sel?.type !== 'room') return false;
  const app = editor.app, room = editor.level.rooms.find(r => r.id === app.sel.id);
  if (!room) return false;
  const spec = FLOOR_SURFACES.find(s => s.id === button.dataset.surface) || (room.surfaceSpec?.id === button.dataset.surface ? room.surfaceSpec : null);
  if (button.hasAttribute('data-surface') && !spec) return false;
  app.pushUndo();
  if (spec) room.surfaceSpec = structuredClone(spec);
  if (button.hasAttribute('data-surface-legacy')) delete room.surfaceSpec;
  delete room.surfaceOptions;
  app.stage.rebuildLevel(editor.level.id); app.stage.select(app.sel); app.markDirty(); editor.renderInspector();
  return true;
}

export function surfacePickerInput(room, id, value) {
  const field = {floorColor:'color',floorRotation:'rotation',floorwidth:'width',floorlength:'length'}[id];
  if (!field || !room.surfaceSpec) return false;
  if (field === 'color') { if (!/^#[0-9a-f]{6}$/i.test(value)) return false; }
  else { value = Number(value); if (!Number.isFinite(value)) return false; value = field === 'rotation' ? ((value % 360) + 360) % 360 : Math.max(.02, Math.min(10, value)); }
  (room.surfaceOptions ||= {})[field] = value;
  return true;
}
