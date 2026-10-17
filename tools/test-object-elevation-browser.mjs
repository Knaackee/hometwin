import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const plan = { version: 2, name: 'Object placement', site: { lat: 49.326, lon: 12.11, roof: { type: 'none' }, solar: [], roofs: [], roofItems: [] }, levels: [{
  id: 'test-floor', name: 'Placement', elevation: 2.5, height: 3, autoElevation: false,
  rooms: [{ id: 'test-room', name: 'Plant on a table', kind: 'room', surface: 'oak', points: [[0, 0], [6, 0], [6, 5], [0, 5]] }], openings: [],
  furniture: [{ id: 'table', type: 'desk', pos: [3, 2.5], compositionVersion: 1, width: 1.8, depth: 1.2 }, { id: 'plant', type: 'bigPlant', pos: [3, 2.5] }], devices: [],
}] };
writeFileSync('.preview/height-demo.json', JSON.stringify(plan, null, 2));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:4173/demo/?showcase=height');
    await page.waitForFunction(() => document.querySelector('hometwin-panel')?.plan);
    await page.evaluate(plan => {
      const p = document.querySelector('hometwin-panel'); p.stage.stop(); p.$('onboard').hidden = true;
      plan.site = { ...p.plan.site, ...plan.site }; p.setPlan(plan, { frame: true }); p.setMode('edit'); p.setLevel('test-floor'); p.stage.rise = null; p.stage.tween = null;
      p.timeLive = false; p.customTime = new Date('2026-06-21T12:00:00'); p.updateSun();
      p.editor.select({ type: 'furniture', level: 'test-floor', id: 'plant' }); p.stage.tick();
    }, structuredClone(plan));
    const height = () => page.evaluate(() => document.querySelector('hometwin-panel').stage.itemElevation('test-floor', 'furniture', 'plant'));
    const assertSelection = async () => {
      const delta = await page.evaluate(() => {
        const p = document.querySelector('hometwin-panel'); p.stage.tick();
        const h = p.stage.selHelpers[0]; h.geometry.computeBoundingBox();
        return h.geometry.boundingBox.min.y - (p.stage.levels.get('test-floor').group.position.y + p.stage.itemElevation('test-floor', 'furniture', 'plant'));
      });
      assert(Math.abs(delta) < 0.002, 'Selection box follows the actual object bottom');
    };
    assert(Math.abs(await height()) < 0.001);
    await page.locator('[data-act=onSurface]').click();
    assert(Math.abs(await height() - 0.76) < 0.002, 'Plant base rests on the desktop, relative to its elevated floor');
    await assertSelection();
    await page.evaluate(() => document.querySelector('hometwin-panel').stage.tick());
    await page.screenshot({ path: `.preview/object-elevation-${mobile ? 'mobile' : 'desktop'}.png` });
    await page.locator('#iElevation').fill('1.1'); await page.locator('#iElevation').dispatchEvent('change');
    assert(Math.abs(await height() - 1.1) < 0.001);
    await assertSelection();
    assert.equal(await page.locator('#iAutoElevation').isChecked(), false, 'Manual height disables automatic placement');
    await page.locator('#iX').fill('5'); await page.locator('#iX').dispatchEvent('change');
    assert(Math.abs(await height() - 1.1) < 0.001, 'Manual height stays fixed when moved');
    await page.locator('#iAutoElevation').check();
    assert(Math.abs(await height()) < 0.001, 'Automatic mode can be re-enabled and settles on the floor');
    await page.locator('#iX').fill('3'); await page.locator('#iX').dispatchEvent('change');
    assert(Math.abs(await height() - 0.76) < 0.002, 'Moving over the table automatically lifts the object');
    await page.evaluate(() => {
      const p = document.querySelector('hometwin-panel'), item = p.plan.levels[0].furniture.find(f => f.id === 'plant');
      item.pos[0] = 5; p.stage.moveItem('test-floor', 'furniture', item);
    });
    await assertSelection();
    assert(Math.abs(await height()) < 0.001, 'Drag movement settles on the floor without pressing a button');
    await page.locator('#iElevation').fill('1.1'); await page.locator('#iElevation').dispatchEvent('change');

    await page.evaluate(async () => { const p = document.querySelector('hometwin-panel'); await p.save(); });
    await page.reload(); await page.waitForFunction(() => document.querySelector('hometwin-panel')?.plan?.name === 'Object placement');
    await page.evaluate(() => document.querySelector('hometwin-panel').stage.stop());
    assert(Math.abs(await height() - 1.1) < 0.001, 'Height survives save and reload');
    await page.evaluate(() => { const p = document.querySelector('hometwin-panel'); p.setMode('edit'); p.editor.select({ type: 'furniture', level: 'test-floor', id: 'plant' }); });
    await page.locator('#iX').fill('5'); await page.locator('#iX').dispatchEvent('change');
    await page.locator('[data-act=onSurface]').click();
    assert(Math.abs(await height()) < 0.001, 'Without support the plant returns to the floor');
    await page.evaluate(() => {
      const p = document.querySelector('hometwin-panel');
      p.apply([{ op: 'place_furniture', level_id: 'test-floor', id: 'batch-book', type: 'book', pos: [3, 2.5] }]);
    });
    const bookHeight = () => page.evaluate(() => document.querySelector('hometwin-panel').stage.itemElevation('test-floor', 'furniture', 'batch-book'));
    assert(Math.abs(await bookHeight() - 0.76) < 0.002, 'Batched agent placement settles onto the table');
    await page.evaluate(() => document.querySelector('hometwin-panel').apply([{ op: 'move_item', level_id: 'test-floor', item_id: 'table', pos: [1, 1] }]));
    assert(Math.abs(await bookHeight()) < 0.002, 'Moving a support makes automatic dependents fall to the floor');
    await page.evaluate(() => document.querySelector('hometwin-panel').apply([{ op: 'move_item', level_id: 'test-floor', item_id: 'table', pos: [3, 2.5] }]));
    assert(Math.abs(await bookHeight() - 0.76) < 0.002, 'Returning a support lifts automatic dependents');
    await page.evaluate(() => document.querySelector('hometwin-panel').apply([{ op: 'delete_item', item_id: 'table' }]));
    assert(Math.abs(await bookHeight()) < 0.002, 'Removing a support leaves no floating automatic object');
    assert.deepEqual(errors, []);
    await context.close(); console.log(`PASS object elevation, surface placement and persistence: ${mobile ? 'mobile' : 'desktop'}`);
  }
} finally { await browser.close(); }
