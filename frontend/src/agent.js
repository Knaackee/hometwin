// Chat with the backend agent. The agent never changes the plan directly: it returns
// operations, which the user reviews here and applies with one click.
import { esc } from './panel.js';
import { KINDS, LIGHT_STYLES } from './devices.js';
import { FURNITURE } from './furniture.js';
import { t } from './i18n.js';

export class Agent {
  constructor(app) {
    this.app = app; this.history = []; this.info = null; this.busy = false;
    app.$('tAI').addEventListener('click', () => (app.$('agent').hidden ? this.open() : this.close()));
    app.$('aiClose').addEventListener('click', () => this.close());
    app.$('aiForm').addEventListener('submit', (e) => { e.preventDefault(); const t = app.$('aiInput').value.trim(); if (t) { app.$('aiInput').value = ''; this.send(t); } });
  }
  close() { this.app.$('agent').hidden = true; this.app.$('tAI').setAttribute('aria-pressed', 'false'); }
  async open(prefill, { image = false } = {}) {
    const app = this.app; app.$('agent').hidden = false; app.$('tAI').setAttribute('aria-pressed', 'true');
    app.$('aiImgWrap').hidden = !app.activeLevel()?.underlay; if (image) app.$('aiImg').checked = true;
    if (!this.info) {
      try { this.info = await app.hass.callWS({ type: 'hometwin/agent/info' }); } catch { this.info = { configured: false }; }
      app.$('aiModel').textContent = this.info.configured ? this.info.model : t('assistant.agent.notConfiguredShort');
      if (!this.history.length) this.say('bot', this.info.configured
        ? t('assistant.agent.welcome')
        : t('assistant.agent.setupRequired'));
    }
    if (prefill && this.info.configured) this.send(prefill);
    else if (prefill) app.$('aiInput').value = prefill;
  }
  say(role, html, cls = '') { const d = document.createElement('div'); d.className = `msg ${role} ${cls}`; d.innerHTML = html; this.app.$('msgs').appendChild(d); this.app.$('msgs').scrollTop = 1e6; return d; }
  async send(text) {
    if (this.busy) return; const app = this.app; this.busy = true; app.$('aiSend').disabled = true;
    this.say('me', esc(text)); this.history.push({ role: 'user', content: text });
    const wait = this.say('bot', t('assistant.agent.thinking'));
    try {
      const res = await app.hass.callWS({ type: 'hometwin/agent/chat', messages: this.history.slice(-16), level_id: app.activeLevelId, include_underlay: !!app.$('aiImg').checked && !!app.activeLevel()?.underlay, plan: app.plan });
      wait.remove();
      const ops = res.operations || [];
      const m = this.say('bot', esc(res.reply || t(ops.length ? 'assistant.agent.proposal' : 'assistant.agent.noChanges')));
      if (ops.length) this.renderOps(m, ops);
      this.history.push({ role: 'assistant', content: (res.reply || '') + (ops.length ? `\n${t('assistant.agent.historyProposed', { count: ops.length, changes: ops.map((o) => this.describe(o)).join('; ') })}` : '') });
    } catch (e) { wait.remove(); this.say('bot', esc(t('assistant.agent.error', { error: e.message || e.code || e })), 'err'); }
    finally { this.busy = false; app.$('aiSend').disabled = false; }
  }
  renderOps(m, ops) {
    const box = document.createElement('div'); box.className = 'ops';
    box.innerHTML = ops.map((o, i) => `<label><input type="checkbox" data-i="${i}" checked> <span>${esc(this.describe(o))}</span></label>`).join('') + t('assistant.agent.operationActions');
    m.appendChild(box);
    box.querySelector('[data-none]').onclick = () => box.querySelectorAll('input').forEach((c) => (c.checked = false));
    box.querySelector('[data-apply]').onclick = (e) => {
      const sel = ops.filter((_, i) => box.querySelector(`[data-i="${i}"]`).checked); if (!sel.length) return;
      const res = this.app.apply(sel); const bad = res.filter((r) => !r.ok);
      e.target.disabled = true; e.target.textContent = t('assistant.agent.applied'); box.querySelectorAll('input').forEach((c) => (c.disabled = true));
      this.history.push({ role: 'user', content: t('assistant.agent.historyApplied', { count: sel.length - bad.length }) });
      this.say('bot', bad.length ? esc(t('assistant.agent.applyFailed', { applied: sel.length - bad.length, failed: bad.length, errors: bad.map((b) => b.error).join(', ') })) : t('assistant.agent.applySuccess'));
    };
  }
  describe(o) {
    const n = (id) => (id ? this.app.nameOf(id) : '');
    const pos = (p) => (p ? t('assistant.agent.position', { x: p[0].toFixed(1), z: p[1].toFixed(1) }) : '');
    const openingType = ['door', 'window', 'garage', 'open'].includes(o.type) ? o.type : 'opening';
    switch (o.op) {
      case 'add_level': return t('assistant.agent.opAddLevel', { name: o.name, elevation: o.elevation });
      case 'add_room': return t(o.rect ? 'assistant.agent.opAddRoomSized' : 'assistant.agent.opAddRoom', { name: o.name, width: o.rect ? (+o.rect[2]).toFixed(2) : '', depth: o.rect ? (+o.rect[3]).toFixed(2) : '' });
      case 'update_room': return t('assistant.agent.opUpdateRoom', { name: o.name || o.room_id });
      case 'add_opening': return t('assistant.agent.opAddOpening', { type: t(`assistant.agent.opening.${openingType}`), cover: o.cover ? t('assistant.agent.withEntity', { name: n(o.cover) }) : '', contact: o.contact ? t('assistant.agent.withContact', { name: n(o.contact) }) : '' });
      case 'update_opening': return t('assistant.agent.opUpdateOpening', { name: [o.cover, o.contact].filter(Boolean).map(n).join(', ') || o.opening_id });
      case 'place_device': return t('assistant.agent.opPlaceDevice', { kind: o.kind === 'light' ? LIGHT_STYLES[o.style] || t('assistant.agent.light') : KINDS[o.kind]?.label || o.kind, entity: o.entity_id ? t('assistant.agent.forEntity', { name: n(o.entity_id) }) : '', position: pos(o.pos) });
      case 'update_device': return t('assistant.agent.opUpdateDevice', { entity: o.entity_id ? t('assistant.agent.namedSuffix', { name: n(o.entity_id) }) : '' });
      case 'place_furniture': return t('assistant.agent.opPlaceFurniture', { kind: FURNITURE[o.type]?.label || o.type, position: pos(o.pos) });
      case 'move_item': return t('assistant.agent.opMoveItem', { position: pos(o.pos) });
      case 'delete_item': return t('assistant.agent.opDeleteItem', { id: o.item_id });
      default: return o.op;
    }
  }
}
