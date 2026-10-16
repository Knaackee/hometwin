// Chat with the backend agent. The agent never changes the plan directly: it returns
// operations, which the user reviews here and applies with one click.
import { esc } from './panel.js';
import { KINDS, LIGHT_STYLES } from './devices.js';
import { FURNITURE } from './furniture.js';

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
      app.$('aiModel').textContent = this.info.configured ? this.info.model : 'nicht eingerichtet';
      if (!this.history.length) this.say('bot', this.info.configured
        ? 'Hallo. Sag mir, welchen Raum du einbinden möchtest, z. B. „Ich möchte das Büro einbinden“. Fehlen Maße oder ein Grundriss, frage ich danach. Alle Änderungen bekommst du als Vorschau zum Übernehmen.'
        : 'Der Assistent ist noch nicht eingerichtet. In Home Assistant unter Einstellungen → Geräte & Dienste → HomeTwin → Konfigurieren die Adresse eines OpenAI-kompatiblen Endpunkts, Modell und API-Key eintragen.');
    }
    if (prefill && this.info.configured) this.send(prefill);
    else if (prefill) app.$('aiInput').value = prefill;
  }
  say(role, html, cls = '') { const d = document.createElement('div'); d.className = `msg ${role} ${cls}`; d.innerHTML = html; this.app.$('msgs').appendChild(d); this.app.$('msgs').scrollTop = 1e6; return d; }
  async send(text) {
    if (this.busy) return; const app = this.app; this.busy = true; app.$('aiSend').disabled = true;
    this.say('me', esc(text)); this.history.push({ role: 'user', content: text });
    const wait = this.say('bot', 'Denke nach …');
    try {
      const res = await app.hass.callWS({ type: 'hometwin/agent/chat', messages: this.history.slice(-16), level_id: app.activeLevelId, include_underlay: !!app.$('aiImg').checked && !!app.activeLevel()?.underlay, plan: app.plan });
      wait.remove();
      const ops = res.operations || [];
      const m = this.say('bot', esc(res.reply || (ops.length ? 'Hier ist mein Vorschlag:' : 'Keine Änderungen.')));
      if (ops.length) this.renderOps(m, ops);
      this.history.push({ role: 'assistant', content: (res.reply || '') + (ops.length ? `\n[Vorgeschlagen: ${ops.length} Änderungen – ${ops.map((o) => this.describe(o)).join('; ')}]` : '') });
    } catch (e) { wait.remove(); this.say('bot', esc(`Fehler: ${e.message || e.code || e}`), 'err'); }
    finally { this.busy = false; app.$('aiSend').disabled = false; }
  }
  renderOps(m, ops) {
    const box = document.createElement('div'); box.className = 'ops';
    box.innerHTML = ops.map((o, i) => `<label><input type="checkbox" data-i="${i}" checked> <span>${esc(this.describe(o))}</span></label>`).join('') + '<div class="actions"><button class="btn primary small" data-apply>Übernehmen</button><button class="btn small" data-none>Keine</button></div>';
    m.appendChild(box);
    box.querySelector('[data-none]').onclick = () => box.querySelectorAll('input').forEach((c) => (c.checked = false));
    box.querySelector('[data-apply]').onclick = (e) => {
      const sel = ops.filter((_, i) => box.querySelector(`[data-i="${i}"]`).checked); if (!sel.length) return;
      const res = this.app.apply(sel); const bad = res.filter((r) => !r.ok);
      e.target.disabled = true; e.target.textContent = 'Übernommen'; box.querySelectorAll('input').forEach((c) => (c.disabled = true));
      this.history.push({ role: 'user', content: `[Ich habe ${sel.length - bad.length} der vorgeschlagenen Änderungen übernommen.]` });
      this.say('bot', bad.length ? esc(`${sel.length - bad.length} übernommen, ${bad.length} fehlgeschlagen: ${bad.map((b) => b.error).join(', ')}`) : 'Übernommen. Du kannst alles im Modell noch verschieben.');
    };
  }
  describe(o) {
    const n = (id) => (id ? this.app.nameOf(id) : '');
    const pos = (p) => (p ? `bei ${p[0].toFixed(1)} / ${p[1].toFixed(1)} m` : '');
    switch (o.op) {
      case 'add_level': return `Etage „${o.name}“ anlegen (+${o.elevation} m)`;
      case 'add_room': return `Raum „${o.name}“ anlegen${o.rect ? ` (${(+o.rect[2]).toFixed(2)} × ${(+o.rect[3]).toFixed(2)} m)` : ''}`;
      case 'update_room': return `Raum ändern: ${o.name || o.room_id}`;
      case 'add_opening': return `${{ door: 'Tür', window: 'Fenster', garage: 'Garagentor', open: 'Durchgang' }[o.type] || 'Öffnung'} setzen${o.cover ? ` mit ${n(o.cover)}` : ''}${o.contact ? ` mit Kontakt ${n(o.contact)}` : ''}`;
      case 'update_opening': return `Öffnung verknüpfen: ${[o.cover, o.contact].filter(Boolean).map(n).join(', ') || o.opening_id}`;
      case 'place_device': return `${o.kind === 'light' ? LIGHT_STYLES[o.style] || 'Leuchte' : KINDS[o.kind]?.label || o.kind}${o.entity_id ? ` für ${n(o.entity_id)}` : ''} ${pos(o.pos)}`;
      case 'update_device': return `Gerät ändern${o.entity_id ? `: ${n(o.entity_id)}` : ''}`;
      case 'place_furniture': return `${FURNITURE[o.type]?.label || o.type} ${pos(o.pos)}`;
      case 'move_item': return `Verschieben ${pos(o.pos)}`;
      case 'delete_item': return `Löschen: ${o.item_id}`;
      default: return o.op;
    }
  }
}
