import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// A recognition without usable rooms must end in a clear error with the model answer available,
// never in an empty review step.
const base = process.env.HOMETWIN_TEST_URL || 'http://127.0.0.1:4173/demo/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('hometwin-panel')?.plan);
    await page.evaluate(async () => {
      const app = document.querySelector('hometwin-panel'), wz = app.wizard; app.stage.stop();
      wz.runJob = async () => { wz.jobId = 'j1'; return { rooms: [], openings: [], stairs: [] }; };
      wz.open({ levelId: '__new' }); wz.ai = { configured: true, model: 'anthropic/claude-opus-5.5' };
      const img = document.createElement('canvas'); img.width = 2400; img.height = 1800; const g = img.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 2400, 1800);
      wz.st.src = img; wz.st.srcName = 'plan.png'; wz.render(); await wz.next(); await wz.next();
      wz.st.measure = { a: [100, 100], b: [600, 100], m: '10' }; wz.st.opts.refine = false; wz.recalc(); wz.render();
      wz.st.busy = false; await wz.detect();
    });
    const panel = page.locator('hometwin-panel');
    assert.equal(await page.evaluate(() => document.querySelector('hometwin-panel').wizard.st.step), 3, 'stays on the recognition step');
    assert.match(await panel.locator('.wz-side .warn').first().innerText(), /without rooms/);
    assert.ok(await page.evaluate(() => { const im = document.querySelector('hometwin-panel').wizard.modelImage(); return Math.max(im.w, im.h) <= 1568; }), 'model image fits 1568 px');
    // Refinement must retain the same image coordinates, including the far edge.
    const aligned = await page.evaluate(async () => {
      const wz = document.querySelector('hometwin-panel').wizard;
      const source = document.createElement('canvas'); source.width = 2400; source.height = 1800;
      const g = source.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 2400, 1800);
      g.fillStyle = '#f00'; g.fillRect(2370, 0, 30, 1800);
      const previous = wz.st.img; wz.st.img = source;
      const im = wz.modelImage(), url = wz.overlayImage(im, []); wz.st.img = previous;
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = im.w; canvas.height = im.h;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const [r, g2, b] = ctx.getImageData(im.w - 5, Math.floor(im.h / 2), 1, 1).data;
      return r > 200 && g2 < 50 && b < 50;
    });
    assert.ok(aligned, 'refinement overlay preserves the right edge at the model image scale');
    assert.equal(await panel.locator('[data-act="copyRaw"]').count(), 1);
    // The demo's simulated Home Assistant is replaced on every state push, so patch it right before the call.
    await page.evaluate(() => { const app = document.querySelector('hometwin-panel'); const ws = app.hass.callWS.bind(app.hass);
      app.hass.callWS = async (m) => m.type === 'hometwin/agent/job' && m.with_raw ? { job: { model: 'anthropic/claude-opus-5.5', status: 'done', rooms_raw: 0, rooms_used: 0, raw: 'I could not find rooms {sorry}' } } : ws(m);
      return app.wizard.copyRaw(); });
    await page.waitForFunction(() => !document.querySelector('hometwin-panel').shadowRoot.querySelector('#wzRaw').hidden);
    const raw = await panel.locator('#wzRaw').inputValue();
    assert.match(raw, /claude-opus-5\.5/); assert.match(raw, /could not find rooms/);
    await page.screenshot({ path: `.preview/detect-diagnostics-${mobile ? 'mobile' : 'desktop'}.png` });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS: empty recognition shows an error with the copyable model answer, desktop/mobile');
} finally { await browser.close(); }
