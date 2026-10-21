import { t, formatNumber } from './i18n.js';
import { collectRoomEntities } from './room-controls-data.js';
import { area as polygonArea } from './geometry.js';
import { icon } from './icons.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const usableRoom = room => room?.kind !== 'void'
  && !(room?.kind === 'outdoor' && polygonArea(room.points || []) > 60);
const entityDomain = id => String(id || '').split('.')[0];
const ready = state => state && !['unknown', 'unavailable'].includes(state.state);
const iconMarkup = (haIcon, fallback) => typeof customElements !== 'undefined' && customElements.get('ha-icon')
  ? `<ha-icon icon="${esc(haIcon)}" aria-hidden="true"></ha-icon>`
  : `<span class="room-picker-fallback-icon" aria-hidden="true">${icon(fallback)}</span>`;

function areaForRoom(app, room) {
  const id = room?.area_id || room?.area;
  const areas = app?._hass?.areas || app?.hass?.areas || {};
  if (!id) return null;
  if (areas[id]) return areas[id];
  return Object.values(areas).find(area => area?.area_id === id || area?.id === id) || null;
}

function roomRecords(app) {
  return (app?.plan?.levels || []).flatMap(level => (level.rooms || [])
    .filter(usableRoom)
    .map(room => ({ room, level, area: areaForRoom(app, room) })));
}

/** Pure picker model, exported for lightweight tests. */
export function roomPickerRooms(app, query = '') {
  const needle = String(query).trim().toLocaleLowerCase();
  const records = roomRecords(app);
  const activeLevel = !['all', 'roof'].includes(app?.levelSel)
    ? app.levelSel
    : app?.activeLevelId;
  const scope = app?.levelSel === 'all' || app?.levelSel === 'roof'
    ? records
    : records.filter(record => record.level.id === activeLevel);
  return scope.filter(({ room, level, area }) => !needle || [room.name, level.name, area?.name]
    .some(value => String(value || '').toLocaleLowerCase().includes(needle)));
}

/** At most two concise live statuses for a room. */
export function roomPickerSummary(app, roomId, entities = collectRoomEntities(app)) {
  const states = typeof app?.states === 'function' ? app.states() : (app?._hass?.states || app?.hass?.states || {});
  const seen = new Set();
  const roomEntities = entities.filter(entity => entity?.room === roomId && entity.id && !seen.has(entity.id) && seen.add(entity.id));
  const lights = roomEntities.filter(entity => entityDomain(entity.id) === 'light' && ready(states[entity.id]));
  const contacts = roomEntities.filter(entity => entityDomain(entity.id) === 'binary_sensor'
    && ['door', 'window', 'opening'].includes(states[entity.id]?.attributes?.device_class)
    && ready(states[entity.id]));
  const temperatures = roomEntities.map(entity => states[entity.id]).filter(state => ready(state)
    && state.attributes?.device_class === 'temperature' && Number.isFinite(Number(state.state)));
  const summaries = [];
  const lightsOn = lights.filter(entity => states[entity.id].state === 'on').length;
  const contactsOpen = contacts.filter(entity => states[entity.id].state === 'on').length;
  if (lights.length) summaries.push(lightsOn ? t('panel.roomPicker.lightsOn', { count: lightsOn }) : t('panel.roomPicker.lightsOff'));
  if (contactsOpen) summaries.push(t('panel.roomPicker.contactsOpen', { count: contactsOpen }));
  if (summaries.length < 2 && temperatures.length) {
    const unit = temperatures[0].attributes.unit_of_measurement || '';
    const compatible = temperatures.filter(state => (state.attributes.unit_of_measurement || '') === unit);
    const average = compatible.reduce((sum, state) => sum + Number(state.state), 0) / compatible.length;
    summaries.push(t('panel.roomPicker.temperature', {
      value: `${formatNumber(average, { maximumFractionDigits: 1 })}${unit}`,
    }));
  }
  return summaries.slice(0, 2);
}

function groupRooms(records) {
  const groups = [];
  for (const record of records) {
    let group = groups.find(candidate => candidate.level.id === record.level.id);
    if (!group) { group = { level: record.level, records: [] }; groups.push(group); }
    group.records.push(record);
  }
  return groups;
}

export class RoomPicker {
  constructor(app, container) {
    this.app = app;
    this.query = '';
    this.open = false;
    this._onDocumentPointerDown = event => {
      if (this.open && !event.composedPath().includes(this.root)) this.close();
    };
    if (container) this.mount(container);
  }

  mount(container) {
    if (this.root) return this.root;
    this.root = document.createElement('div');
    this.root.className = 'room-picker view-only';
    this.root.innerHTML = `
      <button type="button" class="room-picker-trigger" aria-haspopup="dialog" aria-expanded="false">
        <span class="room-picker-trigger-icon" aria-hidden="true"></span>
        <span class="room-picker-trigger-label"></span>
        <span class="room-picker-chevron" aria-hidden="true">${icon('chevronDown')}</span>
      </button>
      <div class="room-picker-popover" role="dialog" aria-modal="false" hidden>
        <div class="room-picker-sheet-grip" aria-hidden="true"></div>
        <div class="room-picker-search-wrap">
          ${iconMarkup('mdi:magnify', 'search')}
          <input class="room-picker-search" type="search" autocomplete="off">
          <button type="button" class="room-picker-close" aria-label="${esc(t('panel.close'))}">×</button>
        </div>
        <div class="room-picker-list" role="listbox" tabindex="-1"></div>
      </div>`;
    container.append(this.root);
    this.trigger = this.root.querySelector('.room-picker-trigger');
    this.popover = this.root.querySelector('.room-picker-popover');
    this.search = this.root.querySelector('.room-picker-search');
    this.list = this.root.querySelector('.room-picker-list');
    this.closeButton = this.root.querySelector('.room-picker-close');
    this.trigger.addEventListener('click', () => this.open ? this.close() : this.show());
    this.trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'Enter', ' '].includes(event.key)) { event.preventDefault(); this.show(true); }
    });
    this.closeButton.addEventListener('click', () => this.close({ returnFocus: true }));
    this.search.addEventListener('input', () => { this.query = this.search.value; this.renderList(); });
    this.root.addEventListener('keydown', event => this.onKeyDown(event));
    this.list.addEventListener('click', event => {
      const option = event.target.closest('[data-room-option]');
      if (option) this.select(option.dataset.roomOption, option.dataset.level || null);
    });
    document.addEventListener('pointerdown', this._onDocumentPointerDown, true);
    this.render();
    return this.root;
  }

  show(focusFirst = false) {
    if (!this.root) return;
    if (this.app.stage?.walk) {
      this.app.stage.walk.keys.clear();
      this.app.stage.walk.joy = [0, 0];
      const knob = this.app.$?.('joy')?.querySelector('i');
      if (knob) knob.style.transform = '';
    }
    this.open = true;
    this.popover.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.renderList();
    if (focusFirst) this.options()[0]?.focus(); else this.search.focus();
  }

  close({ returnFocus = false } = {}) {
    if (!this.root) return;
    this.open = false;
    this.popover.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) this.trigger.focus();
  }

  select(roomId, levelId) {
    this.close();
    if (roomId) {
      this.app.setFocus(roomId, levelId);
      this.app.setSheet('half');
    } else {
      // setFocus(null) intentionally retains the currently chosen storey.
      this.app.setFocus(null);
    }
    this.render();
    this.trigger.focus();
  }

  render() {
    if (!this.root) return;
    const selected = roomRecords(this.app).find(record => record.room.id === this.app.focusRoom);
    const label = selected?.room.name || t('panel.allRooms');
    const areaIcon = selected?.area?.icon || 'mdi:floor-plan';
    this.trigger.querySelector('.room-picker-trigger-label').textContent = label;
    this.trigger.setAttribute('aria-label', `${t('panel.pickRoom')}: ${label}`);
    const triggerIcon = this.trigger.querySelector('.room-picker-trigger-icon');
    triggerIcon.innerHTML = selected?.area?.icon ? iconMarkup(areaIcon, 'floorplan') : icon('floorplan');
    const haIcon = triggerIcon.querySelector('ha-icon');
    if (haIcon) haIcon.icon = areaIcon;
    this.search.placeholder = t('panel.roomPicker.search');
    this.search.setAttribute('aria-label', t('panel.roomPicker.search'));
    this.popover.setAttribute('aria-label', t('panel.pickRoom'));
    this.list.setAttribute('aria-label', t('panel.pickRoom'));
    this.closeButton.setAttribute('aria-label', t('panel.close'));
    if (this.open) this.renderList();
  }

  renderList() {
    if (!this.list) return;
    const focusedKey = this.root.getRootNode().activeElement?.dataset?.roomOption;
    const entities = collectRoomEntities(this.app);
    const records = roomPickerRooms(this.app, this.query);
    const wholeHouse = this.query || ['all', 'roof'].includes(this.app.levelSel);
    let html = `<button type="button" role="option" data-room-option="" aria-selected="${!this.app.focusRoom}">
      <span class="room-picker-option-icon">${icon('floorplan')}</span>
      <span class="room-picker-option-copy"><strong>${esc(t('panel.allRooms'))}</strong><small>${esc(t('panel.roomPicker.keepFloor'))}</small></span>
    </button>`;
    if (records.length) {
      for (const { level, records: rooms } of groupRooms(records)) {
        html += `<div class="room-picker-group" role="group" aria-label="${esc(level.name)}">
          <div class="room-picker-group-label">${esc(wholeHouse ? level.name : t('panel.roomPicker.activeFloor', { floor: level.name }))}</div>`;
        for (const { room, area } of rooms) {
          const summaries = roomPickerSummary(this.app, room.id, entities);
          const areaIcon = area?.icon || 'mdi:floor-plan';
          html += `<button type="button" role="option" data-room-option="${esc(room.id)}" data-level="${esc(level.id)}" aria-selected="${this.app.focusRoom === room.id}">
            <span class="room-picker-option-icon">${area?.icon ? iconMarkup(areaIcon, 'floorplan') : icon('floorplan')}</span>
            <span class="room-picker-option-copy"><strong>${esc(room.name)}</strong>${summaries.length ? `<small>${summaries.map(esc).join(' · ')}</small>` : ''}</span>
          </button>`;
        }
        html += '</div>';
      }
    } else html += `<p class="room-picker-empty">${esc(t('panel.roomPicker.noResults'))}</p>`;
    if (this._listHTML === html) return;
    const scrollTop = this.list.scrollTop;
    this.list.innerHTML = html;
    this._listHTML = html;
    for (const haIcon of this.list.querySelectorAll('ha-icon[icon]')) haIcon.icon = haIcon.getAttribute('icon');
    this.list.scrollTop = scrollTop;
    if (focusedKey != null) this.options().find(option => option.dataset.roomOption === focusedKey)?.focus();
  }

  options() { return [...this.list.querySelectorAll('[data-room-option]')]; }

  onKeyDown(event) {
    // Keep editor shortcuts and walkthrough movement from firing behind the dialog.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close({ returnFocus: true }); return; }
    if (!this.open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = this.options();
    if (!options.length) return;
    const current = options.indexOf(event.target.closest?.('[data-room-option]'));
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : event.key === 'ArrowDown' ? Math.min(options.length - 1, current + 1)
        : current < 0 ? options.length - 1 : Math.max(0, current - 1);
    options[index].focus();
  }

  destroy() {
    document.removeEventListener('pointerdown', this._onDocumentPointerDown, true);
    this.root?.remove();
    this.root = this.trigger = this.popover = this.search = this.list = this.closeButton = null;
    this._listHTML = null;
  }
}

export const ROOM_PICKER_CSS = `
.home-navigation{display:flex;align-items:center;gap:8px;min-width:0}.home-navigation #levels{flex:0 1 auto;min-width:0}.navigation-divider{width:1px;height:24px;flex:none;background:var(--line)}
.room-picker{position:relative;min-width:0}.room-picker-trigger{height:36px;max-width:230px;display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--fg);font:inherit;cursor:pointer}.room-picker-trigger:hover,.room-picker-trigger:focus-visible{border-color:var(--edit);outline:none}.room-picker-trigger-icon,.room-picker-option-icon{display:grid;place-items:center;flex:0 0 auto;color:var(--muted)}.room-picker-trigger ha-icon,.room-picker-option-icon ha-icon,.room-picker-search-wrap ha-icon,.room-picker-fallback-icon,.room-picker-fallback-icon svg{width:20px;height:20px}.room-picker-fallback-icon{display:grid;place-items:center}.room-picker-trigger-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.room-picker-chevron{margin-left:auto;color:var(--muted)}
.room-picker-popover{position:absolute;z-index:80;top:calc(100% + 8px);right:0;width:min(360px,calc(100vw - 24px));max-height:min(560px,70vh);overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--panel-solid);color:var(--fg);box-shadow:0 18px 50px #0006}.room-picker-popover[hidden]{display:none}.room-picker-sheet-grip{display:none}.room-picker-search-wrap{display:flex;align-items:center;gap:8px;margin:10px;padding:0 6px 0 10px;border:1px solid var(--line);border-radius:10px}.room-picker-search-wrap:focus-within{border-color:var(--edit)}.room-picker-search{min-width:0;flex:1;height:38px;border:0;outline:0;background:transparent;color:inherit;font:inherit}.room-picker-close{width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--muted);font:24px/1 inherit;cursor:pointer}.room-picker-close:hover,.room-picker-close:focus-visible{background:var(--line-soft);color:var(--fg);outline:none}.room-picker-list{max-height:min(490px,calc(70vh - 64px));overflow:auto;padding:0 8px 10px;outline:none}.room-picker-list [data-room-option]{width:100%;min-height:52px;display:flex;align-items:flex-start;gap:11px;padding:10px 10px;border:0;border-radius:10px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}.room-picker-list [data-room-option]:hover,.room-picker-list [data-room-option]:focus-visible{background:var(--line-soft);outline:none}.room-picker-list [data-room-option][aria-selected="true"]{background:var(--edit-soft)}.room-picker-option-copy{min-width:0;display:flex;flex:1;flex-direction:column;gap:2px}.room-picker-option-copy strong{line-height:20px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.room-picker-option-copy small{line-height:16px;display:block;color:var(--muted);font-size:11px}.room-picker-group-label{padding:12px 10px 5px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.room-picker-empty{padding:20px 12px;color:var(--muted);text-align:center}
@media(max-width:700px){.home-navigation{order:10;flex:1 0 100%;justify-content:center}.room-picker{position:static;min-width:0}.room-picker-trigger{max-width:min(46vw,210px)}.room-picker-popover{position:fixed;z-index:130;inset:auto 0 0;width:auto;max-height:min(72vh,620px);border-width:1px 0 0;border-radius:18px 18px 0 0;padding-bottom:env(safe-area-inset-bottom);box-shadow:0 -18px 50px #0008}.room-picker-sheet-grip{display:block;width:42px;height:4px;margin:8px auto 2px;border-radius:4px;background:var(--line)}.room-picker-list{max-height:calc(min(72vh,620px) - 72px)}.room-picker-list [data-room-option]{min-height:56px}}

.room-picker-trigger-icon,.room-picker-option-icon{width:18px;height:18px;--mdc-icon-size:18px;--iron-icon-height:18px;--iron-icon-width:18px}
.room-picker-trigger-icon svg,.room-picker-option-icon svg,.room-picker-trigger-icon ha-icon,.room-picker-option-icon ha-icon,.room-picker-fallback-icon,.room-picker-fallback-icon svg{width:18px;height:18px}
.room-picker-option-icon{align-self:flex-start;margin-top:1px;line-height:0}.room-picker-option-icon svg,.room-picker-option-icon ha-icon{display:block}
.room-picker-chevron{display:flex;align-items:center}.room-picker-chevron svg{width:12px;height:12px}
`;
