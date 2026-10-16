// A simulated Home Assistant for the standalone demo: states, services, websocket
// commands of the HomeTwin backend and a scripted stand-in for the agent.
import { usedEntities, roomOfOpening } from './plan.js';
import { bbox, r3 } from './geometry.js';

const AREAS = { wohnzimmer: 'Wohnzimmer', kueche: 'Küche', flur: 'Flur', buero: 'Büro', garage: 'Garage', garten: 'Garten', schlafzimmer: 'Schlafzimmer', bad: 'Bad', kinderzimmer: 'Kinderzimmer Mia', kinderzimmer_2: 'Kinderzimmer Ben' };
const FLOORS = { erdgeschoss: ['Erdgeschoss', 0], obergeschoss: ['Obergeschoss', 1] };
const L = (id, name, area, on, b, k, extra = {}) => [id, on ? 'on' : 'off', { friendly_name: name, area, brightness: b, color_temp_kelvin: k, supported_color_modes: ['color_temp', 'rgb'], ...extra }];
const DEF = [
  L('light.wohnzimmer_decke', 'Deckenspots', 'wohnzimmer', true, 140, 3000), L('light.wohnzimmer_stehlampe', 'Bogenlampe', 'wohnzimmer', true, 220, 2400), L('light.esstisch', 'Esstisch', 'wohnzimmer', true, 230, 2700),
  L('light.kueche_spots', 'Strahler', 'kueche', false, 255, 4000), L('light.kueche_led', 'LED Arbeitsplatte', 'kueche', true, 200, null, { rgb_color: [255, 150, 70], color_mode: 'rgb' }),
  L('light.flur_decke', 'Flurlicht', 'flur', false, 200, 3500), L('light.diele', 'Diele', 'flur', true, 120, 2700), L('light.garage', 'Garagenlicht', 'garage', false, 255, 5000),
  L('light.aussen_haustuer', 'Haustürleuchte', 'garten', true, 160, 2700), L('light.gartenweg', 'Wegeleuchten', 'garten', true, 180, 2700),
  L('light.schlafzimmer_decke', 'Deckenlicht', 'schlafzimmer', false, 180, 3000), L('light.nachttisch_links', 'Leselicht links', 'schlafzimmer', true, 90, 2200), L('light.nachttisch_rechts', 'Leselicht rechts', 'schlafzimmer', false, 90, 2200),
  L('light.bad_spiegel', 'Spiegel', 'bad', true, 255, 5000), L('light.kind1', 'Deckenlicht', 'kinderzimmer', true, 160, 3500), L('light.kind2', 'Deckenlicht', 'kinderzimmer_2', false, 180, 3500), L('light.flur_og', 'Flur oben', 'flur', false, 150, 3000),
  L('light.buero_decke', 'Deckenlicht', 'buero', false, 220, 4200), L('light.buero_schreibtisch', 'Schreibtischlampe', 'buero', true, 200, 3800),
  ['cover.wohnzimmer_west', 'open', { friendly_name: 'Raffstore West', area: 'wohnzimmer', current_position: 100 }], ['cover.wohnzimmer_sued', 'open', { friendly_name: 'Rollladen Terrasse', area: 'wohnzimmer', current_position: 60 }],
  ['cover.wohnzimmer_nord', 'open', { friendly_name: 'Rollladen Nord', area: 'wohnzimmer', current_position: 100 }], ['cover.kueche', 'open', { friendly_name: 'Rollladen', area: 'kueche', current_position: 100 }],
  ['cover.schlafzimmer', 'closed', { friendly_name: 'Rollladen', area: 'schlafzimmer', current_position: 0 }], ['cover.kind1', 'open', { friendly_name: 'Rollladen', area: 'kinderzimmer', current_position: 40 }],
  ['cover.kind2', 'open', { friendly_name: 'Rollladen', area: 'kinderzimmer_2', current_position: 100 }], ['cover.buero', 'open', { friendly_name: 'Rollladen', area: 'buero', current_position: 100 }],
  ['cover.dachfenster', 'open', { friendly_name: 'Rollo Dachfenster', area: 'kinderzimmer', current_position: 100 }], ['binary_sensor.dachfenster', 'off', { friendly_name: 'Dachfenster', area: 'kinderzimmer', device_class: 'window' }],
  ['cover.garagentor', 'closed', { friendly_name: 'Garagentor', area: 'garage', current_position: 0, device_class: 'garage' }],
  ['binary_sensor.haustuer', 'off', { friendly_name: 'Haustür', area: 'flur', device_class: 'door' }], ['binary_sensor.terrassentuer', 'off', { friendly_name: 'Terrassentür', area: 'wohnzimmer', device_class: 'door' }],
  ['binary_sensor.bad_fenster', 'on', { friendly_name: 'Fenster', area: 'bad', device_class: 'window' }], ['binary_sensor.buero_fenster', 'off', { friendly_name: 'Fenster', area: 'buero', device_class: 'window' }],
  ['binary_sensor.bewegung_flur', 'off', { friendly_name: 'Bewegung', area: 'flur', device_class: 'motion' }], ['binary_sensor.bewegung_wohnzimmer', 'on', { friendly_name: 'Bewegung', area: 'wohnzimmer', device_class: 'motion' }],
  ['binary_sensor.rauchmelder_flur', 'off', { friendly_name: 'Rauchmelder', area: 'flur', device_class: 'smoke' }], ['binary_sensor.rauchmelder_og', 'off', { friendly_name: 'Rauchmelder OG', area: 'flur', device_class: 'smoke' }],
  ['sensor.wohnzimmer_temperatur', '21.4', { friendly_name: 'Temperatur', area: 'wohnzimmer', device_class: 'temperature', unit_of_measurement: '°C' }], ['sensor.schlafzimmer_temperatur', '18.2', { friendly_name: 'Temperatur', area: 'schlafzimmer', device_class: 'temperature', unit_of_measurement: '°C' }],
  ['sensor.buero_temperatur', '19.6', { friendly_name: 'Temperatur', area: 'buero', device_class: 'temperature', unit_of_measurement: '°C' }],
  ['climate.wohnzimmer', 'heat', { friendly_name: 'Fußbodenkonvektor', area: 'wohnzimmer', current_temperature: 21.4, temperature: 22, hvac_action: 'heating', hvac_modes: ['off', 'heat'] }],
  ['climate.schlafzimmer', 'heat', { friendly_name: 'Heizung', area: 'schlafzimmer', current_temperature: 18.2, temperature: 18, hvac_action: 'idle', hvac_modes: ['off', 'heat'] }],
  ['climate.bad', 'heat', { friendly_name: 'Handtuchheizkörper', area: 'bad', current_temperature: 23.4, temperature: 24, hvac_action: 'heating', hvac_modes: ['off', 'heat'] }],
  ['climate.schlafzimmer_klima', 'off', { friendly_name: 'Klimagerät', area: 'schlafzimmer', current_temperature: 18.2, temperature: 21, hvac_action: 'off', hvac_modes: ['off', 'cool', 'heat', 'fan_only'] }],
  ['climate.buero', 'heat', { friendly_name: 'Heizung', area: 'buero', current_temperature: 19.6, temperature: 21, hvac_action: 'heating', hvac_modes: ['off', 'heat'] }],
  ['fan.kind2', 'off', { friendly_name: 'Deckenventilator', area: 'kinderzimmer_2', percentage: 0 }],
  ['media_player.wohnzimmer_tv', 'playing', { friendly_name: 'Fernseher', area: 'wohnzimmer', device_class: 'tv', media_title: 'Tagesschau', volume_level: 0.3 }],
  ['media_player.kueche', 'paused', { friendly_name: 'Lautsprecher', area: 'kueche', media_title: 'Bayern 3', volume_level: 0.4 }],
  ['vacuum.roby', 'docked', { friendly_name: 'Saugroboter', area: 'wohnzimmer', battery_level: 88 }], ['lawn_mower.rasenmaeher', 'docked', { friendly_name: 'Mähroboter', area: 'garten' }],
  ['valve.bewaesserung', 'closed', { friendly_name: 'Bewässerung Beet', area: 'garten' }],
  ['camera.einfahrt', 'idle', { friendly_name: 'Kamera Einfahrt', area: 'garten' }], ['camera.garten', 'recording', { friendly_name: 'Kamera Garten', area: 'garten' }],
  ['sensor.pv_leistung', '3.2', { friendly_name: 'PV-Leistung', area: 'garten', device_class: 'power', unit_of_measurement: 'kW' }],
  ['scene.abend', 'unknown', { friendly_name: 'Abend' }], ['scene.film', 'unknown', { friendly_name: 'Film' }], ['scene.nacht', 'unknown', { friendly_name: 'Nacht' }], ['scene.alles_aus', 'unknown', { friendly_name: 'Alles aus' }],
];
const SCENES = {
  'scene.abend': { 'light.wohnzimmer_decke': [90, 2700], 'light.wohnzimmer_stehlampe': [200, 2400], 'light.esstisch': [160, 2400], 'light.flur_decke': null, 'light.kueche_spots': null },
  'scene.film': { 'light.wohnzimmer_decke': null, 'light.esstisch': null, 'light.wohnzimmer_stehlampe': [50, null, [110, 90, 255]], 'light.kueche_led': [60, null, [80, 120, 255]] },
  'scene.nacht': { '*': null, 'light.flur_og': [25, 2200], 'light.aussen_haustuer': [80, 2200] },
  'scene.alles_aus': { '*': null },
};

export function createDemoHass(onChange) {
  const states = Object.fromEntries(DEF.map(([id, state, attributes]) => [id, { entity_id: id, state, attributes }]));
  const store = new Map(); let planStore = null; try { planStore = JSON.parse(localStorage.getItem('hometwin-demo-plan-v2')); } catch { /* storage may be blocked */ }
  const hass = {
    states, demo: true, user: { is_admin: true, name: 'Demo' },
    config: { latitude: 49.326, longitude: 12.11, time_zone: 'Europe/Berlin' },
    areas: Object.fromEntries(Object.entries(AREAS).map(([id, name]) => [id, { area_id: id, name, floor_id: ['schlafzimmer', 'bad', 'kinderzimmer', 'kinderzimmer_2'].includes(id) ? 'obergeschoss' : 'erdgeschoss' }])),
    floors: Object.fromEntries(Object.entries(FLOORS).map(([id, [name, level]]) => [id, { floor_id: id, name, level }])),
    entities: {}, devices: {},
    hassUrl: (p) => p,
    callService: async (domain, service, data) => { svc(domain, service, data); },
    callWS: async (msg) => ws(msg),
    fetchWithAuth: async (url, init = {}) => {
      const key = url.split('?')[0];
      if (init.method === 'POST') { store.set(key, init.body); return new Response(null, { status: 200 }); }
      return store.has(key) ? new Response(store.get(key), { status: 200 }) : new Response(null, { status: 404 });
    },
    connection: { subscribeMessage: async () => () => {} },
  };
  const set = (id, state, attrs = {}) => { const s = states[id]; if (!s) return; states[id] = { ...s, state: state ?? s.state, attributes: { ...s.attributes, ...attrs } }; emit(); };
  let queued = false; const emit = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; hass.states = { ...states }; onChange({ ...hass }); }); };

  function svc(domain, service, data) {
    const id = data.entity_id, s = states[id]; const a = s?.attributes || {};
    if (domain === 'scene') { const sc = SCENES[id] || {}; if ('*' in sc) for (const k of Object.keys(states)) if (k.startsWith('light.')) set(k, 'off'); for (const [k, v] of Object.entries(sc)) { if (k === '*') continue; if (!v) set(k, 'off'); else set(k, 'on', { brightness: v[0], color_temp_kelvin: v[1] || undefined, rgb_color: v[2], color_mode: v[2] ? 'rgb' : 'color_temp' }); } return; }
    if (!s) return;
    if (['light', 'switch', 'fan', 'input_boolean'].includes(domain)) {
      if (service === 'toggle') return set(id, s.state === 'on' ? 'off' : 'on', domain === 'fan' ? { percentage: s.state === 'on' ? 0 : 60 } : {});
      if (service === 'turn_off') return set(id, 'off');
      const { entity_id, ...rest } = data; if (rest.rgb_color) rest.color_mode = 'rgb'; if (rest.color_temp_kelvin) { rest.color_mode = 'color_temp'; rest.rgb_color = undefined; }
      return set(id, 'on', rest);
    }
    if (domain === 'cover') {
      const cur = a.current_position ?? 0; const tgt = { open_cover: 100, close_cover: 0, toggle: cur > 0 ? 0 : 100, set_cover_position: data.position, stop_cover: cur }[service];
      return set(id, null, { target_position: tgt });
    }
    if (domain === 'media_player') { if (service === 'volume_set') return set(id, null, { volume_level: data.volume_level }); return set(id, s.state === 'playing' ? 'paused' : 'playing'); }
    if (domain === 'vacuum') return set(id, service === 'start' ? 'cleaning' : 'returning');
    if (domain === 'lawn_mower') return set(id, service === 'start_mowing' ? 'mowing' : 'returning');
    if (domain === 'valve') return set(id, service === 'open_valve' ? 'open' : 'closed');
    if (domain === 'climate') { const t = Math.round(data.temperature * 2) / 2; return set(id, null, { temperature: t, hvac_action: a.current_temperature < t - 0.2 ? 'heating' : 'idle' }); }
  }

  let tick = 0;
  setInterval(() => {
    tick++;
    for (const s of Object.values(states)) {
      const a = s.attributes;
      if (a.target_position !== undefined && a.target_position !== a.current_position) { const step = s.entity_id === 'cover.garagentor' ? 6 : 10; const p = a.current_position + Math.sign(a.target_position - a.current_position) * Math.min(step, Math.abs(a.target_position - a.current_position)); set(s.entity_id, p === 0 ? 'closed' : 'open', { current_position: p }); }
      if (['returning'].includes(s.state) && tick % 6 === 0) set(s.entity_id, 'docked');
    }
    if (tick % 14 === 3) set('binary_sensor.bewegung_flur', 'on'); if (tick % 14 === 8) set('binary_sensor.bewegung_flur', 'off');
    if (tick % 9 === 0) set('binary_sensor.bewegung_wohnzimmer', states['binary_sensor.bewegung_wohnzimmer'].state === 'on' ? 'off' : 'on');
    if (tick % 4 === 0) for (const c of ['climate.wohnzimmer', 'climate.schlafzimmer', 'climate.bad', 'climate.buero']) {
      const a = states[c].attributes; const cur = Math.round((a.current_temperature + (a.hvac_action === 'heating' ? 0.1 : -0.04)) * 10) / 10;
      set(c, null, { current_temperature: cur, hvac_action: cur < a.temperature - 0.2 ? 'heating' : 'idle' });
      const sensor = c.replace('climate.', 'sensor.') + '_temperatur'; if (states[sensor]) set(sensor, cur.toFixed(1));
    }
    if (tick % 3 === 0) { const v = Math.max(0, Math.min(5.4, parseFloat(states['sensor.pv_leistung'].state) + (Math.random() - 0.45) * 0.4)); set('sensor.pv_leistung', v.toFixed(2)); }
    if (tick % 2 === 0) for (const cam of ['camera.einfahrt', 'camera.garten']) set(cam, null, { entity_picture: cameraFrame(cam, tick) });
  }, 1000);
  for (const cam of ['camera.einfahrt', 'camera.garten']) states[cam].attributes.entity_picture = cameraFrame(cam, 0);

  const jobs = new Map();
  async function ws(msg) {
    switch (msg.type) {
      case 'hometwin/plan/get': return { plan: planStore };
      case 'hometwin/plan/save': planStore = msg.plan; try { localStorage.setItem('hometwin-demo-plan-v2', JSON.stringify(msg.plan)); } catch { /* ignore */ } return {};
      case 'hometwin/agent/info': return { configured: true, model: 'Demo · simuliert' };
      case 'hometwin/agent/chat': await new Promise((r) => setTimeout(r, 700)); return demoAgent(msg, states);
      case 'hometwin/agent/detect': await new Promise((r) => setTimeout(r, 1800)); return demoDetect(msg);
      case 'hometwin/agent/detect_start': { const id = `job${Date.now()}`; const job = { id, mode: msg.mode || 'rooms', status: 'running', started: Date.now() / 1000, stage: 'sent', kb: Math.round(msg.image.length * 0.75 / 1024), chars: 0, rooms: 0, consumed: false, image: msg.image, level_id: msg.level_id };
        jobs.set(id, job); let t = 0; const iv = setInterval(() => { t++; if (t === 1) job.stage = 'reading'; if (t >= 1 && t < 4) { job.chars += 900; job.rooms = t; } if (t === 4) job.stage = 'parsing'; if (t === 5) job.stage = 'fitting'; if (t === 6) { clearInterval(iv); job.result = demoDetect(msg); job.status = 'done'; job.finished = Date.now() / 1000; } }, 600);
        return { job_id: id }; }
      case 'hometwin/agent/job': { const j = msg.job_id ? jobs.get(msg.job_id) : [...jobs.values()].pop(); if (!j) return { job: null }; const { image, ...rest } = j; return { job: { ...rest, elapsed: ((j.finished || Date.now() / 1000) - j.started), ...(msg.with_image ? { image } : {}) } }; }
      case 'hometwin/agent/job_consume': { const j = jobs.get(msg.job_id); if (j) j.consumed = true; return {}; }
      default: throw new Error(`unknown command ${msg.type}`);
    }
  }
  return hass;
}

function cameraFrame(id, t) {
  const c = document.createElement('canvas'); c.width = 480; c.height = 270; const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 270); sky.addColorStop(0, '#6c8fb3'); sky.addColorStop(0.55, '#b9c9d6'); sky.addColorStop(0.56, id.includes('garten') ? '#557a3e' : '#6b6d70'); sky.addColorStop(1, id.includes('garten') ? '#3f5f2e' : '#4b4d50');
  g.fillStyle = sky; g.fillRect(0, 0, 480, 270);
  if (id.includes('einfahrt')) { g.fillStyle = '#355c8c'; const x = 140 + Math.sin(t / 6) * 6; g.fillRect(x, 170, 170, 50); g.fillRect(x + 30, 140, 100, 34); g.fillStyle = '#16171a'; g.beginPath(); g.arc(x + 35, 222, 15, 0, 7); g.arc(x + 135, 222, 15, 0, 7); g.fill(); }
  else { g.fillStyle = '#2f5a30'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(40 + i * 85, 150, 38, 0, 7); g.fill(); } g.fillStyle = '#e8e2d6'; g.fillRect(300 + Math.sin(t / 4) * 20, 200, 60, 12); }
  g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, 480, 22); g.fillStyle = '#fff'; g.font = '13px monospace';
  g.fillText(`${id.replace('camera.', '').toUpperCase()}  ${new Date().toLocaleString('de-DE')}  (simuliert)`, 8, 15);
  return c.toDataURL('image/jpeg', 0.7);
}

function demoAgent(msg, states) {
  const text = msg.messages.filter((m) => m.role === 'user').pop()?.content.toLowerCase() || ''; const plan = msg.plan;
  const used = usedEntities(plan);
  if (msg.include_underlay || text.includes('grundriss')) return { reply: 'Im Demo-Modus werte ich kein Bild aus. Mit einem eingerichteten Modell mit Bildverständnis lese ich hier Räume, Türen und Fenster aus dem Bauplan und schlage sie als Änderungen vor.', operations: [] };
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:m\s*)?(?:x|×|mal)\s*(\d+(?:[.,]\d+)?)/);
  const areaWord = Object.entries(AREAS).find(([id, n]) => text.includes(n.toLowerCase()) || text.includes(id))?.[0] || (text.includes('platzier') || text.includes('entitäten') ? 'buero' : null);
  if (!areaWord) return { reply: 'Das ist die simulierte Version des Assistenten. Probier: „Ich möchte das Büro einbinden“ oder „Platziere die fehlenden Entitäten“.', operations: [] };
  let level = null, room = null;
  for (const l of plan.levels) { const r = l.rooms.find((x) => x.area_id === areaWord); if (r) { level = l; room = r; break; } }
  if (!room && !m) return { reply: `Ich finde im Modell noch keinen Raum für den Bereich „${AREAS[areaWord]}“. Wie groß ist er (Breite × Tiefe in Metern) und auf welcher Etage liegt er? Alternativ kannst du im Tab „Grundriss“ einen Bauplan laden und den Raum nachzeichnen.`, operations: [] };
  const ops = [];
  if (!room) {
    const w = parseFloat(m[1].replace(',', '.')), d = parseFloat(m[2].replace(',', '.')); level = plan.levels.find((l) => l.id === msg.level_id) || plan.levels[0];
    const b = bbox(level.rooms.filter((r) => r.kind !== 'outdoor').flatMap((r) => r.points)); room = { id: 'ai_room', points: [[b.maxX, b.minZ], [b.maxX + w, b.minZ], [b.maxX + w, b.minZ + d], [b.maxX, b.minZ + d]] };
    ops.push({ op: 'add_room', level_id: level.id, id: 'ai_room', name: AREAS[areaWord], area_id: areaWord, rect: [r3(b.maxX), r3(b.minZ), w, d] });
  }
  const b = bbox(room.points); const free = Object.keys(states).filter((id) => states[id].attributes.area === areaWord && !used.has(id));
  const desk = level.furniture.find((f) => f.type === 'desk' && f.pos[0] > b.minX && f.pos[0] < b.maxX && f.pos[1] > b.minZ && f.pos[1] < b.maxZ);
  const windows = level.openings.filter((o) => o.type === 'window' && roomOfOpening(level, o)?.id === room.id);
  for (const id of free) {
    const dom = id.split('.')[0], dc = states[id].attributes.device_class;
    if (dom === 'light') ops.push(id.includes('schreibtisch') && desk ? { op: 'place_device', level_id: level.id, kind: 'light', style: 'table', entity_id: id, pos: [r3(desk.pos[0] + 0.55), r3(desk.pos[1])], y: 0.75 } : { op: 'place_device', level_id: level.id, kind: 'light', style: 'ceiling', entity_id: id, pos: [r3(b.cx), r3(b.cz)] });
    else if (dom === 'sensor') ops.push({ op: 'place_device', level_id: level.id, kind: 'temp', entity_id: id, pos: [r3(b.minX + 0.02), r3(b.minZ + 0.6)], rot: 90, y: 1.5 });
    else if (dom === 'climate') ops.push({ op: 'place_device', level_id: level.id, kind: 'radiator', style: 'panel', entity_id: id, pos: [r3(b.maxX - 0.13), r3(b.cz)], rot: -90 });
    else if (dom === 'cover' && windows[0]) ops.push({ op: 'update_opening', opening_id: windows[0].id, cover: id });
    else if (dom === 'binary_sensor' && dc === 'window' && windows.length) ops.push({ op: 'update_opening', opening_id: (windows[1] || windows[0]).id, contact: id });
    else if (dom === 'cover' || dom === 'binary_sensor') ops.push({ op: 'add_opening', level_id: level.id, type: 'window', from: [r3(b.cx - 0.7), r3(b.maxZ)], to: [r3(b.cx + 0.7), r3(b.maxZ)], sill: 0.9, head: 2.2, [dom === 'cover' ? 'cover' : 'contact']: id });
  }
  if (!ops.length) return { reply: `Im Bereich „${AREAS[areaWord]}“ sind bereits alle Entitäten platziert.`, operations: [] };
  return { reply: `${ops[0].op === 'add_room' ? `Ich lege den Raum „${AREAS[areaWord]}“ mit ${m[1]} × ${m[2]} m an und ` : `Der Raum „${room.name}“ ist vorhanden. Ich `}ordne ${free.length} Entitäten zu. Positionen sind Vorschläge, du kannst sie danach verschieben.`, operations: ops };
}

// Simulated floor-plan recognition for the demo: a plausible layout filling the plan area.
function demoDetect(msg) {
  const { width: w, height: h } = msg;
  if (msg.mode === 'scale') return { dimensions: [{ from: [w * 0.1, h * 0.06], to: [w * 0.9, h * 0.06], meters: 12, label: '12,00 (Demo)', mpp: 12 / (w * 0.8) }] };
  const k = msg.mpp || 12 / (w * 0.8), X0 = Math.round(w * 0.1 * k / 0.05) * 0.05, Z0 = Math.round(h * 0.1 * k / 0.05) * 0.05;
  const W = Math.round(w * 0.8 * k / 0.05) * 0.05, D = Math.round(h * 0.8 * k / 0.05) * 0.05;
  const q = (v) => Math.round(v / 0.05) * 0.05; const xa = q(X0 + W * 0.45), xb = q(X0 + W * 0.7), zh = q(Z0 + D * 0.55), zf = q(Z0 + D * 0.7);
  const R = (name, x0, z0, x1, z1, kind = 'room') => ({ name, kind, points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], label_area: null });
  const rooms = [R('Wohnen & Essen', X0, Z0, xa, zh), R('Küche', xa, Z0, X0 + W, zh), R('Flur', X0, zh, xb, zf), R('Bad', xb, zh, X0 + W, Z0 + D), R('Arbeiten', X0, zf, xb, Z0 + D)]
    .filter((r) => !(msg.locked || []).some((l) => l.name === r.name));
  rooms.forEach((r) => (r.area = Math.abs((r.points[1][0] - r.points[0][0]) * (r.points[2][1] - r.points[1][1]))));
  const openings = msg.options?.openings === false ? [] : [
    { type: 'door', from: [q(X0 + W * 0.2), zh], to: [q(X0 + W * 0.2) + 0.9, zh] }, { type: 'door', from: [xb, q(zh + 0.2)], to: [xb, q(zh + 0.2) + 0.85] },
    { type: 'window', from: [q(X0 + W * 0.1), Z0], to: [q(X0 + W * 0.1) + 1.6, Z0] }, { type: 'window', from: [q(xa + 0.6), Z0], to: [q(xa + 0.6) + 1.2, Z0] },
    { type: 'door', from: [X0, q(zh + 0.1)], to: [X0, q(zh + 0.1) + 1.0] }];
  const stairs = [{ points: [[xb - 1.1, zh + 0.05], [xb - 0.1, zh + 0.05], [xb - 0.1, zf - 0.05], [xb - 1.1, zf - 0.05]].map(([x, z]) => [q(x), q(z)]), up_from: [q(xb - 0.6), q(zf - 0.1)], up_to: [q(xb - 0.6), q(zh + 0.1)], width: 1 }].filter(() => msg.options?.stairs !== false && zf - zh > 1.5);
  return { rooms, openings, stairs, problems: [], mpp: k, level: { name: 'Erdgeschoss', floor_elevation_m: 0, room_height_m: 2.6 }, roof: { type: 'gable', pitch: 38, ridge: W >= D ? 'x' : 'z', outline: null },
    ...(msg.mode === 'refine' ? { adjusted: ['Demo: Ergebnis in einem zweiten Durchgang geprüft'] } : {}), scale_source: msg.mpp ? 'measured' : 'dimensions', notes: 'Demo-Modus: simulierte Erkennung. Mit einem echten Modell werden die Räume aus deinem Plan gelesen.' };
}
