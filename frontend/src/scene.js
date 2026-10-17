import { objectBounds, surfaceElevation, automaticPlacement } from './object-placement.js';
import { clipRoomEffects } from './room-effects.js';
import { t as tr } from './i18n.js';
// The 3D stage: renderer, cameras, levels, sun, shared lights, picking.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildLevel, isIndoor, capMat } from './house.js';
import { buildRoof, buildExtraRoof } from './roof.js';
import { buildFurniture } from './furniture.js';
import { MediaHub, bindScreen, screenMaterial } from './media.js';
import { buildDevice } from './devices.js';
import { planBounds, roomAt, coverPercent } from './plan.js';
import { bbox, pointInPolygon } from './geometry.js';
import { sunVector } from './sun.js';

const LIGHT_POOL = 4;
const EXPLODE_GAP = 3.6;

// Does this device animate in this state (drives the frame rate when nothing else happens)?
function isAnimated(kind, s) {
  const st = s?.state; if (!st) return false;
  switch (kind) {
    case 'tv': return st === 'playing' || st === 'on' || st === 'idle'; case 'speaker': return st === 'playing';
    case 'motion': case 'smoke': return st === 'on'; case 'fan': return st === 'on'; case 'radiator': return s.attributes?.hvac_action === 'heating';
    case 'ac': return ['cooling', 'heating', 'fan', 'drying'].includes(s.attributes?.hvac_action) || (s.entity_id.startsWith('fan.') && st === 'on');
    case 'vacuum': return st === 'cleaning' || st === 'returning'; case 'mower': return st === 'mowing' || st === 'returning'; case 'valve': return st === 'on' || st === 'open';
    case 'camera': return st === 'recording' || st === 'streaming'; case 'washer': case 'fireplace': case 'frame': return true;
    default: return false;
  }
}
export class Stage {
  constructor(canvas, app) {
    this.app = app; this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); this.perf = false;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false; r.info.autoReset = false;
    this._wake = performance.now(); this._next = 0; this._lastShadow = 0; this._shadowDirty = true; this.fpsCount = 0; this.fps = 0; this._fpsT = 0;
    const s = this.scene = new THREE.Scene(); s.background = new THREE.Color('#0b0f17');
    this.persp = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200); this.ortho.up.set(0, 0, -1);
    this.camera = this.persp;
    const c = this.controls = new OrbitControls(this.persp, canvas);
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'touchstart', 'keydown']) canvas.addEventListener(ev, () => this.wake(), { passive: true });
    c.enableDamping = true; c.dampingFactor = 0.08; c.maxPolarAngle = 1.38; c.minDistance = 3; c.maxDistance = 70; c.screenSpacePanning = false;
    const c2 = this.controls2 = new OrbitControls(this.ortho, canvas);
    c2.enableRotate = false; c2.screenSpacePanning = true; c2.enabled = false; c2.minZoom = 0.2; c2.maxZoom = 12;
    c2.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }; c2.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };

    this.hemi = new THREE.HemisphereLight(0x8ea6ff, 0x0b0e17, 0.45); s.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 0); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035; s.add(sun, sun.target);
    this.moon = new THREE.DirectionalLight(0x9fb4ff, 0.35); this.moon.position.set(-20, 30, -10); s.add(this.moon);
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshStandardMaterial({ color: '#151b27', roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.02; this.ground.receiveShadow = true; s.add(this.ground);
    this.pool = []; for (let i = 0; i < LIGHT_POOL; i++) { const l = new THREE.PointLight(0xffffff, 0, 7, 2); l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.0001; l.shadow.normalBias = 0.01; l.shadow.camera.near = 0.05; l.shadow.camera.far = 7; s.add(l); this.pool.push(l); }

    this.composer = new EffectComposer(r);
    this.renderPass = new RenderPass(s, this.persp); this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.55, 0.85); this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.root = new THREE.Group(); s.add(this.root);
    this.grid = new THREE.Group(); this.grid.visible = false; s.add(this.grid);
    this.marks = new THREE.Group(); s.add(this.marks);
    this.overlay = new THREE.Group(); s.add(this.overlay);
    this.levels = new Map();
    this.clock = new THREE.Clock();
    this.ray = new THREE.Raycaster();
    this.day = 0; this.tween = null; this.topView = null;
    this.selHelpers = []; this.handles = [];
    this.running = false;
    this._camDir = new THREE.Vector3(); this._v = new THREE.Vector3();
  }

  /* ---------- building ---------- */
  rebuildAll() {
    for (const id of [...this.levels.keys()]) this.disposeLevel(id);
    for (const l of this.app.plan.levels) this.rebuildLevel(l.id);
    this.layout();
    this.fitSunShadow();
  }
  disposeLevel(id) {
    const o = this.levels.get(id); if (!o) return;
    this.root.remove(o.group);
    for (const e of o.dev.values()) e.built.dispose?.();
    for (const f of o.furnScreens?.values() || []) for (const b of f.screens) b.dispose();
    o.group.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
    this.levels.delete(id);
  }
  rebuildLevel(id) {
    this._shadowDirty = true; this._next = 0;
    const level = this.app.plan.levels.find((l) => l.id === id); const old = this.levels.get(id);
    const underlay = old?.underlay; this.disposeLevel(id); if (!level) return;
    const group = new THREE.Group(); group.userData.level = id;
    const house = buildLevel(this.walk ? { ...level, cutHeight: level.height } : level, this.app.plan.site); group.add(house.group); house.symbols.visible = !!this.topView;
    const furnGroup = new THREE.Group(), devGroup = new THREE.Group(); group.add(furnGroup, devGroup);
    const o = { level, group, house, furnGroup, devGroup, furn: new Map(), dev: new Map(), roof: null, underlay: null };
    this.levels.set(id, o); this.root.add(group);
    for (const f of level.furniture) this.addFurniture(id, f);
    for (const d of level.devices) this.addDevice(id, d);
    for (const f of Object.values(house.floors)) f.userData.level = id;
    for (const h of house.openingHits) h.userData.level = id;
    if (underlay) { o.underlay = underlay; group.add(underlay); }
    this.layout();
    // Keep the sun's shadow frustum around the current house and re-aim the sun.
    this.fitSunShadow(); if (this._sunArgs && !this.topView) { const [a, e, n] = this._sunArgs; this.setSun(a, e, n); }
  }
  place(obj, item) { const bottom = objectBounds(obj).min.y; obj.position.set(item.pos[0], Number.isFinite(item.elevation) && Number.isFinite(bottom) ? item.elevation - bottom : 0, item.pos[1]); obj.rotation.y = ((item.rot || 0) * Math.PI) / 180; }
  itemElevation(levelId, type, id) {
    const o = this.levels.get(levelId), root = type === 'device' ? o?.dev.get(id)?.built.root : o?.furn.get(id);
    if (!root) return 0;
    const bottom = objectBounds(root).min.y;
    return Number.isFinite(bottom) ? bottom + root.position.y : 0;
  }
  supportElevation(levelId, type, id) {
    const o = this.levels.get(levelId), root = type === 'device' ? o?.dev.get(id)?.built.root : o?.furn.get(id);
    if (!root) return 0;
    this.scene.updateMatrixWorld(true);
    return surfaceElevation(root, [...o.furn.values(), ...[...o.dev.values()].map(e => e.built.root)].filter(x => x !== root && x.visible), o.group.position.y);
  }
  addFurniture(levelId, f) {
    const o = this.levels.get(levelId); const obj = buildFurniture(f); obj.userData = { furn: f.id, level: levelId };
    // library objects with a display surface (role "screen") show live content of a bound entity
    const screens = []; obj.traverse((m) => { if (m.isMesh && m.userData.role === 'screen') { m.material = screenMaterial(); m.geometry.computeBoundingBox(); const size = m.geometry.boundingBox.getSize(new THREE.Vector3()); const b = bindScreen(m.material, { glowPower: 1.2, aspect: Math.max(0.2, size.x / Math.max(0.01, size.y)) }); b.emitter.anchor = m; screens.push(b); } });
    o.furnScreens ||= new Map(); if (screens.length) o.furnScreens.set(f.id, { item: f, screens }); else o.furnScreens.delete(f.id);
    this.place(obj, f); obj.visible = !f.hidden; o.furnGroup.add(obj); o.furn.set(f.id, obj); return obj;
  }
  removeFurniture(levelId, id) { const o = this.levels.get(levelId); const obj = o?.furn.get(id); if (obj) { o.furnGroup.remove(obj); o.furn.delete(id); } for (const b of o?.furnScreens?.get(id)?.screens || []) b.dispose(); o?.furnScreens?.delete(id); }
  addDevice(levelId, d) {
    const o = this.levels.get(levelId);
    const built = buildDevice(d, { height: o.level.height });
    const [w, h, dd, y] = built.hit;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.35), Math.max(h, 0.35), Math.max(dd, 0.35)), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = y; hit.userData = { dev: d.id, level: levelId }; built.root.add(hit);
    built.root.traverse((m) => { if (m.isMesh && m !== hit && !m.userData.pool && !m.material.transparent) { m.castShadow = true; m.receiveShadow = true; } });
    this.place(built.root, d); built.root.visible = !d.hidden; o.devGroup.add(built.root);
    const entry = { dev: d, built, hit, room: null }; o.dev.set(d.id, entry); this.updateDeviceRoom(levelId, d.id);
    return entry;
  }
  removeDevice(levelId, id) { const o = this.levels.get(levelId); const e = o?.dev.get(id); if (e) { e.built.dispose?.(); o.devGroup.remove(e.built.root); o.dev.delete(id); } }
  refreshItem(levelId, type, item) {
    if (type === 'device') { this.removeDevice(levelId, item.id); this.addDevice(levelId, item); }
    else if (type === 'furniture') { this.removeFurniture(levelId, item.id); this.addFurniture(levelId, item); }
  }
  moveItem(levelId, type, item) {
    const o = this.levels.get(levelId); const obj = type === 'device' ? o.dev.get(item.id)?.built.root : o.furn.get(item.id);
    if (obj) { this.place(obj, item); this.settleItem(levelId, type, item); } if (type === 'device') this.updateDeviceRoom(levelId, item.id);
  }
  settleAutomaticItems() {
    for (const [levelId, o] of this.levels) {
      const entries = [...o.level.furniture.map(item => ({ item, type: 'furniture', root: o.furn.get(item.id) })), ...o.level.devices.map(item => ({ item, type: 'device', root: o.dev.get(item.id)?.built.root }))].filter(e => e.root && e.root.visible);
      const automatic = entries.filter(e => automaticPlacement(e.item, e.type));
      const supports = entries.filter(e => !automaticPlacement(e.item, e.type)).map(e => e.root);
      // Resolve existing stacks bottom-up; unresolved automatic objects cannot support each other cyclically.
      automatic.sort((a, b) => {
        const height = (a.item.elevation || 0) - (b.item.elevation || 0);
        if (height) return height;
        const size = root => { const b = objectBounds(root); return (b.max.x - b.min.x) * (b.max.z - b.min.z); };
        return size(b.root) - size(a.root) || a.item.id.localeCompare(b.item.id);
      });
      for (const e of automatic) {
        e.item.autoElevation = true;
        this.scene.updateMatrixWorld(true);
        e.item.elevation = surfaceElevation(e.root, supports, o.group.position.y);
        this.place(e.root, e.item); supports.push(e.root);
      }
    }
  }
  settleItem(levelId, type, item) {
    if (!automaticPlacement(item, type)) return;
    item.autoElevation = true;
    item.elevation = this.supportElevation(levelId, type, item.id);
    const o = this.levels.get(levelId), root = type === 'device' ? o?.dev.get(item.id)?.built.root : o?.furn.get(item.id);
    if (root) this.place(root, item);
  }
  updateDeviceRoom(levelId, id) {
    const o = this.levels.get(levelId), e = o.dev.get(id); const r = roomAt(o.level, e.dev.pos);
    e.room = r ? bbox(r.points) : null; e.roomPolygon = r?.points || null; e.roomId = r?.id || null;
    clipRoomEffects(e.built.root, e.roomPolygon);
  }

  /* ---------- level layout / visibility ---------- */
  displayY(level) {
    const idx = this.app.plan.levels.indexOf(level);
    return level.elevation + (this.app.levelSel === 'all' && this.app.explode && this.app.plan.levels.length > 1 ? idx * EXPLODE_GAP : 0);
  }
  topLevel() { return [...this.app.plan.levels].reverse().find((l) => l.rooms.some(isIndoor)) || null; }
  isVisible(level) {
    const s = this.app.levelSel;
    if (s === 'all') return !this.app.hiddenLevels.has(level.id);
    if (s === 'roof') return level === this.topLevel();
    return s === level.id;
  }
  // Swaps every material in a subtree for a faint see-through copy (or back).
  ghost(root, on, opacity = 0.14) {
    this._ghostMats ||= new Map();
    root.traverse((m) => {
      if (!m.isMesh || m.userData.pool) return;
      if (on) {
        if (m.userData.origMat) return; const src = m.material; if (src === undefined || (Array.isArray(src) ? src.some((x) => !x.visible) : !src.visible || src.colorWrite === false)) return;
        const conv = (x) => { if (!this._ghostMats.has(x)) { const c = x.clone(); c.transparent = true; c.opacity = Math.min(x.opacity ?? 1, opacity); c.depthWrite = false; if (c.emissive) c.emissiveIntensity *= 0.3; this._ghostMats.set(x, c); } return this._ghostMats.get(x); };
        m.userData.origMat = src; m.material = Array.isArray(src) ? src.map(conv) : conv(src); m.castShadow = false;
      } else if (m.userData.origMat) { m.material = m.userData.origMat; delete m.userData.origMat; m.castShadow = true; }
    });
  }
  layout() {
    this._shadowDirty = true; this._next = 0;
    const groundLevel = this.app.plan.levels.find(l => l.rooms.some(r => r.kind === "outdoor")) || [...this.app.plan.levels].sort((a, b) => Math.abs(a.elevation) - Math.abs(b.elevation))[0];
    this.ground.position.y = (groundLevel?.elevation ?? 0) - 0.02;
    const plan = this.app.plan; const top = [...plan.levels].reverse().find((l) => l.rooms.some(isIndoor));
    for (const [id, o] of this.levels) {
      o.group.visible = this.isVisible(o.level); o.group.position.y = this.displayY(o.level);
      if (o.roof) { o.group.remove(o.roof.group); o.roof = null; }
      if (this.app.roofOn && !(this.app.levelSel === 'all' && this.app.explode) && top && id === top.id && o.group.visible && !this.topView) { o.roof = buildRoof(o.level, plan.site, isIndoor); o.group.add(o.roof.group); }
      // Roof scope: the top storey is only a faint outline. X-ray: everything above the lowest storey and the roof fade.
      const sel = this.app.levelSel, lowest = plan.levels.find((l) => this.isVisible(l));
      const ghostLevel = !this.topView && ((sel === 'roof' && id === top?.id) || (sel === 'all' && this.app.xray && o.level !== lowest));
      for (const ch of o.group.children) if (ch !== o.roof?.group) this.ghost(ch, ghostLevel);
      if (o.roof) this.ghost(o.roof.group, sel === 'all' && this.app.xray, 0.25);
      if (o.underlay) o.underlay.visible = this.app.mode === 'edit' && this.app.activeLevelId === id && (!!this.topView || !!o.level.underlay?.show3d);
    }
    this.extraRoofs();
  }
  // Additional roofs (garage, carport, garden house …), each on its own storey height.
  extraRoofs() {
    const plan = this.app.plan, sel = this.app.levelSel;
    if (!this.xroofs) { this.xroofs = new THREE.Group(); this.scene.add(this.xroofs); }
    for (const c of [...this.xroofs.children]) { this.xroofs.remove(c); c.traverse((x) => x.geometry?.dispose()); }
    this.xroofBuilt = [];
    const show = this.app.roofOn && !this.topView && ((sel === 'all' && !this.app.explode) || sel === 'roof');
    if (!show) return;
    for (const xr of plan.site.roofs || []) {
      if (!xr.rect || !xr.type || xr.type === 'none') continue; const L = plan.levels.find((l) => l.id === xr.levelId) || plan.levels[0]; if (!L) continue;
      const r = buildExtraRoof(xr, plan.site); r.group.position.y = this.displayY(L); this.xroofs.add(r.group); this.xroofBuilt.push(r);
      if (sel === 'all' && this.app.xray) this.ghost(r.group, true, 0.25);
    }
  }
  levelObj(id) { return this.levels.get(id); }

  /* ---------- underlay (floor plan image) ---------- */
  setUnderlay(levelId, image) {
    const o = this.levels.get(levelId); if (!o) return;
    if (o.underlay) { o.group.remove(o.underlay); o.underlay = null; }
    const u = o.level.underlay; if (!u || !image) return;
    const tex = new THREE.Texture(image); tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
    const w = u.wpx * u.mpp, d = u.hpx * u.mpp;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: u.opacity ?? 0.6, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(u.x0 + w / 2, 0.05, u.z0 + d / 2); m.renderOrder = 3; m.userData.underlay = true;
    o.underlay = m; o.group.add(m); this.layout();
  }
  updateUnderlay(levelId) {
    const o = this.levels.get(levelId), u = o?.level.underlay; if (!o?.underlay || !u) return;
    const w = u.wpx * u.mpp, d = u.hpx * u.mpp; o.underlay.geometry.dispose(); o.underlay.geometry = new THREE.PlaneGeometry(w, d);
    o.underlay.position.set(u.x0 + w / 2, 0.05, u.z0 + d / 2); o.underlay.material.opacity = u.opacity ?? 0.6;
  }

  /* ---------- cameras ---------- */
  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.bloom.resolution.set(w / 2, h / 2);
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    const a = w / h, half = 10; Object.assign(this.ortho, { left: -half * a, right: half * a, top: half, bottom: -half }); this.ortho.updateProjectionMatrix();
  }
  frame(levelId, instant) {
    const plan = this.app.plan; const roofScope = levelId === 'roof'; const lvl = roofScope ? this.topLevel() : levelId && levelId !== 'all' ? plan.levels.find((l) => l.id === levelId) : null;
    const indoor = (lvl ? [lvl] : plan.levels).flatMap((l) => l.rooms.filter(isIndoor).flatMap((r) => r.points));
    const b = indoor.length ? bbox(indoor) : planBounds(plan, lvl);
    const span = Math.max(b.w, b.d, 6);
    const top = this.topLevel(); const y = roofScope && lvl ? this.displayY(lvl) + lvl.height : lvl ? this.displayY(lvl) : top ? (this.displayY(plan.levels[0]) + this.displayY(top) + top.height) / 2 : 0;
    const narrow = this.canvas.clientWidth < 820;
    if (narrow) { // phones: fit by the narrow horizontal field of view, house in the free area above the sheet
      const r = Math.hypot(b.w, b.d) / 2 + 1 + (lvl ? 0 : 2.5);
      return this.fitSphere(new THREE.Vector3(b.cx, y, b.cz), r, THREE.MathUtils.degToRad(this.app.levelSel === 'all' ? 58 : 44), THREE.MathUtils.degToRad(-32), instant);
    }
    const shift = narrow ? 0 : this.app.mode === 'view' ? span * 0.12 : 0;
    const target = new THREE.Vector3(b.cx + shift, y, b.cz + (narrow ? span * 0.25 : 0));
    const all = this.app.levelSel === 'all';
    const dir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(all ? 60 : 44), THREE.MathUtils.degToRad(-32));
    this.moveCam(target, target.clone().add(dir.multiplyScalar(span * (narrow ? 2.3 : all || roofScope ? 1.85 : 1.6) + (all || roofScope ? 5 : 0))), instant);
  }
  // Camera presets: look at the house from a compass direction, or from straight above.
  viewFrom(where) {
    if (this.topView) return;
    const t = this.controls.target.clone(); const dist = Math.max(8, this.persp.position.distanceTo(t));
    if (where === 'top') { this.moveCam(t, t.clone().add(new THREE.Vector3(0.001, dist, 0.001))); return; }
    const az = { N: 0, E: 90, S: 180, W: 270 }[where] ?? 180; const north = this.app.plan.site.north || 0;
    const v = sunVector(az, 0, north); // horizontal unit vector pointing towards that compass direction
    const dir = new THREE.Vector3(v.x, 0, v.z).normalize().multiplyScalar(Math.cos(0.5)).setY(Math.sin(0.5)).normalize();
    this.moveCam(t, t.clone().add(dir.multiplyScalar(dist)));
  }
  fitSphere(center, r, pol, az, instant) {
    const W = this.canvas.clientWidth || 1, H = this.canvas.clientHeight || 1, narrow = W < 820;
    const padR = narrow ? 0 : 380, padB = narrow ? H * 0.48 : 0, padT = narrow ? 110 : 70;
    const vw = Math.max(160, W - padR), vh = Math.max(160, H - padB - padT);
    const fovV = THREE.MathUtils.degToRad(this.persp.fov), fovH = 2 * Math.atan(Math.tan(fovV / 2) * (vw / vh));
    const dist = Math.max(4, (r / Math.sin(Math.min(fovV * (vh / H), fovH) / 2)) * 1.08);
    const dir = new THREE.Vector3().setFromSphericalCoords(1, pol, az), pos = center.clone().add(dir.multiplyScalar(dist));
    const fwd = center.clone().sub(pos).normalize(), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const worldH = 2 * dist * Math.tan(fovV / 2), worldW = worldH * (W / H);
    const off = right.multiplyScalar(worldW * (padR / 2) / W).add(up.multiplyScalar(-worldH * ((padB - padT) / 2) / H));
    this.moveCam(center.clone().add(off), pos.add(off), instant);
  }
  // Whole room in view, seen obliquely from above; keeps the current compass direction and leaves room for the panel.
  frameRoom(level, room) {
    const b = bbox(room.points), y = this.displayY(level) + 0.6;
    const cur = this.persp.position.clone().sub(this.controls.target); let az = Math.atan2(cur.x, cur.z); if (!Number.isFinite(az) || cur.lengthSq() < 1e-6) az = THREE.MathUtils.degToRad(-32);
    const W = this.canvas.clientWidth || 1, H = this.canvas.clientHeight || 1, narrow = W < 820;
    const padR = narrow ? 0 : (this.app.mode === 'view' ? 380 : 360), padB = narrow ? H * 0.48 : 0, padT = narrow ? 120 : 70;
    const vw = Math.max(200, W - padR), vh = Math.max(200, H - padB - padT);
    const fovV = THREE.MathUtils.degToRad(this.persp.fov), fovH = 2 * Math.atan(Math.tan(fovV / 2) * (vw / vh));
    const r = 0.5 * Math.hypot(b.w, b.d) + 0.6, dist = Math.max(4, (r / Math.sin(Math.min(fovV * (vh / H), fovH) / 2)) * 1.2);
    const pol = THREE.MathUtils.degToRad(40); // 40° from vertical: from above, slightly from the side
    const dir = new THREE.Vector3().setFromSphericalCoords(1, pol, az);
    const center = new THREE.Vector3(b.cx, y, b.cz), pos = center.clone().add(dir.clone().multiplyScalar(dist));
    // shift the target so the room sits in the free part of the screen
    const fwd = center.clone().sub(pos).normalize(), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const worldH = 2 * dist * Math.tan(fovV / 2), worldW = worldH * (W / H);
    const off = right.multiplyScalar(worldW * (padR / 2) / W).add(up.multiplyScalar(-worldH * ((padB - padT) / 2) / H));
    this.moveCam(center.clone().add(off), pos.add(off));
  }
  focusPoint([x, z], y, radius) {
    const target = new THREE.Vector3(x, y, z); const dir = this.persp.position.clone().sub(this.controls.target).normalize();
    this.moveCam(target, target.clone().add(dir.multiplyScalar(radius * 1.9 + 3)));
  }
  moveCam(target, pos, instant) {
    if (instant) { this.controls.target.copy(target); this.persp.position.copy(pos); this.controls.update(); this.tween = null; return; }
    this.tween = { t: 0, ft: this.controls.target.clone(), fp: this.persp.position.clone(), tt: target, tp: pos };
  }
  setTopView(levelId) {
    const l = this.app.plan.levels.find((x) => x.id === levelId); if (!l) return;
    const b = planBounds(this.app.plan, l); const y = this.displayY(l);
    if (!this.topView) { this.ortho.position.set(b.cx, y + 60, b.cz); this.controls2.target.set(b.cx, y, b.cz); this.ortho.zoom = Math.min(3, 15 / Math.max(b.w, b.d, 8)); this.ortho.updateProjectionMatrix(); }
    this.topView = levelId; this.camera = this.ortho; this.renderPass.camera = this.ortho;
    this.controls.enabled = false; this.controls2.enabled = true; this.controls2.update();
    this.grid.clear(); const g = new THREE.GridHelper(80, 80, 0x3a4660, 0x232b3d); g.material.transparent = true; g.material.opacity = 0.55; g.material.depthWrite = false; g.position.set(Math.round(b.cx), y + 0.003, Math.round(b.cz)); this.grid.add(g); this.grid.visible = true;
    this.applyLighting(); this.layout();
  }
  exitTopView() { if (!this.topView) return; this.topView = null; this.camera = this.persp; this.renderPass.camera = this.persp; this.controls.enabled = true; this.controls2.enabled = false; this.grid.visible = false; this.setMarks(null); this.applyLighting(); this.layout(); }

  /* ---------- sun & sky ---------- */
  setSun(az, el, north) {
    this._sunArgs = [az, el, north]; if (this.topView) return this.applyLighting();
    const day = THREE.MathUtils.smoothstep(el, -4, 10); this.day = day;
    const v = sunVector(az, el, north); const b = this._bounds || { cx: 0, cz: 0 };
    this.sun.position.set(b.cx + v.x * 50, Math.max(v.y, 0.02) * 50, b.cz + v.z * 50); this.sun.target.position.set(b.cx, 0, b.cz);
    const warm = THREE.MathUtils.smoothstep(el, 0, 25);
    this.sun.color.setRGB(1, 0.72 + 0.26 * warm, 0.5 + 0.45 * warm); this.sun.intensity = day * 3.6;
    this.sun.castShadow = day > 0.02; this.moon.intensity = 0.35 * (1 - day);
    this.hemi.intensity = 0.45 + day * 0.5; this.hemi.color.set('#8ea6ff').lerp(new THREE.Color('#dfe9ff'), day); this.hemi.groundColor.set('#0b0e17').lerp(new THREE.Color('#4a4438'), day);
    this.scene.background.set('#0b0f17').lerp(new THREE.Color('#3a4a66'), day);
    this.ground.material.color.set('#151b27').lerp(new THREE.Color('#5b6650'), day);
    this.bloom.strength = 0.5 - day * 0.28;
  }
  // Plan (top) view uses neutral, even light regardless of the time of day.
  applyLighting() {
    if (!this.topView) { capMat.color.set('#262b3a'); for (const o of this.levels.values()) o.house.symbols.visible = false; if (this._sunArgs) { const [a, e, n] = this._sunArgs; this._sunArgs = null; this.setSun(a, e, n); } return; }
    capMat.color.set('#dfe5ef'); for (const o of this.levels.values()) o.house.symbols.visible = true;
    this.day = 1; this.sun.intensity = 0; this.sun.castShadow = false; this.moon.intensity = 0;
    this.hemi.intensity = 2.2; this.hemi.color.set('#ffffff'); this.hemi.groundColor.set('#9aa3b5');
    this.scene.background.set('#0f1421'); this.ground.material.color.set('#151b27'); this.bloom.strength = 0;
  }
  fitSunShadow() {
    const indoor = this.app.plan.levels.flatMap((l) => l.rooms.filter(isIndoor).flatMap((r) => r.points));
    const b = indoor.length ? bbox(indoor) : planBounds(this.app.plan); this._bounds = b; const half = Math.max(b.w, b.d) / 2 + 8;
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 140 }); this.sun.shadow.camera.updateProjectionMatrix();
  }

  /* ---------- picking ---------- */
  setRay(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
  }
  pick(e, { furniture = false, handles = false, levelId = null } = {}) {
    this.setRay(e);
    const vis = [...this.levels.values()].filter((o) => o.group.visible && (!levelId || o.level.id === levelId));
    if (handles && this.handles.length) { const h = this.ray.intersectObjects(this.handles, false)[0]; if (h) return { type: 'handle', ...h.object.userData }; }
    const deviceMeshes = [], owners = new Map();
    for (const o of vis) for (const e of o.dev.values()) if (!e.dev.hidden) e.built.root.traverseVisible(mesh => {
      if (!mesh.isMesh || mesh === e.hit || mesh.userData.pool || mesh.userData.roomEffect || mesh.material?.visible === false) return;
      deviceMeshes.push(mesh); owners.set(mesh, { id: e.dev.id, level: o.level.id });
    });
    const visibleDevice = this.ray.intersectObjects(deviceMeshes, false)[0];
    const dh = visibleDevice || this.ray.intersectObjects(vis.flatMap(o => [...o.dev.values()].filter(x => !x.dev.hidden).map(x => x.hit)), false)[0];
    const oh = this.ray.intersectObjects(vis.flatMap((o) => o.house.openingHits), false)[0];
    let fh = null;
    { const x = this.ray.intersectObjects(vis.flatMap((o) => o.furnGroup.children.filter((c) => c.visible)), true)[0]; if (x) { let ob = x.object; while (ob && !ob.userData.furn) ob = ob.parent; if (ob) fh = { d: x.distance, type: 'furniture', id: ob.userData.furn, level: ob.userData.level }; } }
    const device = dh && { d: dh.distance, type: 'device', ...(visibleDevice ? owners.get(dh.object) : { id: dh.object.userData.dev, level: dh.object.userData.level }) };
    // Generous touch targets must not intercept a visible object in front of them.
    const cands = [(visibleDevice || !fh) && device, oh && { d: oh.distance + 0.3, type: 'opening', id: oh.object.userData.opening, level: oh.object.userData.level }, fh].filter(Boolean).sort((a, b) => a.d - b.d);
    if (furniture) { const roofs = [...this.levels.values()].filter((o) => o.group.visible && o.roof?.panels?.length); const sh = this.ray.intersectObjects(roofs.flatMap((o) => o.roof.panels), false)[0]; if (sh && (!cands[0] || sh.distance < cands[0].d)) return { type: 'solar', id: sh.object.userData.solar, level: roofs[0].level.id }; }
    { const roofs = [...this.levels.values()].filter((o) => o.group.visible && o.roof?.items?.length && o.roof.group.visible); const ri = this.ray.intersectObjects(roofs.flatMap((o) => o.roof.items), false)[0]; if (ri && (!cands[0] || ri.distance < cands[0].d)) return { type: 'roofitem', id: ri.object.userData.roofItem, level: roofs[0].level.id }; }
    if (furniture && this.xroofs?.children.length) { const xh = this.ray.intersectObject(this.xroofs, true)[0]; if (xh && (!cands[0] || xh.distance < cands[0].d)) { let ob = xh.object; while (ob && !ob.userData.xroof) ob = ob.parent; if (ob) return { type: 'xroof', id: ob.userData.xroof }; } }
    if (cands[0]) return cands[0];
    const rh = this.ray.intersectObjects(vis.flatMap((o) => Object.values(o.house.floors)), false);
    const indoor = rh.find((h) => { const r = this.app.findRoom(h.object.userData.level, h.object.userData.room); return r && r.kind !== 'outdoor'; }) || rh[0];
    if (indoor) return { type: 'room', id: indoor.object.userData.room, level: indoor.object.userData.level };
    return null;
  }
  // Point on a pitched roof plane: { plane, u, v } in that plane's frame.
  roofPlanePoint(e) {
    this.setRay(e);
    const o = [...this.levels.values()].find((x) => x.roof?.planes?.length && x.group.visible); if (!o) return null;
    const ms = o.roof.planes.filter((p) => p.mesh && !p.flat).map((p) => p.mesh);
    const h = this.ray.intersectObjects(ms, false)[0]; if (!h) return null;
    const idx = h.object.userData.roofPlane, f = o.roof.planes[idx].frame;
    const lp = o.roof.local.worldToLocal(h.point.clone()).sub(f.origin);
    return { plane: idx, u: lp.dot(f.u), v: lp.dot(f.v), slope: f.slope, width: f.width };
  }
  // Point on the floor plane of a level, in that level's plan coordinates.
  floorPoint(e, levelId) {
    const l = this.app.plan.levels.find((x) => x.id === levelId); if (!l) return null;
    this.setRay(e); const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.displayY(l)), p)) return null;
    return [p.x, p.z];
  }

  /* ---------- editor overlays ---------- */
  select(sel, extras = []) {
    for (const h of this.selHelpers) this.overlay.remove(h); this.selHelpers = [];
    if (!sel) return;
    for (const x of [sel, ...extras]) this._selOne(x, x === sel ? 0x79a6ff : 0xffb35c);
  }
  _selOne(sel, color) {
    const o = this.levels.get(sel.level); if (!o) return;
    let target = null;
    if (sel.type === 'device') target = o.dev.get(sel.id)?.hit;
    if (sel.type === 'furniture') target = o.furn.get(sel.id);
    if (sel.type === 'opening' && !this.topView) {
      const op = o.level.openings.find((x) => x.id === sel.id); if (!op) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(op.to[0] - op.from[0], op.to[1] - op.from[1]) + 0.2, 2.3, 0.5));
      m.position.set((op.from[0] + op.to[0]) / 2, this.displayY(o.level) + 1.15, (op.from[1] + op.to[1]) / 2); m.rotation.y = Math.atan2(-(op.to[1] - op.from[1]), op.to[0] - op.from[0]); m.updateMatrixWorld(); target = m;
    }
    if (target) { const h = new THREE.BoxHelper(target, color); h.material.depthTest = false; h.renderOrder = 9; this.overlay.add(h); this.selHelpers.push(h); }
  }
  setHandles(level, room, noMid = false) {
    for (const h of this.handles) this.overlay.remove(h); this.handles = [];
    if (!room) return;
    const y = this.displayY(level) + 0.08;
    const vm = new THREE.MeshBasicMaterial({ color: '#79a6ff', depthTest: false }), mm = new THREE.MeshBasicMaterial({ color: '#e7ebf2', depthTest: false, transparent: true, opacity: 0.7 });
    const scale = this.topView ? 0.6 / this.ortho.zoom : 1;
    room.points.forEach((p, i) => {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), vm); v.scale.setScalar(scale); v.position.set(p[0], y, p[1]); v.renderOrder = 10; v.userData = { handle: i, room: room.id, level: level.id }; this.overlay.add(v); this.handles.push(v);
      const q = room.points[(i + 1) % room.points.length];
      if (noMid) return;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), mm); m.scale.setScalar(scale); m.position.set((p[0] + q[0]) / 2, y, (p[1] + q[1]) / 2); m.renderOrder = 10; m.userData = { handle: i, mid: true, room: room.id, level: level.id }; this.overlay.add(m); this.handles.push(m);
    });
  }
  // Thick highlight bars (wall under the cursor, ghost opening, selected opening) above the walls.
  setMarks(level, bars = []) {
    this.marks.clear(); if (!level) return;
    const y = this.displayY(level) + level.height + 0.14;
    for (const { a, b, color = '#79a6ff', width = 0.3, opacity = 0.75 } of bars) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.01) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, width), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
      m.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2); m.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); m.renderOrder = 12; this.marks.add(m);
    }
  }
  setPreview(points, levelId, closed = false) {
    if (this.preview) { this.overlay.remove(this.preview); this.preview.geometry.dispose(); this.preview = null; }
    if (!points || points.length < 2) return;
    const l = this.app.plan.levels.find((x) => x.id === levelId); const y = (l ? this.displayY(l) : 0) + 0.1;
    const g = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, y, z)));
    this.preview = new (closed ? THREE.LineLoop : THREE.Line)(g, new THREE.LineBasicMaterial({ color: '#79a6ff', depthTest: false }));
    this.preview.renderOrder = 11; this.overlay.add(this.preview);
  }

  /* ---------- loop ---------- */
  // Leistungsmodus (phones/tablets): lower resolution, no bloom, smaller shadow map.
  setPerf(on) {
    this.perf = !!on; const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(on ? Math.min(dpr, 1.25) : Math.min(dpr, 2)); this.bloom.enabled = !on;
    this.sun.shadow.mapSize.set(on ? 1024 : 2048, on ? 1024 : 2048); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    for (const light of this.pool) { light.shadow.mapSize.set(on ? 256 : 512, on ? 256 : 512); light.shadow.map?.dispose(); light.shadow.map = null; }
    this._shadowDirty = true; this.resize?.();
  }
  // "Walls rise": storeys grow out of the ground (after the plan wizard, and when the dashboard opens).
  // Groups are looked up by id every frame, so a rebuild during the animation does not break it.
  riseLevel(id, ms = 1400) { this.startRise([{ id, delay: 0, ms }]); }
  riseAll() {
    const ls = this.app.plan.levels; if (!ls.length) return;
    const items = ls.map((l, i) => ({ id: l.id, delay: i * 520, ms: 1150 })); items.push({ id: '__xroofs', delay: ls.length * 520 - 300, ms: 900 });
    this.startRise(items);
  }
  startRise(items) {
    const shadow = this.rise ? this.rise.shadow : this.sun.castShadow;
    this.rise = { t0: performance.now(), items, shadow }; this.sun.castShadow = false;
    for (const it of items) { const o = this.levels.get(it.id); if (o?.underlay) o.underlay.visible = false; }
    this.applyRise();
  }
  applyRise() {
    const r = this.rise; if (!r) return; const now = performance.now(); let done = true;
    for (const it of r.items) {
      const g = it.id === '__xroofs' ? this.xroofs : this.levels.get(it.id)?.group; if (!g) continue;
      const k = Math.max(0, Math.min(1, (now - r.t0 - it.delay) / it.ms)); if (k < 1) done = false;
      g.scale.y = k <= 0 ? 0.001 : k < 1 ? Math.max(0.001, 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2)) : 1;
    }
    if (done) { this.rise = null; this.sun.castShadow = r.shadow; this.layout(); }
  }
  // Speakers playing as a group (e.g. Sonos) are joined by a faint pulsing line.
  speakerGroups(pos, t) {
    const pairs = []; if (pos) for (const [id, p] of Object.entries(pos)) for (const m of p.m) if (m > id && pos[m] && p.room && p.room === pos[m].room) pairs.push([p, pos[m]]);
    const sig = JSON.stringify(pairs.map(([a, b]) => [a.toArray(), b.toArray(), a.polygon]));
    if (sig !== this._grpSig) {
      this._grpSig = sig;
      if (this.grpLines) { this.scene.remove(this.grpLines); this.grpLines.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
      this.grpLines = new THREE.Group();
      for (const [a, b] of pairs) {
        const mid = a.clone().add(b).multiplyScalar(0.5); mid.y += 0.4 + a.distanceTo(b) * 0.08;
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(24), points = [];
        for (let i = 1; i < curve.length; i++) points.push(curve[i - 1], curve[i]);
        const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.5, depthWrite: false }));
        line.renderOrder = 4; line.userData.roomEffect = true; clipRoomEffects(line, a.polygon); this.grpLines.add(line);
      }
      this.scene.add(this.grpLines);
    }
    this.grpLines?.traverse(o => { if (o.material) o.material.opacity = this.perf ? 0.45 : 0.3 + 0.25 * Math.sin(t * 2.4); });
  }
  /* ---------- walkthrough (first person) ---------- */
  // Eye height = body height × 0.93. Moves with WASD/arrows (Shift = faster), looks by dragging; touch: joystick + drag.
  enterWalk(level, at, body = 1.75) {
    if (this.topView) this.exitTopView();
    this.tween = null; this.controls.enabled = false;
    const yaw = Math.atan2(this.persp.position.x - this.controls.target.x, this.persp.position.z - this.controls.target.z);
    this.walk = { levelId: level.id, body, x: at[0], z: at[1], yaw: Number.isFinite(yaw) ? yaw : 0, pitch: -0.08, keys: new Set(), joy: [0, 0] };
    this._savedFov = this.persp.fov; this.persp.fov = 62; this.persp.near = 0.05; this.persp.updateProjectionMatrix();
    this.rebuildAll(); this.layout(); this.walkStep(0);
  }
  exitWalk() {
    if (!this.walk) return; const w = this.walk; this.walk = null;
    this.persp.fov = this._savedFov || 36; this.persp.near = 0.1; this.persp.updateProjectionMatrix(); this.controls.enabled = true;
    this.rebuildAll(); this.layout();
    const L = this.app.plan.levels.find((l) => l.id === w.levelId); if (L) this.controls.target.set(w.x, this.displayY(L), w.z);
  }
  walkStep(dt) {
    const w = this.walk, L = this.app.plan.levels.find((l) => l.id === w.levelId); if (!L) return;
    this.controls.enabled = false;
    const k = w.keys, run = k.has('shift') ? 2.6 : 1.4; let f = 0, s = 0;
    if (k.has('w') || k.has('arrowup')) f += 1; if (k.has('s') || k.has('arrowdown')) f -= 1;
    if (k.has('a')) s -= 1; if (k.has('d')) s += 1;
    if (k.has('arrowleft') || k.has('q')) w.yaw += dt * 1.8; if (k.has('arrowright') || k.has('e')) w.yaw -= dt * 1.8;
    f += -w.joy[1]; s += w.joy[0];
    const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw), rx = Math.cos(w.yaw), rz = -Math.sin(w.yaw);
    const len = Math.hypot(f, s) || 1, sp = Math.min(1, Math.hypot(f, s)) * run * dt;
    if (sp > 0) { w.x += ((fx * f + rx * s) / len) * sp; w.z += ((fz * f + rz * s) / len) * sp; }
    const eye = this.displayY(L) + w.body * 0.93;
    this.persp.position.set(w.x, eye, w.z);
    const cp = Math.cos(w.pitch); this.controls.target.set(w.x + -Math.sin(w.yaw) * cp, eye + Math.sin(w.pitch), w.z + -Math.cos(w.yaw) * cp);
    this.persp.lookAt(this.controls.target);
  }
  walkLook(dx, dy) { const w = this.walk; if (!w) return; w.yaw -= dx * 0.005; w.pitch = Math.max(-1.2, Math.min(1.1, w.pitch - dy * 0.004)); }
  // Frame pacing: full rate while the user interacts or something moves the camera; 30 fps while
  // devices animate; 4 fps when nothing happens (tablets stay cool). Shadows are re-rendered only on change.
  invalidate() { this._next = 0; } // render the next frame (state change), without switching to full rate
  wake(shadow = false) { this._wake = performance.now(); this._next = 0; if (shadow) this._shadowDirty = true; }
  start() { if (this.running) return; this.running = true; this.clock.getDelta(); const loop = (now) => { if (!this.running) return; this.raf = requestAnimationFrame(loop); if (now < this._next) return; this.tick(); }; this.raf = requestAnimationFrame(loop); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  tick() {
    const dt = Math.min(0.05, this.clock.getDelta()), t = this.clock.elapsedTime, app = this.app; let anim = false, animGeom = false, groupPos = null;
    this.renderer.info.reset();
    if (this.tween) { const tw = this.tween; tw.t = Math.min(1, tw.t + dt * 1.6); const k = 1 - Math.pow(1 - tw.t, 3); this.controls.target.lerpVectors(tw.ft, tw.tt, k); this.persp.position.lerpVectors(tw.fp, tw.tp, k); if (tw.t >= 1) this.tween = null; }
    if (this.rise) this.applyRise();
    if (this.walk) this.walkStep(dt); else if (this.topView) this.controls2.update(); else this.controls.update();
    const cd = this._camDir.copy(this.persp.position).sub(this.controls.target); cd.y = 0; cd.normalize();
    const states = app.states(); const env = { day: this.day > 0.5, editing: app.mode === 'edit', showCones: false, room: null, media: (this.media ||= new MediaHub(app)), perf: this.perf };
    const emitters = []; const wp = this._v;
    for (const o of this.levels.values()) {
      if (!o.group.visible) continue;
      const cut = !this.topView && !this.walk && (!app.roofOn || (app.levelSel === 'all' && app.explode));
      for (const e of o.house.exterior) { const near = cut && e.nx * cd.x + e.nz * cd.z > 0.15; e.full.visible = !near; e.curb.visible = near; }
      for (const op of o.level.openings) {
        const w = o.house.windows[op.id];
        if (w) {
          if (op.cover) {
            const s = states[op.cover]; const p = s ? (coverPercent(s, op.coverInvert) ?? 100) / 100 : 1; if (Math.abs(p - w.cur) > 0.002) animGeom = true; w.cur += (p - w.cur) * Math.min(1, dt * 3); w.shutter.visible = true; w.shutter.scale.y = Math.max(0.02, 1 - w.cur);
            const tilt = s?.attributes?.current_tilt_position; // venetian blinds: open slats let light through
            if (tilt != null) { if (!w.shutter.userData.ownMat) { w.shutter.material = w.shutter.material.clone(); w.shutter.userData.ownMat = true; w.shutter.material.transparent = true; } w.shutter.material.opacity = 1 - (tilt / 100) * 0.6; }
          } else w.shutter.visible = false;
          const open = op.contact && states[op.contact]?.state === 'on'; w.glassMat.emissive.set(open ? '#ff7a45' : '#3d5fae'); w.glassMat.opacity = open ? 0.4 : 0.22;
        }
        const d = o.house.doors[op.id];
        if (d) { const tgt = op.contact ? (states[op.contact]?.state === 'on' ? 1.3 : 0) : d.ext ? 0 : 1.15; if (Math.abs(tgt - d.cur) > 0.002) animGeom = true; d.cur += (tgt - d.cur) * Math.min(1, dt * 4); d.hinge.rotation.y = d.base + d.swing * d.cur; }
        const gd = o.house.garages[op.id];
        if (gd) { const s = op.cover ? states[op.cover] : null; const p = s ? (s.attributes.current_position ?? (['open', 'opening'].includes(s.state) ? 100 : 0)) / 100 : 0; if (Math.abs(p - gd.cur) > 0.002) animGeom = true; gd.cur += (p - gd.cur) * Math.min(1, dt * 1.5); gd.panel.scale.y = Math.max(0.03, 1 - gd.cur); }
      }
      for (const e of o.dev.values()) {
        env.room = e.room; const est = e.dev.entity_id ? states[e.dev.entity_id] : null; e.built.update(est, dt, t, env); if (e.built.animating ? e.built.animating(est) : isAnimated(e.dev.kind, est)) anim = true;
        if (est?.state === 'playing' && est.attributes?.group_members?.length > 1) { (groupPos ||= {})[est.entity_id] = e.built.root.getWorldPosition(new THREE.Vector3()); groupPos[est.entity_id].y += 0.35; groupPos[est.entity_id].m = est.attributes.group_members; groupPos[est.entity_id].room = e.roomId ? `${o.level.id}:${e.roomId}` : null; groupPos[est.entity_id].polygon = e.roomPolygon; }
        for (const em of e.built.emitters) if (em.power > 0.05) { em.anchor.getWorldPosition(wp); emitters.push({ x: wp.x, y: wp.y, z: wp.z, color: em.color, power: em.power }); }
      }
      if (o.furnScreens) for (const { item, screens } of o.furnScreens.values()) { const est = item.entity_id ? states[item.entity_id] : null; for (const b of screens) { b.update(est, dt, t, env); if (b.animating(est)) anim = true; if (b.emitter.power > 0.05) { b.emitter.anchor.getWorldPosition(wp); emitters.push({ x: wp.x, y: wp.y, z: wp.z, color: b.emitter.color, power: b.emitter.power }); } } }
      o.roof?.update(states, t);
      for (const r of o.level.rooms) {
        const ov = o.house.overlays[r.id]; if (!ov) continue; let op = 0;
        const tint = app.roomTint(o.level, r); if (tint) { ov.material.color.set(tint.color); op = tint.opacity; }
        ov.material.opacity += (op - ov.material.opacity) * Math.min(1, dt * 8);
      }
    }
    this.speakerGroups(groupPos, t);
    emitters.sort((a, b) => b.power - a.power);
    const damp = 1 - 0.55 * this.day;
    this.pool.forEach((l, i) => { const em = emitters[i]; if (em && (l.position.x !== em.x || l.position.y !== em.y || l.position.z !== em.z)) this._shadowDirty = true; if (em) { l.position.set(em.x, em.y, em.z); l.color.copy(em.color); l.intensity = this.perf && i >= 2 ? 0 : em.power * damp; } else l.intensity = 0; });
    for (const h of this.selHelpers) h.update();
    const now = performance.now(), interactive = now - this._wake < 2500 || this.tween || this.rise || this.walk || app._down;
    const animMove = animGeom || !!this.rise || (app.mode === 'edit' && app._down);
    if (this._shadowDirty || animMove || now - this._lastShadow > 1000) { this.renderer.shadowMap.needsUpdate = true; this._lastShadow = now; this._shadowDirty = false; }
    this.composer.render();
    this._next = interactive || animGeom ? 0 : now + (anim ? 1000 / 30 : 250); this.pace = interactive || animGeom ? tr('media.active') : anim ? tr('media.animated') : tr('media.idle');
    this.fpsCount++; if (now - this._fpsT > 1000) { this.fps = Math.round((this.fpsCount * 1000) / (now - this._fpsT)); this.fpsCount = 0; this._fpsT = now; }
    app.onFrame?.();
  }
  project(x, y, z) { const v = this._v.set(x, y, z).project(this.camera); return [(v.x * 0.5 + 0.5) * this.canvas.clientWidth, (-v.y * 0.5 + 0.5) * this.canvas.clientHeight, v.z]; }
  dispose() { this.stop(); this.renderer.dispose(); this.renderer.forceContextLoss(); }
}
