import { findItem } from './plan.js';

// Screen-right projected onto the floor gives stable axes even in the top view.
export function nudgeSelection(editor, event) {
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const direction = directions[event.key];
  const app = editor.app;
  if (!direction || event.altKey || editor.tool !== 'select' || editor.drag || app.stage.walk) return false;
  const target = event.composedPath()[0];
  if (target?.isContentEditable || target?.closest?.('button,a,[role="dialog"],[role="slider"]')) return false;
  if (['wizard', 'onboard'].some(id => app.$(id) && !app.$(id).hidden)) return false;
  const items = editor.selection().filter(s => ['device', 'furniture'].includes(s.type))
    .map(s => ({ ...findItem(app.plan, s.id), type: s.type }))
    .filter(f => f.item?.pos && !f.item.locked);
  if (!items.length) return false;
  event.preventDefault();
  event.stopPropagation();
  const signature = items.map(f => f.item.id).join('|');
  if (!event.repeat || editor._nudge?.plan !== app.plan || editor._nudge?.signature !== signature) app.pushUndo();
  editor._nudge = { plan: app.plan, signature };
  const step = event.ctrlKey || event.metaKey ? 0.01 : event.shiftKey ? 0.5 : 0.05;
  app.stage.camera.updateMatrixWorld();
  const m = app.stage.camera.matrixWorld.elements;
  const length = Math.hypot(m[0], m[2]) || 1;
  const rightX = m[0] / length, rightZ = m[2] / length;
  const dx = (direction[0] * rightX + direction[1] * rightZ) * step;
  const dz = (direction[0] * rightZ - direction[1] * rightX) * step;
  // Move the whole selection before recomputing support heights.
  for (const { item } of items) item.pos = [item.pos[0] + dx, item.pos[1] + dz].map(v => Math.round(v * 1e6) / 1e6);
  for (const f of items) app.stage.moveItem(f.level.id, f.type, f.item);
  app.stage.select(app.sel, editor.multi);
  editor.dimsDirty = true;
  app.markDirty();
  editor.renderInspector();
  editor.renderBar();
  return true;
}
