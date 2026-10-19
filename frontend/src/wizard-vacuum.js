import { ROBOT_PREVIEW_ENABLED } from './features.js';
// Robot maps reuse the wizard; updates are opt-in room geometry edits, never replacements.
import { esc } from './panel.js';
import { t } from './i18n.js';
import { applyOps, newId } from './plan.js';

export const vacuumHints = 'This is a robot vacuum cleaning map, not an architectural drawing. Identify only supported room boundaries. Ignore cleaning tracks, robot/dock icons, furniture obstacles and no-go zones. Unmapped areas are unknown, not walls. Do not invent windows, doors, stairs, roof or storey heights. Use only the supplied measured scale. Return empty openings and stairs and no level or roof metadata.';

export function vacuumSourceHtml(w) {
  if (!ROBOT_PREVIEW_ENABLED) return "";
  const s = w.st, saved = w.app.plan.levels.find(l => l.id === s.levelId)?.underlay?.vacuum;
  return `<fieldset><legend>${t('assistant.vacuum.title')}</legend>
    <label class="chk"><input id="wzVacuum" type="checkbox" ${s.vacuum ? 'checked' : ''}>${t('assistant.vacuum.imageMode')}</label>
    <p class="hint">${t('assistant.vacuum.hint')}</p>
    <button class="btn small" data-vacuum="list" ${s.mapLoading ? 'disabled' : ''}>${t('assistant.vacuum.choose')}</button>
    ${saved ? `<button class="btn small" data-vacuum="refresh" ${s.mapLoading ? 'disabled' : ''}>${t('assistant.vacuum.refresh')}</button>` : ''}
    ${s.mapSources ? `<div class="field"><label for="wzMapEntity">${t('assistant.vacuum.source')}</label><select id="wzMapEntity">${s.mapSources.map(m => `<option value="${esc(m.entity_id)}">${esc(m.name)} (${esc(m.entity_id)})</option>`).join('')}</select><button class="btn small" data-vacuum="load" ${s.mapSources.length && !s.mapLoading ? '' : 'disabled'}>${t('assistant.vacuum.load')}</button></div>${!s.mapSources.length ? `<p class="hint">${t('assistant.vacuum.noMaps')}</p>` : ''}` : ''}
    ${s.mapError ? `<p class="warn" role="alert">${esc(s.mapError)}</p>` : ''}</fieldset>`;
}

export function wireVacuumSource(w) {
  if (!ROBOT_PREVIEW_ENABLED) return;
  const s = w.st, R = w.root;
  R.querySelector('#wzVacuum').onchange = e => { s.vacuum = e.target.checked; s.mapEntity = null; s.result = null; w.render(); };
  R.querySelector('[data-vacuum="list"]').onclick = async () => {
    s.mapLoading = true; s.mapError = null; w.render();
    try { const result = await w.app.hass.callWS({ type: 'hometwin/vacuum/maps' }); if (w.st !== s || w.root.hidden) return; s.mapSources = result.maps; }
    catch { s.mapError = t('assistant.vacuum.sourceError'); }
    finally { s.mapLoading = false; if (w.st === s && !w.root.hidden) w.render(); }
  };
  R.querySelector('[data-vacuum="load"]')?.addEventListener('click', () => loadVacuumMap(w, R.querySelector('#wzMapEntity').value));
  R.querySelector('[data-vacuum="refresh"]')?.addEventListener('click', () => {
    const level = w.app.plan.levels.find(l => l.id === s.levelId);
    if (level.underlay.vacuum.entity_id) loadVacuumMap(w, level.underlay.vacuum.entity_id);
    else { s.vacuum = true; w.render(); w.msg(t('assistant.vacuum.uploadAgain')); }
  });
}

export async function loadVacuumMap(w, entityId) {
  const s = w.st; s.mapLoading = true; s.mapError = null; w.render();
  try {
    const result = await w.app.hass.callWS({ type: 'hometwin/vacuum/map', entity_id: entityId });
    if (w.st !== s || w.root.hidden) return;
    const response = await fetch(result.image);
    if (!await w.loadFile(await response.blob(), entityId)) throw new Error('Invalid map image');
    if (w.st !== s || w.root.hidden) return;
    s.vacuum = true; s.mapEntity = entityId;
  } catch { s.mapError = t('assistant.vacuum.loadError'); }
  finally { s.mapLoading = false; if (w.st === s && !w.root.hidden) w.render(); }
}

export function prepareVacuumReview(w) {
  const s = w.st, level = w.app.plan.levels.find(l => l.id === s.levelId);
  s.mapChoices = {}; s.mapOffset = [level?.underlay?.x0 || 0, level?.underlay?.z0 || 0];
  s.mapBaseline = JSON.stringify(level || null);
  s.result.openings = []; s.result.stairs = []; s.result.level = null; s.result.roof = null;
  for (const r of s.result.rooms) s.mapChoices[r.id] = level?.rooms.length ? '' : '__add';
}

export function vacuumReviewHtml(w) {
  const s = w.st, level = w.app.plan.levels.find(l => l.id === s.levelId);
  return `<fieldset class="wz-apply"><legend>${t('assistant.vacuum.review')}</legend><p class="hint">${t('assistant.vacuum.preserve')}</p>
    <div class="row2">${['x', 'z'].map((axis, i) => `<div class="field"><label for="wzMapOffset${i}">${t('assistant.vacuum.offset', { axis })}</label><input id="wzMapOffset${i}" type="number" step="0.05" value="${s.mapOffset[i]}"></div>`).join('')}</div>
    ${s.result.rooms.map(r => `<div class="field"><label for="wzMapRoom-${esc(r.id)}">${esc(r.name)}</label><select id="wzMapRoom-${esc(r.id)}" data-map-room="${esc(r.id)}"><option value="">${t('assistant.vacuum.ignore')}</option><option value="__add" ${s.mapChoices[r.id] === '__add' ? 'selected' : ''}>${t('assistant.vacuum.add')}</option>${(level?.rooms || []).map(old => `<option value="${esc(old.id)}" ${s.mapChoices[r.id] === old.id ? 'selected' : ''}>${t('assistant.vacuum.update', { name: esc(old.name) })}</option>`).join('')}</select></div>`).join('')}
    <p class="hint">${t('assistant.vacuum.alignment')}</p></fieldset>`;
}

export function wireVacuumReview(w) {
  for (const input of w.root.querySelectorAll('[data-map-room]')) input.onchange = () => { w.st.mapChoices[input.dataset.mapRoom] = input.value; };
  for (let i = 0; i < 2; i++) w.root.querySelector(`#wzMapOffset${i}`).oninput = e => { w.st.mapOffset[i] = e.target.value === '' ? NaN : Number(e.target.value); w.view?.draw(); };
}

export function drawExistingMapRooms(w, g, view) {
  const s = w.st, level = w.app.plan.levels.find(l => l.id === s.levelId);
  if (!s.mapOffset?.every(Number.isFinite)) return;
  g.save(); g.strokeStyle = '#ffb35c'; g.lineWidth = 2; g.setLineDash([6, 4]);
  for (const room of level?.rooms || []) {
    g.beginPath(); room.points.forEach((p, i) => { const q = view.toScr([(p[0] - s.mapOffset[0]) / s.mpp, (p[1] - s.mapOffset[1]) / s.mpp]); i ? g.lineTo(...q) : g.moveTo(...q); }); g.closePath(); g.stroke();
  }
  g.restore();
}

// Pure operation builder: no name matching, deletion or implicit replacement on refresh.
export function vacuumRoomOps(level, rooms, choices, offset) {
  if (!offset?.every(Number.isFinite)) throw new Error(t('assistant.vacuum.invalidOffset'));
  const used = new Set(), ops = [];
  for (const r of rooms) {
    const choice = choices[r.id]; if (!choice) continue;
    if (!r.points || r.points.length < 3 || r.points.some(p => p.length !== 2 || !p.every(Number.isFinite))) throw new Error(t('assistant.vacuum.invalidRoom'));
    const points = r.points.map(p => p.map((v, i) => Math.round((v + offset[i]) * 1000) / 1000));
    if (choice === '__add') ops.push({ op: 'add_room', level_id: level.id, name: r.name, kind: ['room', 'garage', 'outdoor'].includes(r.kind) ? r.kind : 'room', points });
    else {
      if (used.has(choice) || !level.rooms.some(old => old.id === choice)) throw new Error(t('assistant.vacuum.duplicate'));
      used.add(choice); ops.push({ op: 'update_room', room_id: choice, points });
    }
  }
  return ops;
}

export async function applyVacuum(w) {
  const s = w.st, app = w.app;
  if (s.mapApplying) return;
  s.mapApplying = true;
  for (const control of w.root.querySelectorAll('input, select, textarea, button:not([data-wz="close"])')) control.disabled = true;
  try {
    if (!(s.mpp > 0) || !Number.isFinite(s.mpp)) throw new Error(t('assistant.vacuum.measure'));
    const existing = app.plan.levels.find(l => l.id === s.levelId);
    if (JSON.stringify(existing || null) !== s.mapBaseline) throw new Error(t('assistant.vacuum.changed'));
    const id = existing?.id || newId('l'), level = existing || { id, rooms: [] };
    const ops = vacuumRoomOps(level, s.result.rooms, s.mapChoices, s.mapOffset);
    if (!existing) { const fit = w.levelFit(); ops.unshift({ op: 'add_level', id, name: s.newLevel || t('assistant.wizard.defaultNewLevel'), elevation: fit.elevation, height: fit.height, slab: fit.slab, autoElevation: fit.autoElevation }); }
    const draft = structuredClone(app.plan);
    if (applyOps(draft, ops).some(r => !r.ok)) throw new Error(t('assistant.vacuum.invalidRoom'));
    // Save the image under a fresh key: failed uploads and Undo retain the old template.
    const imageId = newId('map'), image = s.img;
    const blob = await new Promise(resolve => image.toBlob(resolve, 'image/jpeg', 0.88));
    const response = await app.hass.fetchWithAuth(`/api/hometwin/underlay/${imageId}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
    if (!response.ok) throw new Error(t('assistant.wizard.imageSaveFailed', { status: response.status }));
    const current = app.plan.levels.find(l => l.id === s.levelId);
    if (w.st !== s || w.root.hidden) return;
    if (JSON.stringify(current || null) !== s.mapBaseline) throw new Error(t('assistant.vacuum.changed'));
    const bitmap = await createImageBitmap(image);
    if (w.st !== s || w.root.hidden) { bitmap.close(); return; }
    if (JSON.stringify(app.plan.levels.find(l => l.id === s.levelId) || null) !== s.mapBaseline) { bitmap.close(); throw new Error(t('assistant.vacuum.changed')); }
    app.pushUndo(); app.apply(ops, { undo: false, settle: false });
    const target = app.plan.levels.find(l => l.id === id);
    target.underlay = { x0: s.mapOffset[0], z0: s.mapOffset[1], mpp: s.mpp, wpx: image.width, hpx: image.height, opacity: existing?.underlay?.opacity ?? 0.5, v: Date.now(), imageId, vacuum: { entity_id: s.mapEntity || null } };
    app.editor.images.set(imageId, bitmap); app.stage.setUnderlay(id, bitmap);
    app.markDirty({ settle: false }); app.setLevel(id); w.close(); app.setMode('edit'); app.editor.select({ type: 'level', id }); app.toast(t('assistant.vacuum.applied'));
  } catch (e) { s.err = e.message || String(e); }
  finally { s.mapApplying = false; if (w.st === s && !w.root.hidden) w.render(); }
}
