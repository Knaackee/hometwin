import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { demoSolarPower } from '../frontend/src/demo-solar.js';

assert.equal(demoSolarPower(-20), 0);
assert.equal(demoSolarPower(0), 0);
assert.equal(demoSolarPower(90), 5.4);
assert(demoSolarPower(15) < demoSolarPower(45));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:4173/demo/?showcase=polish');
  await page.waitForFunction(() => document.querySelector('hometwin-panel')?.plan);
  await page.evaluate(() => document.querySelector('hometwin-panel').stage.stop());
  await page.locator('[data-ob=demo]').click();
  const result = await page.evaluate(async () => {
    const p = document.querySelector('hometwin-panel');
    p.stage.rise = null; p.stage.tween = null; p.timeLive = false;
    p.customTime = new Date('2026-06-21T00:00:00'); p.updateSun(); await Promise.resolve();
    const night = +p.hass.states['sensor.pv_leistung'].state;
    p.customTime = new Date('2026-06-21T12:00:00'); p.updateSun(); await Promise.resolve();
    const day = +p.hass.states['sensor.pv_leistung'].state;
    p.setLevel('eg'); p.stage.tick();
    let screenCenter;
    p.stage.levels.get('eg').dev.get('d4').built.root.traverse(m => {
      if (m.userData.role === 'screen') { m.geometry.computeBoundingBox(); screenCenter = m.geometry.boundingBox.getCenter(p.stage._v.clone()).applyMatrix4(m.matrixWorld); }
    });
    const [sx, sy] = p.stage.project(screenCenter.x, screenCenter.y, screenCenter.z), canvas = p.$('stage').getBoundingClientRect();
    const screenPick = p.stage.pick({ clientX: sx + canvas.left, clientY: sy + canvas.top });
    return { screenPick, night, day, shadows: p.stage.pool.every(l => l.castShadow), ground: p.stage.ground.position.y,
      monitors: p.plan.levels.flatMap(l => l.devices).filter(d => d.style === 'monitor').length };
  });
  assert.equal(result.screenPick.id, 'd4', 'Demo TV screen must not select a light');
  assert.equal(result.night, 0); assert(result.day > 0); assert(result.shadows);
  assert.equal(result.ground, -0.02); assert(result.monitors >= 2);
  await page.screenshot({ path: '.preview/demo-polish-day.png' });
  await page.evaluate(() => { const p = document.querySelector('hometwin-panel'); p.customTime = new Date('2026-06-21T00:00:00'); p.updateSun(); p.stage.tick(); });
  await page.screenshot({ path: '.preview/demo-polish-night.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: demo night/day solar, shadowed lights, terrain, independent monitors, clean WebGL render');
} finally { await browser.close(); }
