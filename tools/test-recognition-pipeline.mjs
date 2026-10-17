import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePlan } from './plangen.mjs';

// Floor-plan wizard with a generated vector PDF: region proposal, exact scale from the PDF, text labels
// and PNG sent to the model, detailed openings pass in tiles, door orientation applied to the plan.
const base = process.env.HOMETWIN_TEST_URL || 'http://127.0.0.1:4173/demo/';
const dir = mkdtempSync(join(tmpdir(), 'hometwin-plan-'));
const { pdf, truth } = makePlan({ convention: 'metric-cm', ratio: 100, sheet: 'A3', seed: 7 });
const file = join(dir, 'generated-plan.pdf'); writeFileSync(file, pdf);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base); await page.waitForFunction(() => document.querySelector('hometwin-panel')?.plan);
    await page.evaluate(() => {
      const app = document.querySelector('hometwin-panel'), wz = app.wizard; app.stage.stop();
      wz.open({ levelId: '__new' }); wz.ai = { configured: true, model: 'anthropic/claude-opus-5.5', image_max_px: 1568 };
      window.__reqs = [];
      wz.runJob = async (req) => {
        window.__reqs.push({ mode: req.mode, w: req.width, h: req.height, mpp: req.mpp, x0: req.x0, z0: req.z0, labels: req.labels, png: req.image.startsWith('data:image/png'), walls: req.walls?.length });
        if (req.mode === 'layout') return { drawings: [{ type: 'title_block', box: [req.width * 0.8, 0, req.width, req.height] }, { type: 'floor_plan', label: null, box: [req.width * 0.04, req.height * 0.04, req.width * 0.62, req.height * 0.96] }] };
        if (req.mode === 'rooms') { // two rooms side by side in the middle of the model image (pixels → metres with the given scale)
          const m = req.mpp, X = req.width * 0.25, Y = req.height * 0.3, a = 3 / m, b = 2.5 / m, d = 4 / m;
          const P = (x, y) => [x * m, y * m];
          return { mpp: m, scale_source: 'measured', rooms: [
            { name: 'Living', kind: 'room', points: [P(X, Y), P(X + a, Y), P(X + a, Y + d), P(X, Y + d)], area: 12, net_area: 12 },
            { name: 'Kitchen', kind: 'room', points: [P(X + a, Y), P(X + a + b, Y), P(X + a + b, Y + d), P(X + a, Y + d)], area: 10, net_area: 10 }],
            openings: [{ type: 'window', from: P(X + 30, Y), to: P(X + 30 + 1 / m, Y) }], stairs: [] };
        }
        if (req.mode === 'openings') { // the detail pass finds the window again (printed width) and a door between the rooms
          const w = req.walls; const between = w.find((x) => x[4] === 'interior'); if (!between) return { openings: [] };
          const T = (x, y) => [req.x0 + x * req.mpp, req.z0 + y * req.mpp];
          const top = w.find((x) => x[4] === 'exterior' && Math.abs(x[1] - x[3]) < 1);
          const out = [{ type: 'door', from: T(between[0], between[1] + 40), to: T(between[0], between[1] + 40 + 0.875 / req.mpp), hinge: 'to', opens_into: 'Kitchen', printed: true }];
          if (top) out.push({ type: 'window', from: T(top[0] + 30, top[1]), to: T(top[0] + 30 + 1.25 / req.mpp, top[1]), printed: true, sill: 0.9, head: 2.05 });
          return { openings: out };
        }
        return {};
      };
    });
    const panel = page.locator('hometwin-panel');
    await panel.locator('#wzFile').setInputFiles(file);
    await page.waitForFunction(() => document.querySelector('hometwin-panel').wizard.st.pdfPage, null, { timeout: 60000 });
    await page.evaluate(() => document.querySelector('hometwin-panel').wizard.next());
    await page.waitForFunction(() => { const r = document.querySelector('hometwin-panel').wizard.st.roi; return r && !r.busy; }, null, { timeout: 30000 });
    const roi = await page.evaluate(() => { const s = document.querySelector('hometwin-panel').wizard.st; return { plans: s.roi.plans.length, quad: s.quad, W: document.querySelector('hometwin-panel').wizard.rotated.width }; });
    assert.equal(roi.plans, 1, 'one floor plan proposed'); assert.ok(roi.quad[1][0] < roi.W * 0.75, 'crop frame excludes the title block');
    assert.match(await panel.locator('.wz-side').innerText(), /Suggested area/);
    await page.screenshot({ path: `.preview/recognition-region-${mobile ? 'mobile' : 'desktop'}.png` });

    await page.evaluate(() => document.querySelector('hometwin-panel').wizard.next());
    const sc = await page.evaluate(() => { const s = document.querySelector('hometwin-panel').wizard.st; return { mpp: s.mpp, info: s.scaleInfo, img: [s.img.width, s.img.height] }; });
    assert.equal(sc.info?.source, 'pdf-verified', 'scale read from the PDF and checked'); assert.equal(sc.info.ratio, 100);
    assert.ok(Math.max(...sc.img) > 2000, 'crop re-rendered sharply from the vector PDF');
    assert.match(await panel.locator('.wz-side').innerText(), /Scale 1:100 read from the PDF/);
    await page.screenshot({ path: `.preview/recognition-scale-${mobile ? 'mobile' : 'desktop'}.png` });

    await page.evaluate(() => { const wz = document.querySelector('hometwin-panel').wizard; wz.st.opts.refine = false; return wz.next(); });
    await page.waitForFunction(() => document.querySelector('hometwin-panel').wizard.st.step === 4, null, { timeout: 60000 });
    const reqs = await page.evaluate(() => window.__reqs);
    const rooms = reqs.find((r) => r.mode === 'rooms'), tiles = reqs.filter((r) => r.mode === 'openings');
    assert.ok(rooms.png && Math.max(rooms.w, rooms.h) <= 1568, 'PNG within the model size');
    assert.ok(Math.abs(rooms.mpp / (sc.mpp * (sc.img[0] / rooms.w)) - 1) < 0.01, 'scale sent with the request');
    assert.ok(rooms.labels.some((l) => l.kind === 'pair' && Math.abs(l.w - truth.openings[0].w) < 0.02), 'window label with printed width');
    assert.ok(rooms.labels.some((l) => l.kind === 'area') && rooms.labels.some((l) => l.kind === 'name'), 'room names and areas as labels');
    assert.ok(tiles.length >= 1 && tiles.every((t) => t.png && t.walls > 0 && Math.max(t.w, t.h) <= 1568), 'detail pass on tiles with walls');
    const result = await page.evaluate(() => document.querySelector('hometwin-panel').wizard.st.result);
    const doors = result.openings.filter((o) => o.type === 'door'), wins = result.openings.filter((o) => o.type === 'window');
    assert.equal(doors.length, 1, 'door from the detail pass'); assert.equal(wins.length, 1, 'duplicate window merged');
    assert.ok(Math.abs(Math.hypot(wins[0].to[0] - wins[0].from[0], wins[0].to[1] - wins[0].from[1]) - 1.25) < 0.02, 'printed window width kept');
    assert.ok(!wins[0].uncertain, 'confirmed window is not marked uncertain');
    assert.match(await panel.locator('.wz-review').innerText(), /No window found in “Kitchen”/);
    await page.screenshot({ path: `.preview/recognition-review-${mobile ? 'mobile' : 'desktop'}.png` });

    await page.evaluate(() => document.querySelector('hometwin-panel').wizard.apply());
    const op = await page.evaluate(() => { const L = document.querySelector('hometwin-panel').plan.levels.at(-1); return L.openings.find((o) => o.type === 'door'); });
    assert.equal(op.hinge, 'to', 'hinge side applied'); assert.ok(op.swing === 1 || op.swing === -1, 'opening direction applied');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: region proposal, exact PDF scale, labels/PNG to the model, detail openings pass, door orientation, desktop/mobile');
} finally { await browser.close(); }
