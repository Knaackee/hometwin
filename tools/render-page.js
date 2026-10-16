// Bundled into the headless preview page by render-preview.mjs.
import * as THREE from 'three';
import { buildRecipe, boundsOf } from '../engine/recipe.js';

const W = 480, H = 360;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

function stage(object, size) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xeef2ff, 0x3a3d45, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); const s = Math.max(...size) * 1.5 + 0.5;
  sun.position.set(s * 0.8, s * 1.6, s * 1.2); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.01, far: s * 6 }); sun.shadow.bias = -0.0005; sun.shadow.radius = 4;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(s * 6, s * 6), new THREE.ShadowMaterial({ opacity: 0.18 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'ground'; scene.add(ground);
  object.traverse((m) => { if (m.isMesh && m.material.userData.glow) m.material.emissiveIntensity = 1.2; });
  scene.add(object);
  return scene;
}
function fitPersp(b, dir) {
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 200);
  const c = new THREE.Vector3(...b.center), r = new THREE.Vector3(...b.size).length() / 2 || 0.5;
  const dist = r / Math.sin((cam.fov * Math.PI) / 360) * 1.08;
  cam.position.copy(c).add(new THREE.Vector3(...dir).normalize().multiplyScalar(dist)); cam.lookAt(c); return cam;
}
function fitOrtho(b, view) {
  const [sx, sy, sz] = b.size, [cx, cy, cz] = b.center;
  const [vw, vh] = view === 'front' ? [sx, sy] : view === 'side' ? [sz, sy] : [sx, sz];
  const half = Math.max(vw / 2 / (W / H), vh / 2) * 1.25 + 0.02;
  const cam = new THREE.OrthographicCamera(-half * W / H, half * W / H, half, -half, 0.01, 200);
  const d = Math.max(sx, sy, sz) * 4 + 2;
  if (view === 'front') cam.position.set(cx, cy, cz + d); else if (view === 'side') cam.position.set(cx + d, cy, cz); else { cam.position.set(cx, cy + d, cz); cam.up.set(0, 0, -1); }
  cam.lookAt(cx, cy, cz); return cam;
}
const shot = (scene, cam, bg, groundOn = true) => { scene.getObjectByName('ground').visible = groundOn; renderer.setClearColor(bg ?? 0x000000, bg === undefined ? 0 : 1); renderer.render(scene, cam); const img = new Image(); img.src = renderer.domElement.toDataURL('image/png'); return img.decode().then(() => img); };

window.renderRecipe = async (recipe, params = {}, meta = {}) => {
  const { object, stats } = buildRecipe(recipe, params); const b = boundsOf(object);
  const scene = stage(object, b.size);
  // 1. transparent hero image for the library
  const hero = await shot(scene, fitPersp(b, [1, 0.75, 1.5]));
  const p = document.createElement('canvas'); p.width = W; p.height = H; p.getContext('2d').drawImage(hero, 0, 0);
  const preview = p.toDataURL('image/webp', 0.86);
  // 2. review sheet: 3/4, front, side, top with dimensions
  const views = [['3/4', await shot(scene, fitPersp(b, [1, 0.75, 1.5]), 0xf1f2f4)], ['front (+z)', await shot(scene, fitOrtho(b, 'front'), 0xf1f2f4, false)], ['side (+x), front is left', await shot(scene, fitOrtho(b, 'side'), 0xf1f2f4, false)], ['top, front is down', await shot(scene, fitOrtho(b, 'top'), 0xf1f2f4, false)]];
  const sh = document.createElement('canvas'); sh.width = W * 2 + 30; sh.height = H * 2 + 110; const g = sh.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, sh.width, sh.height);
  g.fillStyle = '#111'; g.font = '600 20px sans-serif'; g.fillText(meta.title || 'recipe', 12, 30);
  g.font = '14px sans-serif'; g.fillStyle = '#444';
  g.fillText(`model: W ${b.size[0].toFixed(3)} × D ${b.size[2].toFixed(3)} × H ${b.size[1].toFixed(3)} m   ·   ${stats.parts} parts · ${stats.triangles} triangles${meta.expected ? `   ·   expected: W ${meta.expected.w} × D ${meta.expected.d} × H ${meta.expected.h} m` : ''}`, 12, 54);
  views.forEach(([label, img], i) => {
    const x = 10 + (i % 2) * (W + 10), y = 70 + Math.floor(i / 2) * (H + 10);
    g.drawImage(img, x, y); g.strokeStyle = '#d0d3d8'; g.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);
    g.fillStyle = '#222'; g.font = '600 13px sans-serif'; g.fillText(label, x + 8, y + 18);
  });
  return { preview, sheet: sh.toDataURL('image/png'), bounds: b, stats };
};
window.ready = true;
