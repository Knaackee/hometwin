import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Floor-plan assistant: a new storey gets plan heights when plausible, otherwise defaults
// that are flagged for review, and is stacked onto the storey below without a gap.
const base = process.env.HOMETWIN_TEST_URL || 'http://127.0.0.1:4173/demo/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('hometwin-panel')?.plan);
    await page.evaluate(() => document.querySelector('hometwin-panel').stage.stop());
    const review = (level) => page.evaluate(async (level) => {
      const app = document.querySelector('hometwin-panel'), wz = app.wizard;
      wz.runJob = async () => ({ rooms: [{ name: 'Attic', kind: 'room', points: [[0, 0], [4, 0], [4, 3], [0, 3]] }], openings: [], stairs: [], notes: '', level });
      wz.open({ levelId: '__new' }); wz.ai = { configured: true, model: 'mock' };
      const img = document.createElement('canvas'); img.width = 800; img.height = 600; const g = img.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 800, 600); g.strokeRect(80, 70, 640, 460);
      wz.st.src = img; wz.st.srcName = 'plan.png'; wz.st.keepUnderlay = false; wz.render();
      await wz.next(); await wz.next();
      wz.st.measure = { a: [100, 100], b: [600, 100], m: '10' }; wz.st.opts.refine = false; wz.recalc(); wz.render();
      await wz.detect();
    }, level);
    const panel = page.locator('hometwin-panel');
    const top = await page.evaluate(() => { const L = document.querySelector('hometwin-panel').plan.levels.at(-1); return { e: L.elevation, h: L.height }; });

    // 1. Plan states level and room height: the slab is derived from the gap.
    const planLevel = Math.round((top.e + top.h + 0.32) * 1000) / 1000;
    await review({ name: 'Attic', floor_elevation_m: planLevel, room_height_m: 2.3 });
    assert.equal(await panel.locator('#wzLvH').inputValue(), '2.3');
    assert.equal(+(await panel.locator('#wzLvSlab').inputValue()), 0.32);
    assert.match(await panel.locator('.wz-heights').innerText(), /calculated/i);
    await page.evaluate(() => document.querySelector('hometwin-panel').shadowRoot.querySelector('.wz-heights').scrollIntoView());
    await page.screenshot({ path: `.preview/wizard-heights-${mobile ? 'mobile' : 'desktop'}.png` });
    // Correcting the slab updates the floor level live.
    const count = await page.evaluate(() => document.querySelector('hometwin-panel').plan.levels.length);
    await panel.locator('#wzLvSlab').fill('-1');
    await page.evaluate(() => document.querySelector('hometwin-panel').wizard.apply());
    assert.equal(await page.evaluate(() => document.querySelector('hometwin-panel').plan.levels.length), count, 'invalid manual thickness must not create a storey with a silent fallback');
    await panel.locator('#wzLvSlab').fill('0.3');
    assert.match(await panel.locator('#wzLvElev').innerText(), new RegExp((top.e + top.h + 0.3).toFixed(2)));
    assert.match(await panel.locator('.wz-heights').innerText(), /manual/i);
    await page.evaluate(() => document.querySelector('hometwin-panel').wizard.apply());
    const added = await page.evaluate(() => { const L = document.querySelector('hometwin-panel').plan.levels.at(-1); return { name: L.name, e: L.elevation, h: L.height, slab: L.slab }; });
    assert.equal(added.name, 'Attic'); assert.equal(added.h, 2.3); assert.equal(added.slab, 0.3);
    assert.ok(Math.abs(added.e - (top.e + top.h + 0.3)) < 1e-6, 'storey sits on the slab without a gap');
    await page.evaluate(() => document.querySelector('hometwin-panel').wizard.close());

    // 2. Nothing printed: defaults are used and flagged.
    await review(null);
    const text = await panel.locator('.wz-heights').innerText();
    assert.match(text, /default – please check/i); assert.equal(await panel.locator('#wzLvH').inputValue(), '2.6');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: assistant storey heights from plan, defaults flagged, live correction, gap-free stacking, desktop/mobile');
} finally { await browser.close(); }
