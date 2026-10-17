// Context menu, inline renaming and drag & drop for the layer tree of the editor.
import { icon } from './icons.js';
import { esc } from './panel.js';
import { findItem, newId, computeElevations, slabThickness, roomAt, roomCenter } from './plan.js';
import { placeItem, wallSegments } from './walls.js';
import { bbox } from './geometry.js';
import { t } from './i18n.js';

const RENAMABLE = new Set(['house', 'level', 'room', 'furniture']);
const DRAGGABLE = new Set(['level', 'room', 'device', 'furniture']);

export function installTreeMenu(ed) {
  const app = ed.app, body = app.$('lbody');
  let menu = null;
  const close = () => { menu?.remove(); menu = null; };
  const rowOf = (el) => el?.closest?.('.trow[data-pick]');
  const info = (row) => ({ type: row.dataset.pick, id: row.dataset.id, level: row.dataset.level || null });
  const levelOf = (id) => app.plan.levels.find((l) => l.id === id);

  /* ---------- context menu ---------- */
  body.addEventListener('contextmenu', (e) => {
    const row = rowOf(e.target); if (!row) return;
    e.preventDefault(); const it = info(row); if (['loose', 'roof'].includes(it.type)) return;
    // select what was right-clicked (like Figma), unless it is part of a multi-selection
    if (!['house'].includes(it.type) && !(ed.multi || []).some((x) => x.id === it.id)) row.click();
    open(e.clientX, e.clientY, it, row);
  });
  body.addEventListener('keydown', (e) => {
    const row = rowOf(e.target); if (!row) return;
    if (e.key === 'F2' && RENAMABLE.has(row.dataset.pick)) { e.preventDefault(); rename(row); }
    if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); const r = row.getBoundingClientRect(); open(r.left + 40, r.bottom, info(row), row); }
  });
  function items(it) {
    const L = levelOf(it.level), f = ['device', 'furniture', 'room', 'opening'].includes(it.type) ? findItem(app.plan, it.id) : null;
    const multi = (ed.multi || []).length > 1;
    const others = app.plan.levels.filter((l) => l.id !== it.level);
    const moveTo = others.length && ['device', 'furniture', 'room'].includes(it.type) ? others.map((l) => ({ act: `moveTo:${l.id}`, label: t('data.tree.moveTo', { name: l.name }), ic: 'layers' })) : [];
    switch (it.type) {
      case 'house': return [{ act: 'rename', label: t('data.tree.rename'), ic: 'edit', key: 'F2' }];
      case 'level': {
        const i = app.plan.levels.indexOf(L);
        return [{ act: 'rename', label: t('data.tree.rename'), ic: 'edit', key: 'F2' }, { act: 'zoom', label: t('data.tree.zoom'), ic: 'search' }, { act: 'wizard', label: t('data.tree.floorPlanAssistant'), ic: 'image' }, '-',
          { act: 'dupLevel', label: t('data.tree.duplicateLevel'), ic: 'layers' }, { act: 'up', label: t('data.tree.moveUp'), ic: 'back', disabled: i === app.plan.levels.length - 1 }, { act: 'down', label: t('data.tree.moveDown'), ic: 'back', disabled: i === 0 },
          { act: 'eye', label: app.hiddenLevels.has(it.id) ? t('data.tree.show') : t('data.tree.hide'), ic: app.hiddenLevels.has(it.id) ? 'eye' : 'eyeoff' }, '-',
          { act: 'delLevel', label: t('data.tree.deleteLevel'), ic: 'x', danger: true, disabled: app.plan.levels.length < 2 }];
      }
      case 'room': return [{ act: 'rename', label: t('data.tree.rename'), ic: 'edit', key: 'F2' }, { act: 'zoom', label: t('data.tree.zoom'), ic: 'search' }, ...(moveTo.length ? ['-', ...moveTo] : []), '-', { act: 'delete', label: t('data.tree.deleteRoom'), ic: 'x', danger: true, key: t('data.key.delete') }];
      case 'device': case 'furniture': return [
        ...(it.type === 'furniture' ? [{ act: 'rename', label: t('data.tree.rename'), ic: 'edit', key: 'F2' }] : []), { act: 'zoom', label: t('data.tree.zoom'), ic: 'search' },
        { act: 'dup', label: multi ? t('data.tree.duplicateSelection') : t('data.tree.duplicate'), ic: 'plus', key: t('data.key.duplicate') }, { act: 'rot', label: t('data.tree.rotate90'), ic: 'redo', key: 'R' },
        { act: 'hide', label: f?.item.hidden ? t('data.tree.show') : t('data.tree.hide'), ic: f?.item.hidden ? 'eye' : 'eyeoff' }, { act: 'lock', label: f?.item.locked ? t('data.tree.unlock') : t('data.tree.lock'), ic: f?.item.locked ? 'unlock' : 'lock' },
        ...(moveTo.length ? ['-', ...moveTo] : []), '-', { act: 'delete', label: multi ? t('data.tree.deleteSelection') : t('data.tree.delete'), ic: 'x', danger: true, key: t('data.key.delete') }];
      case 'opening': return [{ act: 'zoom', label: t('data.tree.zoom'), ic: 'search' }, '-', { act: 'delete', label: t('data.tree.delete'), ic: 'x', danger: true, key: t('data.key.delete') }];
      case 'solar': case 'roofitem': return [{ act: 'dup', label: t('data.tree.duplicate'), ic: 'plus', disabled: it.type === 'solar' }, '-', { act: 'delete', label: t('data.tree.delete'), ic: 'x', danger: true }];
      default: return [];
    }
  }
  function open(x, y, it, row) {
    close(); const list = items(it); if (!list.length) return;
    menu = document.createElement('div'); menu.className = 'ctxmenu'; menu.setAttribute('role', 'menu');
    menu.innerHTML = list.map((m) => (m === '-' ? '<hr>' : `<button role="menuitem" data-ctx="${m.act}" class="${m.danger ? 'danger' : ''}" ${m.disabled ? 'disabled' : ''}>${icon(m.ic)}<span>${esc(m.label)}</span>${m.key ? `<kbd>${m.key}</kbd>` : ''}</button>`)).join('');
    app.shadowRoot.appendChild(menu);
    const host = app.getBoundingClientRect(), r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x - host.left, host.width - r.width - 8)}px`; menu.style.top = `${Math.min(y - host.top, host.height - r.height - 8)}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-ctx]'); if (!b) return; close(); act(b.dataset.ctx, it, row); });
    menu.addEventListener('keydown', (e) => {
      const bs = [...menu.querySelectorAll('button:not(:disabled)')], i = bs.indexOf(app.shadowRoot.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); body.querySelector(`.trow[data-id="${it.id}"]`)?.focus(); }
    });
  }
  app.shadowRoot.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.composedPath()[0])) close(); }, true);
  window.addEventListener('blur', close);

  /* ---------- actions ---------- */
  function act(a, it, row) {
    const p = app.plan, L = levelOf(it.level);
    if (a === 'rename') return rename(body.querySelector(`.trow[data-pick="${it.type}"][data-id="${it.id}"]`) || row);
    if (a === 'zoom') { const f = findItem(p, it.id), lv = L || levelOf(it.id); if (it.type === 'level') return app.setLevel(it.id); if (!f || !lv) return;
      if (it.type === 'room') { const b = bbox(f.item.points); app.stage.focusPoint(roomCenter(f.item), app.stage.displayY(lv), Math.max(b.w, b.d)); }
      else if (f.item.pos) app.stage.focusPoint(f.item.pos, app.stage.displayY(lv), 1.5); else if (f.item.from) app.stage.focusPoint([(f.item.from[0] + f.item.to[0]) / 2, (f.item.from[1] + f.item.to[1]) / 2], app.stage.displayY(lv) + 1, 2); return; }
    if (a === 'wizard') return app.wizard.open({ levelId: it.id });
    if (a === 'eye') return ed.toggleFlag(`level:${it.id}`, 'hidden');
    if (a === 'hide') return ed.toggleFlag(`${it.type}:${it.id}`, 'hidden');
    if (a === 'lock') return ed.toggleFlag(`${it.type}:${it.id}`, 'locked');
    if (a === 'dup') return ed.duplicateSel();
    if (a === 'rot') return ed.rotateSel();
    if (a === 'delete') return ed.deleteSel();
    if (a === 'up' || a === 'down') {
      app.pushUndo(); const i = p.levels.findIndex((l) => l.id === it.id), j = a === 'up' ? i + 1 : i - 1; if (j < 0 || j >= p.levels.length) return;
      [p.levels[i], p.levels[j]] = [p.levels[j], p.levels[i]]; restack(p); refreshAll(); return;
    }
    if (a === 'dupLevel') {
      app.pushUndo(); const src = levelOf(it.id); const copy = JSON.parse(JSON.stringify(src)); const map = new Map();
      copy.id = newId('l'); copy.name = t('data.tree.copyName', { name: src.name }); copy.underlay = null; delete copy.floor_id; delete copy.autoElevation;
      for (const k of ['rooms', 'openings', 'devices', 'furniture']) for (const x of copy[k]) { const n = newId(k[0]); map.set(x.id, n); x.id = n; if (k === 'devices') delete x.entity_id; if (k === 'openings') { delete x.cover; delete x.contact; } if (k === 'rooms') x.area_id = null; }
      copy.rooms = copy.rooms.filter((r) => r.kind !== 'void');
      p.levels.splice(p.levels.indexOf(src) + 1, 0, copy); computeElevations(p); refreshAll(); app.toast(t('data.tree.levelCopied', { name: copy.name })); return;
    }
    if (a === 'delLevel') {
      const lv = levelOf(it.id); const n = lv.rooms.length + lv.devices.length + lv.furniture.length;
      if (n && !confirm(t('data.tree.confirmDeleteLevel', { name: lv.name, rooms: lv.rooms.length, devices: lv.devices.length, furniture: lv.furniture.length }))) return;
      app.pushUndo(); p.levels.splice(p.levels.indexOf(lv), 1); computeElevations(p); app.hiddenLevels.delete(lv.id); refreshAll(); app.setLevel(p.levels[0].id); ed.select(null); app.toast(t('data.tree.levelDeleted')); return;
    }
    if (a.startsWith('moveTo:')) return moveToLevel(it, a.slice(7));
  }
  // Re-stacks the levels in their current array order (bottom first), keeping the lowest floor height.
  function restack(p) {
    const base = Math.min(...p.levels.map((l) => l.elevation));
    p.levels.forEach((l, i) => { const below = p.levels[i - 1]; l.elevation = i === 0 ? base : Math.round((below.elevation + below.height + (slabThickness(l))) * 1000) / 1000; delete l.autoElevation; });
    computeElevations(p);
  }
  function refreshAll() { app.stage.rebuildAll(); app.renderLevels(); app.buildLabels(); app.markDirty(); ed.renderLeft(); ed.renderInspector(); ed.renderStatus?.(); }

  // Moves rooms, devices or furniture (incl. a multi-selection) to another level; positions stay.
  function moveToLevel(it, targetId) {
    const p = app.plan, T = levelOf(targetId); if (!T) return;
    const sel = (ed.multi || []).length > 1 && (ed.multi || []).some((x) => x.id === it.id) ? ed.selection() : [it];
    app.pushUndo(); let n = 0;
    for (const s of sel) {
      const f = findItem(p, s.id); if (!f || f.level.id === T.id) continue;
      f.list.splice(f.list.indexOf(f.item), 1);
      if (f.type === 'room') { T.rooms.push(f.item); const ops = f.level.openings.filter((o) => f.item.points.some((q, i) => { const r = f.item.points[(i + 1) % f.item.points.length]; return [o.from, o.to].every((pt) => Math.abs((r[0] - q[0]) * (pt[1] - q[1]) - (r[1] - q[1]) * (pt[0] - q[0])) < 0.05 * Math.hypot(r[0] - q[0], r[1] - q[1])); })); for (const o of ops) { f.level.openings.splice(f.level.openings.indexOf(o), 1); T.openings.push(o); } }
      else (f.type === 'device' ? T.devices : T.furniture).push(f.item);
      n++;
    }
    if (!n) return; refreshAll(); app.setLevel(T.id); ed.select({ type: it.type, id: it.id, level: T.id }); app.toast(t(n === 1 ? 'data.tree.objectMoved' : 'data.tree.objectsMoved', { count: n, name: T.name }));
  }

  /* ---------- inline rename ---------- */
  function rename(row) {
    if (!row) return; const it = info(row); const nm = row.querySelector('.nm'); if (!nm || row.querySelector('input.rename')) return;
    const p = app.plan, f = it.type === 'house' ? { item: p } : it.type === 'level' ? { item: levelOf(it.id) } : findItem(p, it.id); if (!f?.item) return;
    const cur = it.type === 'furniture' ? f.item.label || ed.furnLabel(f.item) : f.item.name || '';
    const inp = document.createElement('input'); inp.className = 'rename'; inp.value = cur; inp.setAttribute('aria-label', t('data.tree.newName')); nm.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true; const v = inp.value.trim();
      if (ok && v && v !== cur) {
        app.pushUndo(); if (it.type === 'furniture') f.item.label = v; else f.item.name = v;
        if (it.type === 'level') app.renderLevels(); if (it.type === 'room') { app.buildLabels(); }
        app.markDirty(); ed.renderInspector();
      }
      ed.renderLeft();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true)); inp.addEventListener('click', (e) => e.stopPropagation()); inp.addEventListener('dblclick', (e) => e.stopPropagation());
  }
  body.addEventListener('dblclick', (e) => { const row = rowOf(e.target); if (row && e.target.closest('.nm') && RENAMABLE.has(row.dataset.pick)) { e.stopImmediatePropagation(); rename(row); } }, true);

  /* ---------- drag & drop ---------- */
  let drag = null;
  const clear = () => body.querySelectorAll('.drop-before,.drop-after,.drop-into,.dragging').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into', 'dragging'));
  body.addEventListener('dragstart', (e) => {
    const row = rowOf(e.target); if (!row || !DRAGGABLE.has(row.dataset.pick)) return;
    drag = info(row); row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `tree:${drag.type}:${drag.id}`);
  });
  const target = (e) => {
    const row = rowOf(e.target); if (!row || !drag) return null; const t = info(row); if (t.id === drag.id) return null;
    if (drag.type === 'level' && t.type === 'level') { const r = row.getBoundingClientRect(); return { row, t, mode: e.clientY < r.top + r.height / 2 ? 'before' : 'after' }; }
    if (['device', 'furniture'].includes(drag.type) && ['level', 'room'].includes(t.type)) return { row, t, mode: 'into' };
    if (drag.type === 'room' && t.type === 'level' && t.id !== drag.level) return { row, t, mode: 'into' };
    return null;
  };
  body.addEventListener('dragover', (e) => { const tg = target(e); body.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into')); if (!tg) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tg.row.classList.add(`drop-${tg.mode}`); });
  body.addEventListener('dragend', () => { clear(); drag = null; });
  body.addEventListener('drop', (e) => {
    const tg = target(e); clear(); const d = drag; drag = null; if (!tg) return; e.preventDefault();
    const p = app.plan;
    if (d.type === 'level') { // tree shows the top level first: "before" = above
      app.pushUndo(); const src = levelOf(d.id); p.levels.splice(p.levels.indexOf(src), 1); let j = p.levels.findIndex((l) => l.id === tg.t.id); if (tg.mode === 'before') j += 1; p.levels.splice(j, 0, src);
      restack(p); refreshAll(); app.toast(t('data.tree.levelMoved', { name: src.name })); return;
    }
    if (tg.t.type === 'level') return moveToLevel(d, tg.t.id);
    if (tg.t.type === 'room') { // drop an object into a room: same level → move to the room centre; other level → move level, then centre
      const room = findItem(p, tg.t.id), f = findItem(p, d.id); if (!room || !f) return;
      app.pushUndo();
      if (f.level.id !== room.level.id) { f.list.splice(f.list.indexOf(f.item), 1); (f.type === 'device' ? room.level.devices : room.level.furniture).push(f.item); }
      if (roomAt(room.level, f.item.pos)?.id !== room.item.id) { f.item.pos = roomCenter(room.item).map((v) => Math.round(v * 1000) / 1000); placeItem(room.level, f.type, f.item, wallSegments(room.level)); }
      refreshAll(); ed.select({ type: d.type, id: d.id, level: room.level.id }); app.toast(t('data.tree.movedIntoRoom', { name: room.item.name }));
    }
  });
  // make tree rows draggable and keyboard-focusable after every render
  new MutationObserver(() => body.querySelectorAll('.trow[data-pick]').forEach((r) => { if (DRAGGABLE.has(r.dataset.pick)) r.draggable = true; if (!r.hasAttribute('tabindex')) r.tabIndex = -1; })).observe(body, { childList: true, subtree: true });
}
