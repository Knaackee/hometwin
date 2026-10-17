import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:4173/demo/?showcase=polish');
    await page.waitForFunction(() => document.querySelector('hometwin-panel')?.plan);
    await page.evaluate(() => document.querySelector('hometwin-panel').stage.stop());
    await page.locator('[data-ob=demo]').click();
    const point = await page.evaluate(() => {
      const p = document.querySelector('hometwin-panel'), L = p.plan.levels[0];
      p.plan.levels = [L]; L.furniture = [{ id: 'screen-test', type: 'lib:generic/media/tv/curved-tv-55', pos: [2, 2], entity_id: 'media_player.wohnzimmer_tv' }];
      L.devices = [{ id: 'behind-screen', kind: 'light', style: 'table', pos: [2, 1.5], y: 0.6, entity_id: 'light.wohnzimmer' }];
      p.stage.rebuildAll(); p.setLevel(L.id); p.stage.rise = null; p.stage.tween = null; p.setSheet('peek');
      const root = p.stage.levels.get(L.id).furn.get('screen-test'); root.updateWorldMatrix(true, true);
      let center; root.traverse(m => { if (m.userData.role === 'screen') { m.geometry.computeBoundingBox(); center = m.geometry.boundingBox.getCenter(p.stage._v.clone()).applyMatrix4(m.matrixWorld); } });
      p.stage.controls.target.copy(center); p.stage.persp.position.copy(center).add(p.stage._v.set(0, 0, 4)); p.stage.tick();
      const [x, y] = p.stage.project(center.x, center.y, center.z), r = p.$('stage').getBoundingClientRect();
      window.calls = []; p.call = (...args) => window.calls.push(args);
      return { x: x + r.left, y: y + r.top, pick: p.stage.pick({ clientX: x + r.left, clientY: y + r.top }) };
    });
    assert.equal(point.pick?.id, 'screen-test', 'Visible library screen must intercept the hit');
    const hold = async () => {
      if (mobile) { const cdp = await context.newCDPSession(page); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] }); await page.waitForTimeout(650); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); }
      else { await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); }
    };
    await hold();
    assert.equal(await page.evaluate(() => document.querySelector('hometwin-panel').detailEntity), 'media_player.wohnzimmer_tv');
    assert.deepEqual(await page.evaluate(() => window.calls), [], 'Hold must not toggle any device');
    assert(await page.locator('#dV').isVisible(), 'Media volume control is visible');
    await page.locator('[data-mp=media_play_pause]').click();
    assert.deepEqual(await page.evaluate(() => window.calls), [['media_player', 'media_play_pause', { entity_id: 'media_player.wohnzimmer_tv' }]]);
    await page.evaluate(() => { window.calls = []; });
    await page.screenshot({ path: `.preview/screen-control-${mobile ? 'mobile' : 'desktop'}.png` });
    await page.evaluate(() => { const p = document.querySelector('hometwin-panel'); p.closeDetail(); p.plan.levels[0].furniture[0].entity_id = ''; p.stage.rebuildAll(); p.stage.tick(); });
    await hold();
    assert.deepEqual(await page.evaluate(() => window.calls), [], 'Unbound screen must not activate a light behind it');
    assert.equal(await page.evaluate(() => document.querySelector('hometwin-panel').detailEntity), null);
    await page.evaluate(() => {
      const p = document.querySelector('hometwin-panel'), L = p.plan.levels[0];
      p.applyLocal({ op: 'place_furniture', level_id: L.id, id: 'height-test', type: 'book', pos: [3, 3] });
      p.setMode('edit'); p.editor.select({ type: 'furniture', level: L.id, id: 'height-test' });
    });
    await page.locator('#iElevation').fill('0.75'); await page.locator('#iElevation').dispatchEvent('change');
    assert.equal(await page.evaluate(() => document.querySelector('hometwin-panel').plan.levels[0].furniture.find(f => f.id === 'height-test').elevation), 0.75);
    assert.deepEqual(errors, []);
    await context.close(); console.log(`PASS screen picking and long press ${mobile ? 'mobile' : 'desktop'}`);
  }
} finally { await browser.close(); }
