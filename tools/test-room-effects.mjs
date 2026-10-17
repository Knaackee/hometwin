import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' };
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('outside repository');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('content-type', types[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 620, height: 620 } });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.setContent(`<canvas></canvas><script type="importmap">{"imports":{"three":"${base}/node_modules/three/build/three.module.js"}}</script><script type="module">
    import * as THREE from '${base}/node_modules/three/build/three.module.js';
    import { clipRoomEffects } from '${base}/frontend/src/room-effects.js';
    const canvas = document.querySelector('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(600, 600, false); renderer.setClearColor(0x000000, 1);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 20); camera.position.set(0, 10, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const root = new THREE.Group(); root.position.set(0.6, 0, 0.4); root.rotation.y = 0.55; scene.add(root);
    const effect = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide }));
    effect.rotation.x = -Math.PI / 2; effect.userData.roomEffect = true; root.add(effect);
    const pixel = new Uint8Array(4), gl = renderer.getContext();
    function sample(x, z) { const p = new THREE.Vector3(x, 0, z).project(camera); gl.readPixels(Math.round((p.x + 1) * 300), Math.round((p.y + 1) * 300), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return [...pixel]; }
    function render(points) { clipRoomEffects(root, points); renderer.render(scene, camera); return { insideA: sample(-1, 1), insideB: sample(1, -1), outsideNotch: sample(1, 1), outsideRoom: sample(2.5, 1.5) }; }
    const concave = render([[-2,-2],[2,-2],[2,0],[0,0],[0,2],[-2,2]]);
    const hidden = render(null);
    const moved = render([[0.4,0.4],[2.1,0.4],[2.1,2.1],[0.4,2.1]]);
    const shared = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const sharedA = new THREE.Group(), sharedB = new THREE.Group();
    const effectA = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shared), effectB = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shared);
    effectA.userData.roomEffect = effectB.userData.roomEffect = true; sharedA.add(effectA); sharedB.add(effectB);
    clipRoomEffects(sharedA, [[0,0],[1,0],[1,1]]); clipRoomEffects(sharedB, [[2,2],[3,2],[3,3]]);
    window.renderRoomEffect = render; window.concaveRoom = [[-2,-2],[2,-2],[2,0],[0,0],[0,2],[-2,2]];
    window.roomEffectResult = { concave, hidden, moved, sharedCloned: effectA.material !== effectB.material };
  </script>`);
  try { await page.waitForFunction(() => window.roomEffectResult, null, { timeout: 10000 }); }
  catch (error) { throw new Error(`room-effect fixture did not finish: ${errors.join(' | ') || error.message}`); }
  const result = await page.evaluate(() => window.roomEffectResult);
  const red = (pixel) => pixel[0] > 220 && pixel[1] < 30 && pixel[2] < 30 && pixel[3] === 255;
  const black = (pixel) => pixel[0] < 10 && pixel[1] < 10 && pixel[2] < 10 && pixel[3] === 255;
  assert.ok(red(result.concave.insideA), `concave inside A was ${result.concave.insideA}`);
  assert.ok(red(result.concave.insideB), `concave inside B was ${result.concave.insideB}`);
  assert.ok(black(result.concave.outsideNotch), `concave notch was ${result.concave.outsideNotch}`);
  assert.ok(black(result.concave.outsideRoom), `outside room was ${result.concave.outsideRoom}`);
  Object.values(result.hidden).forEach((pixel) => assert.ok(black(pixel), `null-room effect was ${pixel}`));
  assert.ok(red(result.moved.outsideNotch), `updated room inside was ${result.moved.outsideNotch}`);
  assert.ok(black(result.moved.insideA), `updated room outside was ${result.moved.insideA}`);
  assert.equal(result.sharedCloned, true, 'shared effect materials must be cloned per device root');
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.renderRoomEffect(window.concaveRoom));
  await page.locator('canvas').screenshot({ path: resolve(root, '.preview/room-effects-concave.png') });
  console.log('PASS: world-space concave room clipping, transformed source, room update and null-room hiding');
} finally {
  await browser.close();
  server.close();
}
