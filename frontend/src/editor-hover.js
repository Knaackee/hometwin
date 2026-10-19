import { FURNITURE } from './furniture.js';
import { findItem, roomOfOpening } from './plan.js';
import { t } from './i18n.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Adds the editor-only hover affordance. Pointer buttons and touch are left to the editor's
// drag/tap handling so a hover cannot steal an interaction already in progress.
export function installEditorHover(editor) {
  const canvas = editor.app.stage.canvas;
  const clear = () => {
    editor.app.stage.setHoverOpening?.(null);
    const tip = editor.app.$('tip'); if (tip) tip.hidden = true;
  };
  const move = (e) => {
    if (e.pointerType === 'touch' || e.buttons || editor.drag || editor.app.mode !== 'edit' || editor.tool !== 'select') return clear();
    const level = editor.level;
    const hit = level && editor.app.stage.pick(e, { furniture: true, handles: true, levelId: level.id });
    if (!['opening', 'device', 'furniture', 'room'].includes(hit?.type)) return clear();
    const opening = findItem(editor.app.plan, hit.id)?.item;
    if (!opening) return clear();
    editor.app.stage.setHoverOpening?.(hit);
    const room = hit.type === 'opening' ? roomOfOpening(level, opening) : null;
    const label = hit.type === 'opening' ? t(`editor.openingType.${opening.type}`) : opening.name || (opening.entity_id ? editor.app.nameOf(opening.entity_id) : FURNITURE[opening.type]?.label || opening.type || hit.type);
    const tip = editor.app.$('tip');
    if (tip) {
      const root = editor.app.getBoundingClientRect();
      tip.innerHTML = `${esc(label)}<small>${esc(room?.name || level.name)}</small>`;
      tip.style.left = `${e.clientX - root.left + 14}px`;
      tip.style.top = `${e.clientY - root.top + 14}px`;
      tip.hidden = false;
    }
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerleave', clear);
  canvas.addEventListener('pointerdown', clear);
  return { move, clear, dispose: () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', clear); canvas.removeEventListener('pointerdown', clear); clear(); } };
}

