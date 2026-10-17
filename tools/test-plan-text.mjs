import assert from 'node:assert/strict';
import { makePlan } from './plangen.mjs';

// Plan text understanding and exact scale from vector PDFs, for several drawing conventions.
const { parseLength, classifyLabel, mergeTextItems, estimateScale, parseScaleText } = await import('../frontend/src/dimtext.js');
const { analyzePage } = await import('../frontend/src/pdfload.js');
const { rotFrame, pageModel, pdfScale, labelsForModel, quadMap, snapRegion } = await import('../frontend/src/wizardpdf.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => import('../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));

const has = (readings, m) => readings.some((r) => Math.abs(r.m - m) < 1e-6);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ${b}, got ${a}`);

/* ---------- readings: every common notation, ambiguous ones keep all readings ---------- */
assert.ok(has(parseLength('3,40'), 3.4) && has(parseLength('3.40'), 3.4));
assert.ok(has(parseLength('87,5'), 0.875) && has(parseLength('87,5'), 87.5), 'cm with decimal stays ambiguous');
assert.ok(has(parseLength('49'), 0.49) && has(parseLength('49'), 0.049));
assert.ok(has(parseLength('3,31', '5'), 3.315), 'raised half digit');
assert.ok(has(parseLength('11', '5'), 0.115), 'raised half on centimetres');
assert.ok(has(parseLength('3,315'), 3.315) && has(parseLength('175'), 0.175), 'merged raised digits');
assert.ok(has(parseLength('3400'), 3.4), 'millimetres');
assert.ok(has(parseLength('3.40 m'), 3.4) && has(parseLength('340 cm'), 3.4) && has(parseLength('3400 mm'), 3.4));
close(parseLength(`12'-6"`)[0].m, 3.81, 1e-9, 'feet-inches'); close(parseLength(`2'-10 1/2"`)[0].m, 0.8763, 1e-9, 'fraction inches'); close(parseLength(`10'`)[0].m, 3.048, 1e-9, 'feet');
assert.deepEqual(parseLength('Kitchen'), []);
assert.equal(classifyLabel({ str: '1,25/1,15' }).kind, 'pair'); assert.equal(classifyLabel({ str: `3'-0" x 6'-8"` }).kind, 'pair');
assert.equal(classifyLabel({ str: 'BF: 15,36 m2' }).kind, 'area'); close(classifyLabel({ str: '150 sq ft' }).m2, 13.935, 0.01, 'square feet');
assert.equal(classifyLabel({ str: '±0,00' }).kind, 'level'); assert.equal(classifyLabel({ str: 'FFL +3.000' }).kind, 'level');
assert.equal(classifyLabel({ str: 'BRH 90' }).kind, 'sill'); assert.equal(classifyLabel({ str: 'Kind 2' }).kind, 'name');
for (const [s, r] of [['Maßstab 1:100', 100], ['M 1:50', 50], ['Scale 1:200 @ A3', 200], ['Échelle 1:100', 100], [`1/4" = 1'-0"`, 48], [`1/8"=1'`, 96]]) assert.equal(parseScaleText(s)?.ratio, r, s);
// raised digit and stacked pair are joined
const merged = mergeTextItems([{ str: '1,62', x: 100, y: 100, w: 14, h: 6, angle: 0 }, { str: '5', x: 114.5, y: 97, w: 2, h: 3.8, angle: 0 }, { str: '1,25', x: 100, y: 108, w: 14, h: 6, angle: 0 }]);
assert.equal(merged.length, 1); assert.equal(merged[0].sup, '5'); assert.equal(merged[0].stacked, true);
assert.ok(has(classifyLabel(merged[0]).w, 1.625) && has(classifyLabel(merged[0]).h, 1.25));

/* ---------- generated vector PDFs: exact scale for each convention, page rotation, sheet size ---------- */
const cases = [
  { convention: 'metric-cm', ratio: 100, rotate: 0, sheet: 'A3' },
  { convention: 'metric-cm', ratio: 50, rotate: 90, sheet: 'A3' },
  { convention: 'mm', ratio: 100, rotate: 0, sheet: 'A4' },
  { convention: 'imperial', ratio: 48, rotate: 0, sheet: 'tabloid' },
  { convention: 'metric-cm', ratio: 100, rotate: 0, sheet: 'letter', titleBlock: false },
];
for (const [i, c] of cases.entries()) {
  const { pdf, truth } = makePlan({ ...c, seed: i + 3 });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, disableFontFace: true }).promise;
  const page = await analyzePage(doc, 0, pdfjs.OPS);
  const name = `${c.convention} 1:${c.ratio} rot${c.rotate} ${c.sheet}`;
  assert.ok(page.items.length > 10 && page.segments.length > 20, `${name}: text and lines found`);
  const est = estimateScale(mergeTextItems(page.items), page.segments);
  assert.ok(est, `${name}: scale estimated`); close(est.mPerUnit / truth.mPerPt, 1, 0.01, `${name}: metres per point`);
  // full pipeline in image pixels: source rendered at 2 px per point, no crop
  const srcW = page.width * 2, srcH = page.height * 2, rf = rotFrame(srcW, srcH, 0), q = [[0, 0], [srcW, 0], [srcW, srcH], [0, srcH]];
  const model = pageModel(page, 0.5, rf, q, 1, srcW, srcH);
  const sc = pdfScale(model, mergeTextItems(page.items));
  assert.ok(sc, `${name}: pdfScale`); close(sc.mpp / (truth.mPerPt / 2), 1, 0.01, `${name}: metres per pixel`);
  assert.equal(sc.source, c.titleBlock === false ? 'pdf-dimensions' : 'pdf-verified', `${name}: scale source`);
  const rows = labelsForModel(model, sc.mpp, 1);
  assert.ok(rows.some((r) => r.kind === 'pair' && Math.abs(r.w - truth.openings[0].w) < 0.02), `${name}: window label read as width/height`);
  assert.ok(rows.some((r) => r.kind === 'area'), `${name}: area labels`);
}

/* ---------- geometry helpers ---------- */
const rf = rotFrame(400, 200, 90); const p = rf.fwd([10, 20]); const back = rf.inv(p); close(back[0], 10, 1e-9, 'rotation inverse x'); close(back[1], 20, 1e-9, 'rotation inverse y');
const qm = quadMap([[10, 10], [110, 20], [100, 120], [0, 100]], 200, 200); const c0 = qm([10, 10]), c2 = qm([100, 120]); close(c0[0], 0, 1e-6, 'homography corner 0'); close(c2[0], 200, 1e-6, 'homography corner 2');
const box = snapRegion([100, 100, 300, 300], [{ str: '4,25', x: 180, y: 70, w: 20, h: 8, angle: 0 }, { str: '9,00', x: 900, y: 70, w: 20, h: 8, angle: 0 }], 1000, 1000);
assert.ok(box[1] < 70 && box[2] < 500, 'region grows to a nearby dimension, not to a far one');

console.log('plan text tests passed');
