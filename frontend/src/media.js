// Media on screens and walls: TV/projector screens, speaker labels, picture frames and posters.
// Performance rules: no video. A screen is a small canvas texture that is redrawn only when its
// content changes (title, artwork, state, minute); motion (slow zoom/pan, cross-fades) is done by
// moving texture offsets or opacities, which costs nothing on the GPU. Images are cached and capped.
import * as THREE from 'three';
import { t as tr, getLocale, getLanguage } from './i18n.js';

const MAX_CACHE = 32;

// Loads and caches images (HA proxy URLs, data URLs, authenticated HomeTwin uploads, media folders).
export class MediaHub {
  constructor(app) { this.app = app; this.cache = new Map(); this.folders = new Map(); this.colors = new WeakMap(); }
  get hass() { return this.app.hass || this.app._hass; }
  // Returns the loaded image or null (and starts loading). `auth` = fetch through Home Assistant's auth.
  image(url, { auth = false, maxAge = Infinity } = {}) {
    const resolved = this.resolve(url); if (!resolved) return null;
    const key = `${auth}:${resolved}`, now = Date.now();
    let entry = this.cache.get(key);
    if (entry) { this.cache.delete(key); this.cache.set(key, entry); }
    else { entry = { img: null, loaded: 0, pending: false }; this.cache.set(key, entry); }
    if (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value);
    if (!entry.pending && (!entry.loaded || now - entry.loaded >= (entry.failed ? 30000 : maxAge))) {
      entry.pending = true;
      (async () => {
        try {
          let img;
          if (auth) {
            const local = new URL(resolved);
            const r = await this.hass.fetchWithAuth(local.pathname + local.search, { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
            img = await createImageBitmap(await r.blob());
          } else {
            img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
            // A fresh URL also bypasses the browser cache for camera snapshots.
            const fresh = new URL(resolved, location.href);
            if (Number.isFinite(maxAge) && /^https?:$/.test(fresh.protocol)) fresh.searchParams.set('_hometwin', String(now));
            img.src = fresh.href; await img.decode();
          }
          entry.img = img; entry.failed = false;
          this.app.stage?.invalidate();
        } catch { entry.failed = true; }
        finally { entry.loaded = Date.now(); entry.pending = false; }
      })();
    }
    return entry.img;
  }
  // Media remains local to Home Assistant; never fetch arbitrary third-party artwork.
  resolve(url) {
    if (typeof url !== 'string' || !url) return null;
    if (/^data:image\//i.test(url) || url.startsWith('blob:')) return url;
    try {
      const base = new URL(this.hass?.hassUrl ? this.hass.hassUrl('/') : '/', location.href).href;
      const parsed = new URL(url, base);
      return /^https?:$/.test(parsed.protocol) && parsed.origin === new URL(base).origin && !parsed.username && !parsed.password ? parsed.href : null;
    } catch { return null; }
  }
  // Average colour of an image (for the ambient glow of a screen).
  color(img) {
    if (!img) return null; let c = this.colors.get(img); if (c) return c;
    try { const cv = document.createElement('canvas'); cv.width = cv.height = 8; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 8, 8); const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } c = new THREE.Color(r / 64 / 255, gg / 64 / 255, b / 64 / 255); const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, Math.min(1, hsl.s * 1.4 + 0.1), Math.max(0.45, hsl.l)); }
    catch { c = new THREE.Color('#79a6ff'); }
    this.colors.set(img, c); return c;
  }
  // Images of a Home Assistant media folder (media-source://…), refreshed every 10 minutes.
  folder(id) {
    if (!id) return null; let f = this.folders.get(id);
    if (!f || Date.now() - f.t > 600000) {
      if (!f) { f = { t: Date.now(), items: [] }; this.folders.set(id, f); } else f.t = Date.now();
      (async () => {
        try {
          const res = await this.hass.callWS({ type: 'media_source/browse_media', media_content_id: id });
          const kids = (res.children || []).filter((c) => (c.media_content_type || '').startsWith('image') || c.media_class === 'image').slice(0, 200);
          f.items = kids.map((c) => c.media_content_id);
        } catch { f.items = []; }
      })();
    }
    return f.items;
  }
  // Resolves a media-source item to a URL (cached for 50 minutes; signed URLs expire).
  async resolveItem(id, { maxAge = 3000000, force = false } = {}) {
    const k = `res:${id}`, hit = this.folders.get(k); if (!force && hit && Date.now() - hit.t < maxAge) return hit.url;
    const r = await this.hass.callWS({ type: 'media_source/resolve_media', media_content_id: id }); this.folders.set(k, { t: Date.now(), url: r.url }); return r.url;
  }
  async browseDirs(id = 'media-source://media_source') {
    try { const r = await this.hass.callWS({ type: 'media_source/browse_media', media_content_id: id }); return (r.children || []).filter((c) => c.can_expand).map((c) => ({ id: c.media_content_id, title: c.title })); } catch { return []; }
  }
}

/* ---------- app badges (own simple glyphs and colours, no brand logos) ---------- */
const APPS = [
  [/youtube/i, '#ff2a2a', 'play'], [/netflix/i, '#e50914', 'play'], [/prime|amazon/i, '#1fa7e1', 'play'], [/disney/i, '#1b3fa8', 'play'], [/apple ?tv/i, '#d9d9de', 'play'],
  [/plex|jellyfin|emby|kodi/i, '#e5a00d', 'play'], [/spotify/i, '#1db954', 'note'], [/apple ?music|music/i, '#fa2d48', 'note'], [/tunein|radio|bayern|wdr|ndr|swr/i, '#ff8a3d', 'radio'],
  [/tv|live|ard|zdf|tagesschau|sky/i, '#4f8cff', 'tv'],
];
export function appStyle(name = '') { for (const [re, color, glyph] of APPS) if (re.test(name)) return { color, glyph }; return { color: '#79a6ff', glyph: 'play' }; }
function glyph(g, kind, x, y, s, color = '#fff') {
  g.save(); g.fillStyle = color; g.strokeStyle = color; g.lineWidth = s * 0.12; g.lineCap = 'round'; g.translate(x, y);
  if (kind === 'play') { g.beginPath(); g.moveTo(-s * 0.28, -s * 0.36); g.lineTo(s * 0.4, 0); g.lineTo(-s * 0.28, s * 0.36); g.closePath(); g.fill(); }
  else if (kind === 'pause') { g.fillRect(-s * 0.32, -s * 0.38, s * 0.22, s * 0.76); g.fillRect(s * 0.1, -s * 0.38, s * 0.22, s * 0.76); }
  else if (kind === 'note') { g.beginPath(); g.arc(-s * 0.12, s * 0.22, s * 0.18, 0, 7); g.fill(); g.fillRect(s * 0.02, -s * 0.4, s * 0.1, s * 0.62); g.fillRect(s * 0.02, -s * 0.4, s * 0.32, s * 0.12); }
  else if (kind === 'radio') { for (const r of [0.14, 0.3, 0.46]) { g.beginPath(); g.arc(0, s * 0.2, r * s, -Math.PI * 0.8, -Math.PI * 0.2); g.stroke(); } g.beginPath(); g.arc(0, s * 0.2, s * 0.07, 0, 7); g.fill(); }
  else if (kind === 'tv') { g.strokeRect(-s * 0.38, -s * 0.26, s * 0.76, s * 0.5); g.beginPath(); g.moveTo(-s * 0.15, -s * 0.42); g.lineTo(0, -s * 0.28); g.lineTo(s * 0.15, -s * 0.42); g.stroke(); }
  g.restore();
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function coverDraw(g, img, W, H) { const s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s; g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); }
function ellipsize(g, t, max) { if (g.measureText(t).width <= max) return t; while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; }

// A TV/projector screen: canvas texture redrawn only when the visible content changes.
export class Screen {
  constructor(w = 512, h = 288) {
    this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h; this.g = this.c.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping; this.sig = '';
  }
  // st: { state, title, artist, app, img, progress (0..1|null) }
  draw(st) {
    const p = st.progress == null ? -1 : Math.round(st.progress * 60);
    const sig = [getLanguage(), st.state, st.title, st.artist, st.app, st.img ? 1 : 0, p, st.state === 'on' || st.state === 'idle' ? new Date().getMinutes() : ''].join('|');
    if (sig === this.sig && st.img === this.lastImage) return false; this.sig = sig; this.lastImage = st.img;
    const g = this.g, W = this.c.width, H = this.c.height, a = appStyle(st.app || st.title || '');
    if (st.img) coverDraw(g, st.img, W, H);
    else { const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#101828'); gr.addColorStop(1, shadeHex(a.color, -0.55)); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalAlpha = 0.18; glyph(g, a.glyph, W * 0.5, H * 0.45, H * 0.55, a.color); g.globalAlpha = 1; }
    const idle = st.state === 'on' || st.state === 'idle';
    if (idle && !st.img) { // home screen: clock + source
      g.fillStyle = 'rgba(255,255,255,.92)'; g.font = `600 ${Math.round(H * 0.2)}px system-ui, sans-serif`; g.textAlign = 'center'; g.fillText(new Date().toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }), W / 2, H * 0.5);
      g.font = `500 ${Math.round(H * 0.07)}px system-ui, sans-serif`; g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(st.app || tr('media.ready'), W / 2, H * 0.66); g.textAlign = 'start';
    }
    if (st.title && !idle) { // lower third
      const sh = g.createLinearGradient(0, H * 0.55, 0, H); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.78)'); g.fillStyle = sh; g.fillRect(0, H * 0.55, W, H * 0.45);
      g.fillStyle = '#fff'; g.font = `700 ${Math.round(H * 0.075)}px system-ui, sans-serif`; g.fillText(ellipsize(g, st.title, W * 0.8), W * 0.05, H * 0.84);
      if (st.artist) { g.font = `500 ${Math.round(H * 0.055)}px system-ui, sans-serif`; g.fillStyle = 'rgba(255,255,255,.75)'; g.fillText(ellipsize(g, st.artist, W * 0.8), W * 0.05, H * 0.92); }
    }
    if (st.app && !idle) { // app badge top left
      g.font = `600 ${Math.round(H * 0.055)}px system-ui, sans-serif`; const tw = g.measureText(st.app).width, bh = H * 0.1, bw = bh + tw + H * 0.05;
      rr(g, W * 0.04, H * 0.06, bw, bh, bh * 0.28); g.fillStyle = 'rgba(0,0,0,.55)'; g.fill();
      rr(g, W * 0.04 + bh * 0.12, H * 0.06 + bh * 0.12, bh * 0.76, bh * 0.76, bh * 0.2); g.fillStyle = a.color; g.fill(); glyph(g, a.glyph, W * 0.04 + bh * 0.5, H * 0.06 + bh * 0.5, bh * 0.6);
      g.fillStyle = '#fff'; g.fillText(st.app, W * 0.04 + bh + H * 0.015, H * 0.06 + bh * 0.68);
    }
    if (p >= 0 && !idle) { g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(W * 0.05, H * 0.955, W * 0.9, 3); g.fillStyle = a.color; g.fillRect(W * 0.05, H * 0.955, W * 0.9 * (p / 60), 3); }
    if (st.state === 'paused') { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, W, H); g.beginPath(); g.arc(W / 2, H / 2, H * 0.13, 0, 7); g.fillStyle = 'rgba(0,0,0,.55)'; g.fill(); glyph(g, 'pause', W / 2, H / 2, H * 0.16); }
    this.tex.needsUpdate = true; return true;
  }
  dispose() { this.tex.dispose(); }
}
function shadeHex(hex, k) { const c = new THREE.Color(hex); const t = k < 0 ? 0 : 1; c.lerp(new THREE.Color(t, t, t), Math.abs(k)); return '#' + c.getHexString(); }

// Small floating "♪ title – artist" label (sprite), redrawn on change only.
export class Label {
  constructor() {
    this.c = document.createElement('canvas'); this.c.width = 512; this.c.height = 96; this.g = this.c.getContext('2d'); this.sig = '';
    this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false })); this.sprite.scale.set(0.72, 0.135, 1); this.sprite.renderOrder = 5;
  }
  dispose() { this.tex.dispose(); this.sprite.material.dispose(); }
  set(text, color = '#ffb35c') {
    if (text === this.sig) return; this.sig = text; const g = this.g, W = 512, H = 96; g.clearRect(0, 0, W, H); if (!text) { this.tex.needsUpdate = true; return; }
    g.font = '600 34px system-ui, sans-serif'; const t = ellipsize(g, text, W - 110); const w = g.measureText(t).width + 84;
    rr(g, (W - w) / 2, 14, w, 64, 32); g.fillStyle = 'rgba(11,15,23,.82)'; g.fill(); glyph(g, 'note', (W - w) / 2 + 38, 46, 40, color);
    g.fillStyle = '#fff'; g.fillText(t, (W - w) / 2 + 66, 58); this.tex.needsUpdate = true;
  }
}

/* ---------- generative art (demo and default for new frames) ---------- */
const PALETTES = [['#f2efe6', '#e4572e', '#29335c', '#f3a712', '#669bbc'], ['#fbf8f1', '#2b2d42', '#8d99ae', '#ef233c', '#edf2f4'], ['#f6f1e9', '#264653', '#2a9d8f', '#e9c46a', '#e76f51'], ['#f4f1de', '#3d405b', '#81b29a', '#f2cc8f', '#e07a5f'], ['#101418', '#f4d35e', '#ee964b', '#f95738', '#0d3b66']];
export function generativeArt(seed, w = 512, h = 640) {
  let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pal = PALETTES[Math.floor(rnd() * PALETTES.length)], c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = pal[0]; g.fillRect(0, 0, w, h); const style = Math.floor(rnd() * 3);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = pal[1 + Math.floor(rnd() * 4)]; g.globalAlpha = 0.9;
    const x = rnd() * w, y = rnd() * h, r = (0.08 + rnd() * 0.28) * Math.min(w, h);
    if (style === 0) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    else if (style === 1) { g.fillRect(x - r, y - r * 0.5, r * 2 * (0.4 + rnd()), r * (0.3 + rnd())); }
    else { g.beginPath(); g.arc(x, y, r, rnd() * 6, rnd() * 6 + Math.PI); g.lineTo(x, y); g.fill(); }
  }
  g.globalAlpha = 1; g.strokeStyle = pal[1]; g.lineWidth = Math.max(3, w * 0.012); g.beginPath(); g.moveTo(w * 0.1, h * (0.2 + rnd() * 0.6)); g.bezierCurveTo(w * 0.4, h * rnd(), w * 0.6, h * rnd(), w * 0.9, h * (0.2 + rnd() * 0.6)); g.stroke();
  return c;
}

/* ---------- binding a display surface to an entity ---------- */
// Works for the built-in TV/projector and for every library object with a part of role "screen".
// Entity domains: media_player (artwork, title, app), image, camera (snapshot, refreshed), anything else: on/off.
export function screenMaterial() { return new THREE.MeshStandardMaterial({ color: '#05070c', roughness: 0.22, metalness: 0.1, emissive: '#000000', emissiveIntensity: 1 }); }
export function bindScreen(material, { glowPower = 2.5, aspect = 16 / 9 } = {}) {
  const scr = new Screen(512, Math.round(512 / aspect)); let cur = 0, col = new THREE.Color('#79a6ff'), lastCam = 0, camUrl = null;
  const em = { anchor: null, color: col, power: 0 };
  return {
    emitter: em,
    animating: (s) => !!s && ['playing', 'on', 'idle', 'buffering', 'recording', 'streaming'].includes(s.state),
    update(s, dt, t, env) {
      const media = env.media, dom = s?.entity_id?.split('.')[0], a = s?.attributes || {};
      let state = s?.state, on = ['playing', 'paused', 'on', 'idle', 'buffering'].includes(state), img = null;
      if (dom === 'image' || dom === 'camera') { on = !!s && state !== 'unavailable'; state = 'image';
        if (dom === 'camera') { if (!camUrl || Date.now() - lastCam > (env.perf ? 30000 : 10000)) { camUrl = a.entity_picture; lastCam = Date.now(); } } else camUrl = a.entity_picture;
        img = media?.image(camUrl, { maxAge: dom === 'camera' ? (env.perf ? 30000 : 10000) : 60000 }); }
      else if (on && a.entity_picture) img = media?.image(media.resolve(a.entity_picture) ? a.entity_picture : `/api/media_player_proxy/${s.entity_id}`, { maxAge: 60000 });
      cur += ((on ? 1 : 0) - cur) * Math.min(1, dt * 4);
      if (on) {
        let progress = null; if (a.media_duration > 0 && a.media_position != null) { const p0 = +a.media_position + (state === 'playing' && a.media_position_updated_at ? (Date.now() - Date.parse(a.media_position_updated_at)) / 1000 : 0); progress = Math.max(0, Math.min(1, p0 / a.media_duration)); }
        const playing = state === 'playing' || state === 'buffering';
        scr.draw(state === 'image' ? { state: 'playing', img } : { state: playing ? 'playing' : state, title: a.media_title || a.media_series_title || '', artist: a.media_artist || a.media_album_name || (a.media_series_title && a.media_title ? a.media_series_title : ''), app: a.app_name || a.source || '', img, progress });
        if (material.map !== scr.tex) { material.map = scr.tex; material.emissiveMap = scr.tex; material.color.set('#000000'); material.emissive.set('#ffffff'); material.needsUpdate = true; }
        const tx = scr.tex; // slow pan/zoom ("Ken Burns") only on artwork while playing, never in performance mode
        if (playing && img && !env.perf) { tx.repeat.set(0.95, 0.95); tx.offset.set(0.025 + 0.022 * Math.sin(t * 0.07), 0.025 + 0.022 * Math.cos(t * 0.053)); } else { tx.repeat.set(1, 1); tx.offset.set(0, 0); }
        const c = media?.color(img); if (c) col.copy(c); else col.set(appStyle(a.app_name || a.source || '').color);
        material.emissiveIntensity = cur * (state === 'paused' ? 0.55 : 1);
      } else if (material.map) { material.map = null; material.emissiveMap = null; material.emissive.set('#000000'); material.color.set('#05070c'); material.needsUpdate = true; scr.sig = ''; }
      em.power = cur * glowPower * (state === 'paused' ? 0.5 : 1) * (state === 'image' ? 0.3 : 1);
    },
    dispose() { scr.dispose(); material.dispose(); },
  };
}
