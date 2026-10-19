import { demoSolarPower } from './demo-solar.js';
// A simulated Home Assistant for the standalone demo: states, services, websocket
// commands of the HomeTwin backend and a scripted stand-in for the agent.
import { usedEntities, roomOfOpening } from './plan.js';
import { generativeArt } from './media.js';
import { bbox, r3 } from './geometry.js';
import { t, getLanguage } from './i18n.js';

const areaNames = () => Object.fromEntries(['wohnzimmer', 'kueche', 'flur', 'buero', 'garage', 'garten', 'schlafzimmer', 'bad', 'kinderzimmer', 'kinderzimmer_2'].map((id) => [id, t(`data.demo.area.${id}`)]));
const floorNames = () => ({ erdgeschoss: [t('data.defaults.groundFloor'), 0], obergeschoss: [t('data.defaults.upperFloor'), 1] });
const L = (id, name, area, on, b, k, extra = {}) => [id, on ? 'on' : 'off', { friendly_name: name, area, brightness: b, color_temp_kelvin: k, supported_color_modes: ['color_temp', 'rgb'], ...extra }];
const demoEntities = () => [
  L('light.wohnzimmer_decke', t('data.demo.entity.light_wohnzimmer_decke'), 'wohnzimmer', true, 140, 3000), L('light.wohnzimmer_stehlampe', t('data.demo.entity.light_wohnzimmer_stehlampe'), 'wohnzimmer', true, 220, 2400), L('light.esstisch', t('data.demo.entity.light_esstisch'), 'wohnzimmer', true, 230, 2700),
  L('light.kueche_spots', t('data.demo.entity.light_kueche_spots'), 'kueche', false, 255, 4000), L('light.kueche_led', t('data.demo.entity.light_kueche_led'), 'kueche', true, 200, null, { rgb_color: [255, 150, 70], color_mode: 'rgb' }),
  L('light.flur_decke', t('data.demo.entity.light_flur_decke'), 'flur', false, 200, 3500), L('light.diele', t('data.demo.entity.light_diele'), 'flur', true, 120, 2700), L('light.garage', t('data.demo.entity.light_garage'), 'garage', false, 255, 5000),
  L('light.aussen_haustuer', t('data.demo.entity.light_aussen_haustuer'), 'garten', true, 160, 2700), L('light.gartenweg', t('data.demo.entity.light_gartenweg'), 'garten', true, 180, 2700),
  L('light.schlafzimmer_decke', t('data.demo.entity.light_schlafzimmer_decke'), 'schlafzimmer', false, 180, 3000), L('light.nachttisch_links', t('data.demo.entity.light_nachttisch_links'), 'schlafzimmer', true, 90, 2200), L('light.nachttisch_rechts', t('data.demo.entity.light_nachttisch_rechts'), 'schlafzimmer', false, 90, 2200),
  L('light.bad_spiegel', t('data.demo.entity.light_bad_spiegel'), 'bad', true, 255, 5000), L('light.kind1', t('data.demo.entity.light_kind1'), 'kinderzimmer', true, 160, 3500), L('light.kind2', t('data.demo.entity.light_kind2'), 'kinderzimmer_2', false, 180, 3500), L('light.flur_og', t('data.demo.entity.light_flur_og'), 'flur', false, 150, 3000),
  L('light.buero_decke', t('data.demo.entity.light_buero_decke'), 'buero', false, 220, 4200), L('light.buero_schreibtisch', t('data.demo.entity.light_buero_schreibtisch'), 'buero', true, 200, 3800),
  ['cover.wohnzimmer_west', 'open', { friendly_name: t('data.demo.entity.cover_wohnzimmer_west'), area: 'wohnzimmer', current_position: 100 }], ['cover.wohnzimmer_sued', 'open', { friendly_name: t('data.demo.entity.cover_wohnzimmer_sued'), area: 'wohnzimmer', current_position: 60 }],
  ['cover.wohnzimmer_nord', 'open', { friendly_name: t('data.demo.entity.cover_wohnzimmer_nord'), area: 'wohnzimmer', current_position: 100 }], ['cover.kueche', 'open', { friendly_name: t('data.demo.entity.cover_kueche'), area: 'kueche', current_position: 100 }],
  ['cover.schlafzimmer', 'closed', { friendly_name: t('data.demo.entity.cover_schlafzimmer'), area: 'schlafzimmer', current_position: 0 }], ['cover.kind1', 'open', { friendly_name: t('data.demo.entity.cover_kind1'), area: 'kinderzimmer', current_position: 40 }],
  ['cover.kind2', 'open', { friendly_name: t('data.demo.entity.cover_kind2'), area: 'kinderzimmer_2', current_position: 100 }], ['cover.buero', 'open', { friendly_name: t('data.demo.entity.cover_buero'), area: 'buero', current_position: 100 }],
  ['cover.dachfenster', 'open', { friendly_name: t('data.demo.entity.cover_dachfenster'), area: 'kinderzimmer', current_position: 100 }], ['binary_sensor.dachfenster', 'off', { friendly_name: t('data.demo.entity.binary_sensor_dachfenster'), area: 'kinderzimmer', device_class: 'window' }],
  ['cover.garagentor', 'closed', { friendly_name: t('data.demo.entity.cover_garagentor'), area: 'garage', current_position: 0, device_class: 'garage' }],
  ['binary_sensor.haustuer', 'off', { friendly_name: t('data.demo.entity.binary_sensor_haustuer'), area: 'flur', device_class: 'door' }], ['binary_sensor.terrassentuer', 'off', { friendly_name: t('data.demo.entity.binary_sensor_terrassentuer'), area: 'wohnzimmer', device_class: 'door' }],
  ['binary_sensor.bad_fenster', 'on', { friendly_name: t('data.demo.entity.binary_sensor_bad_fenster'), area: 'bad', device_class: 'window' }], ['binary_sensor.buero_fenster', 'off', { friendly_name: t('data.demo.entity.binary_sensor_buero_fenster'), area: 'buero', device_class: 'window' }],
  ['binary_sensor.bewegung_flur', 'off', { friendly_name: t('data.demo.entity.binary_sensor_bewegung_flur'), area: 'flur', device_class: 'motion' }], ['binary_sensor.bewegung_wohnzimmer', 'on', { friendly_name: t('data.demo.entity.binary_sensor_bewegung_wohnzimmer'), area: 'wohnzimmer', device_class: 'motion' }],
  ['binary_sensor.rauchmelder_flur', 'off', { friendly_name: t('data.demo.entity.binary_sensor_rauchmelder_flur'), area: 'flur', device_class: 'smoke' }], ['binary_sensor.rauchmelder_og', 'off', { friendly_name: t('data.demo.entity.binary_sensor_rauchmelder_og'), area: 'flur', device_class: 'smoke' }],
  ['sensor.wohnzimmer_temperatur', '21.4', { friendly_name: t('data.demo.entity.sensor_wohnzimmer_temperatur'), area: 'wohnzimmer', device_class: 'temperature', unit_of_measurement: '°C' }], ['sensor.schlafzimmer_temperatur', '18.2', { friendly_name: t('data.demo.entity.sensor_schlafzimmer_temperatur'), area: 'schlafzimmer', device_class: 'temperature', unit_of_measurement: '°C' }],
  ['sensor.buero_temperatur', '19.6', { friendly_name: t('data.demo.entity.sensor_buero_temperatur'), area: 'buero', device_class: 'temperature', unit_of_measurement: '°C' }],
  ['climate.wohnzimmer', 'heat', { friendly_name: t('data.demo.entity.climate_wohnzimmer'), area: 'wohnzimmer', current_temperature: 21.4, temperature: 22, hvac_action: 'heating', hvac_modes: ['off', 'heat'] }],
  ['climate.schlafzimmer', 'heat', { friendly_name: t('data.demo.entity.climate_schlafzimmer'), area: 'schlafzimmer', current_temperature: 18.2, temperature: 18, hvac_action: 'idle', hvac_modes: ['off', 'heat'] }],
  ['climate.bad', 'heat', { friendly_name: t('data.demo.entity.climate_bad'), area: 'bad', current_temperature: 23.4, temperature: 24, hvac_action: 'heating', hvac_modes: ['off', 'heat'] }],
  ['climate.schlafzimmer_klima', 'off', { friendly_name: t('data.demo.entity.climate_schlafzimmer_klima'), area: 'schlafzimmer', current_temperature: 18.2, temperature: 21, hvac_action: 'off', hvac_modes: ['off', 'cool', 'heat', 'fan_only'] }],
  ['climate.buero', 'heat', { friendly_name: t('data.demo.entity.climate_buero'), area: 'buero', current_temperature: 19.6, temperature: 21, hvac_action: 'heating', hvac_modes: ['off', 'heat'] }],
  ['fan.kind2', 'off', { friendly_name: t('data.demo.entity.fan_kind2'), area: 'kinderzimmer_2', percentage: 0 }],
  ['media_player.wohnzimmer_tv', 'playing', { friendly_name: t('data.demo.entity.media_player_wohnzimmer_tv'), area: 'wohnzimmer', device_class: 'tv', app_name: 'YouTube', media_title: t('data.demo.media.tvTitle'), media_artist: t('data.demo.media.tvArtist'), media_duration: 1260, media_position: 312, volume_level: 0.3 }],
  ['media_player.kueche', 'playing', { friendly_name: t('data.demo.entity.media_player_kueche'), area: 'kueche', app_name: t('data.demo.media.radio'), media_title: t('data.demo.media.songTitle'), media_artist: t('data.demo.media.songArtist'), volume_level: 0.4, group_members: ['media_player.kueche', 'media_player.esszimmer'] }],
  ['media_player.esszimmer', 'playing', { friendly_name: t('data.demo.entity.media_player_esszimmer'), area: 'wohnzimmer', app_name: t('data.demo.media.radio'), media_title: t('data.demo.media.songTitle'), media_artist: t('data.demo.media.songArtist'), volume_level: 0.35, group_members: ['media_player.kueche', 'media_player.esszimmer'] }],
  ['switch.kamin', 'on', { friendly_name: t('data.demo.entity.switch_kamin'), area: 'wohnzimmer' }],
  ['sensor.waschmaschine', 'running', { friendly_name: t('data.demo.entity.sensor_waschmaschine'), area: 'garage' }],
  ['vacuum.roby', 'docked', { friendly_name: t('data.demo.entity.vacuum_roby'), area: 'wohnzimmer', battery_level: 88 }], ['lawn_mower.rasenmaeher', 'docked', { friendly_name: t('data.demo.entity.lawn_mower_rasenmaeher'), area: 'garten' }],
  ['valve.bewaesserung', 'closed', { friendly_name: t('data.demo.entity.valve_bewaesserung'), area: 'garten' }],
  ['camera.einfahrt', 'idle', { friendly_name: t('data.demo.entity.camera_einfahrt'), area: 'garten' }], ['camera.garten', 'recording', { friendly_name: t('data.demo.entity.camera_garten'), area: 'garten' }],
  ['sensor.pv_leistung', '0', { friendly_name: t('data.demo.entity.sensor_pv_leistung'), area: 'garten', device_class: 'power', unit_of_measurement: 'kW' }],
  ['scene.abend', 'unknown', { friendly_name: t('data.demo.entity.scene_abend') }], ['scene.film', 'unknown', { friendly_name: t('data.demo.entity.scene_film') }], ['scene.nacht', 'unknown', { friendly_name: t('data.demo.entity.scene_nacht') }], ['scene.alles_aus', 'unknown', { friendly_name: t('data.demo.entity.scene_alles_aus') }],
];
const SCENES = {
  'scene.abend': { 'light.wohnzimmer_decke': [90, 2700], 'light.wohnzimmer_stehlampe': [200, 2400], 'light.esstisch': [160, 2400], 'light.flur_decke': null, 'light.kueche_spots': null },
  'scene.film': { 'light.wohnzimmer_decke': null, 'light.esstisch': null, 'light.wohnzimmer_stehlampe': [50, null, [110, 90, 255]], 'light.kueche_led': [60, null, [80, 120, 255]] },
  'scene.nacht': { '*': null, 'light.flur_og': [25, 2200], 'light.aussen_haustuer': [80, 2200] },
  'scene.alles_aus': { '*': null },
};

export function createDemoHass(onChange) {
  const AREAS = areaNames(), FLOORS = floorNames();
  const states = Object.fromEntries(demoEntities().map(([id, state, attributes]) => [id, { entity_id: id, state, attributes }]));
  const showcase = new URLSearchParams(location.search).get('showcase');
  const mediaShowcase = ['media', 'polish', 'height'].includes(showcase);
  const planStorageKey = mediaShowcase ? `hometwin-demo-${showcase}-plan-v2` : 'hometwin-demo-plan-v2';
  const imageStorageKey = mediaShowcase ? `hometwin-demo-${showcase}-images` : 'hometwin-demo-images';
  const store = new Map(); let planStore = null; try { planStore = JSON.parse(localStorage.getItem(planStorageKey)); } catch { /* storage may be blocked */ }
  const hass = {
    states, demo: true, updateDemoSun(elevation) { const value = demoSolarPower(elevation).toFixed(2); if (states['sensor.pv_leistung'].state !== value) set('sensor.pv_leistung', value); }, user: { is_admin: true, name: 'Demo' },
    config: { latitude: 49.326, longitude: 12.11, time_zone: 'Europe/Berlin' },
    areas: Object.fromEntries(Object.entries(AREAS).map(([id, name]) => [id, { area_id: id, name, floor_id: ['schlafzimmer', 'bad', 'kinderzimmer', 'kinderzimmer_2'].includes(id) ? 'obergeschoss' : 'erdgeschoss' }])),
    floors: Object.fromEntries(Object.entries(FLOORS).map(([id, [name, level]]) => [id, { floor_id: id, name, level }])),
    entities: {}, devices: {},
    hassUrl: (p) => p,
    callService: async (domain, service, data) => { svc(domain, service, data); },
    callWS: async (msg) => ws(msg),
    callApi: async (method, path) => { // scene configs for the scene preview
      const m = /^config\/scene\/config\/(.+)$/.exec(path); if (!m) throw new Error('not found'); const id = m[1].startsWith('scene.') ? m[1] : `scene.${m[1]}`; const sc = SCENES[id]; if (!sc) throw new Error('not found');
      const entities = {}; if ('*' in sc) for (const k of Object.keys(states)) if (k.startsWith('light.')) entities[k] = { state: 'off' };
      for (const [k, v] of Object.entries(sc)) { if (k === '*') continue; entities[k] = v ? { state: 'on', brightness: v[0], ...(v[1] ? { color_temp_kelvin: v[1] } : {}), ...(v[2] ? { rgb_color: v[2] } : {}) } : { state: 'off' }; }
      return { id, entities };
    },
    fetchWithAuth: async (url, init = {}) => {
      const path = new URL(url, location.href).pathname;
      const key = `${imageStorageKey}:${path}`;
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
    if (domain === 'media_player') { if (service === 'volume_set') return set(id, null, { volume_level: data.volume_level }); const pos = a.media_duration ? Math.min(a.media_duration, (a.media_position || 0) + (s.state === 'playing' && a.media_position_updated_at ? (Date.now() - Date.parse(a.media_position_updated_at)) / 1000 : 0)) : undefined; return set(id, s.state === 'playing' ? 'paused' : 'playing', pos != null ? { media_position: pos, media_position_updated_at: new Date().toISOString() } : {}); }
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
    if (tick % 40 === 0) set('sensor.waschmaschine', states['sensor.waschmaschine'].state === 'running' ? 'idle' : 'running');
    if (tick % 2 === 0) for (const cam of ['camera.einfahrt', 'camera.garten']) set(cam, null, { entity_picture: cameraFrame(cam, tick) });
  }, 1000);
  for (const cam of ['camera.einfahrt', 'camera.garten']) states[cam].attributes.entity_picture = cameraFrame(cam, 0);
  states['media_player.wohnzimmer_tv'].attributes.entity_picture = posterArt('alpen'); states['media_player.wohnzimmer_tv'].attributes.media_position_updated_at = new Date().toISOString();
  for (const k of ['media_player.kueche', 'media_player.esszimmer']) states[k].attributes.entity_picture = posterArt('album');

  const jobs = new Map();
  async function ws(msg) {
    switch (msg.type) {
      case 'hometwin/language/set':
        if (!['en', 'de'].includes(msg.language)) throw new Error('Invalid language');
        localStorage.setItem('hometwin.ui_language', msg.language);
        return {};
      case 'hometwin/plan/get': return { plan: planStore };
      case 'hometwin/plan/save': planStore = msg.plan; try { localStorage.setItem(planStorageKey, JSON.stringify(msg.plan)); } catch { /* ignore */ } return {};
      case 'media_source/browse_media': {
        const id = msg.media_content_id || 'media-source://media_source';
        if (id === 'media-source://media_source') return { title: t('data.demo.media.root'), children: ['vacation', 'family', 'art'].map((key) => ({ title: t(`data.demo.media.folder.${key}`), media_content_id: `${id}/local/${key}`, media_class: 'directory', can_expand: true })) };
        return { title: id.split('/').pop(), children: Array.from({ length: 8 }, (_, i) => ({ title: t('data.demo.media.photoFile', { number: i + 1 }), media_content_id: `${id}/photo_${i + 1}.jpg`, media_class: 'image', media_content_type: 'image/jpeg', can_expand: false })) };
      }
      case 'media_source/resolve_media': return { url: generativeArt(msg.media_content_id, 640, 480).toDataURL('image/jpeg', 0.85), mime_type: 'image/jpeg' };
      case 'hometwin/vacuum/maps': return { maps: [] };
      case 'hometwin/agent/info': return { configured: true, model: t('data.demo.simulatedModel') };
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

// Simulated artwork for media players (own drawing, no real covers or thumbnails).
function posterArt(kind) {
  const c = document.createElement('canvas'); c.width = 512; c.height = kind === 'album' ? 512 : 288; const g = c.getContext('2d'), W = c.width, H = c.height;
  if (kind === 'album') { const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#f6a85b'); gr.addColorStop(1, '#d9467a'); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(W * 0.5, H * 0.58, W * 0.22, 0, 7); g.fill(); g.fillStyle = '#2b1640'; g.fillRect(0, H * 0.72, W, H * 0.28); g.fillStyle = '#fff'; g.font = '700 46px system-ui'; g.fillText(t('data.demo.media.posterTitle').toUpperCase(), 40, H - 50); return c.toDataURL('image/jpeg', 0.85); }
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#3b6fb6'); sky.addColorStop(1, '#f2c48f'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const ridge = (y, amp, col, seed) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 8) g.lineTo(x, y - amp * Math.abs(Math.sin(x * 0.011 + seed) + 0.5 * Math.sin(x * 0.031 + seed * 2))); g.lineTo(W, H); g.fill(); };
  ridge(H * 0.62, 70, '#6d7fa3', 1); ridge(H * 0.75, 50, '#3e5277', 2.3); ridge(H * 0.92, 30, '#22324d', 4.1);
  g.fillStyle = 'rgba(255,240,210,.9)'; g.beginPath(); g.arc(W * 0.78, H * 0.3, 22, 0, 7); g.fill(); return c.toDataURL('image/jpeg', 0.85);
}
function cameraFrame(id, tick) {
  const c = document.createElement('canvas'); c.width = 480; c.height = 270; const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 270); sky.addColorStop(0, '#6c8fb3'); sky.addColorStop(0.55, '#b9c9d6'); sky.addColorStop(0.56, id.includes('garten') ? '#557a3e' : '#6b6d70'); sky.addColorStop(1, id.includes('garten') ? '#3f5f2e' : '#4b4d50');
  g.fillStyle = sky; g.fillRect(0, 0, 480, 270);
  if (id.includes('einfahrt')) { g.fillStyle = '#355c8c'; const x = 140 + Math.sin(tick / 6) * 6; g.fillRect(x, 170, 170, 50); g.fillRect(x + 30, 140, 100, 34); g.fillStyle = '#16171a'; g.beginPath(); g.arc(x + 35, 222, 15, 0, 7); g.arc(x + 135, 222, 15, 0, 7); g.fill(); }
  else { g.fillStyle = '#2f5a30'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(40 + i * 85, 150, 38, 0, 7); g.fill(); } g.fillStyle = '#e8e2d6'; g.fillRect(300 + Math.sin(tick / 4) * 20, 200, 60, 12); }
  g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, 480, 22); g.fillStyle = '#fff'; g.font = '13px monospace';
  g.fillText(`${id.replace('camera.', '').toUpperCase()}  ${new Date().toLocaleString(getLanguage() === 'de' ? 'de-DE' : 'en-US')}  ${t('data.demo.simulatedSuffix')}`, 8, 15);
  return c.toDataURL('image/jpeg', 0.7);
}

function demoAgent(msg, states) {
  const AREAS = areaNames();
  const text = msg.messages.filter((m) => m.role === 'user').pop()?.content.toLowerCase() || ''; const plan = msg.plan;
  const used = usedEntities(plan);
  if (msg.include_underlay || text.includes(t('data.demo.agent.floorPlanTerm'))) return { reply: t('data.demo.agent.noImage'), operations: [] };
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:m\s*)?(?:x|×|mal)\s*(\d+(?:[.,]\d+)?)/);
  const areaWord = Object.entries(AREAS).find(([id, n]) => text.includes(n.toLowerCase()) || text.includes(id))?.[0] || (t('data.demo.agent.placeTerms').split('|').some((term) => text.includes(term)) ? 'buero' : null);
  if (!areaWord) return { reply: t('data.demo.agent.help'), operations: [] };
  let level = null, room = null;
  for (const l of plan.levels) { const r = l.rooms.find((x) => x.area_id === areaWord); if (r) { level = l; room = r; break; } }
  if (!room && !m) return { reply: t('data.demo.agent.missingRoom', { area: AREAS[areaWord] }), operations: [] };
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
  if (!ops.length) return { reply: t('data.demo.agent.allPlaced', { area: AREAS[areaWord] }), operations: [] };
  return { reply: t(ops[0].op === 'add_room' ? 'data.demo.agent.roomAdded' : 'data.demo.agent.roomExists', { area: AREAS[areaWord], room: room.name, width: m?.[1] || '', depth: m?.[2] || '', count: free.length }), operations: ops };
}

// Simulated floor-plan recognition for the demo: a plausible layout filling the plan area.
function demoDetect(msg) {
  const { width: w, height: h } = msg;
  if (msg.mode === 'scale') return { dimensions: [{ from: [w * 0.1, h * 0.06], to: [w * 0.9, h * 0.06], meters: 12, label: t('data.demo.detect.scaleLabel'), mpp: 12 / (w * 0.8) }] };
  const k = msg.mpp || 12 / (w * 0.8), X0 = Math.round(w * 0.1 * k / 0.05) * 0.05, Z0 = Math.round(h * 0.1 * k / 0.05) * 0.05;
  const W = Math.round(w * 0.8 * k / 0.05) * 0.05, D = Math.round(h * 0.8 * k / 0.05) * 0.05;
  const q = (v) => Math.round(v / 0.05) * 0.05; const xa = q(X0 + W * 0.45), xb = q(X0 + W * 0.7), zh = q(Z0 + D * 0.55), zf = q(Z0 + D * 0.7);
  const R = (name, x0, z0, x1, z1, kind = 'room') => ({ name, kind, points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], label_area: null });
  const rooms = [R(t('data.demo.room.livingDining'), X0, Z0, xa, zh), R(t('data.demo.room.kueche'), xa, Z0, X0 + W, zh), R(t('data.demo.room.flur'), X0, zh, xb, zf), R(t('data.demo.room.bad'), xb, zh, X0 + W, Z0 + D), R(t('data.demo.room.work'), X0, zf, xb, Z0 + D)]
    .filter((r) => !(msg.locked || []).some((l) => l.name === r.name));
  rooms.forEach((r) => (r.area = Math.abs((r.points[1][0] - r.points[0][0]) * (r.points[2][1] - r.points[1][1]))));
  const openings = msg.options?.openings === false ? [] : [
    { type: 'door', from: [q(X0 + W * 0.2), zh], to: [q(X0 + W * 0.2) + 0.9, zh] }, { type: 'door', from: [xb, q(zh + 0.2)], to: [xb, q(zh + 0.2) + 0.85] },
    { type: 'window', from: [q(X0 + W * 0.1), Z0], to: [q(X0 + W * 0.1) + 1.6, Z0] }, { type: 'window', from: [q(xa + 0.6), Z0], to: [q(xa + 0.6) + 1.2, Z0] },
    { type: 'door', from: [X0, q(zh + 0.1)], to: [X0, q(zh + 0.1) + 1.0] }];
  const stairs = [{ points: [[xb - 1.1, zh + 0.05], [xb - 0.1, zh + 0.05], [xb - 0.1, zf - 0.05], [xb - 1.1, zf - 0.05]].map(([x, z]) => [q(x), q(z)]), up_from: [q(xb - 0.6), q(zf - 0.1)], up_to: [q(xb - 0.6), q(zh + 0.1)], width: 1 }].filter(() => msg.options?.stairs !== false && zf - zh > 1.5);
  return { rooms, openings, stairs, problems: [], mpp: k, level: { name: t('data.defaults.groundFloor'), floor_elevation_m: 0, room_height_m: 2.6 }, roof: { type: 'gable', pitch: 38, ridge: W >= D ? 'x' : 'z', outline: null },
    ...(msg.mode === 'refine' ? { adjusted: [t('data.demo.detect.adjusted')] } : {}), scale_source: msg.mpp ? 'measured' : 'dimensions', notes: t('data.demo.detect.notes') };
}
