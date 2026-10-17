// PDF support for the floor-plan wizard. Loaded on demand (separate chunk), runs pdf.js on the
// main thread, so no worker file and no network access are needed.
if (!Promise.withResolvers) Promise.withResolvers = function withResolvers() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

let lib;
async function pdfjs() {
  if (lib) return lib;
  const worker = await import('pdfjs-dist/build/pdf.worker.mjs');
  globalThis.pdfjsWorker = worker;
  lib = await import('pdfjs-dist/build/pdf.mjs');
  return lib;
}
// Opens a PDF file. Returns { pages, thumb(i), render(i, maxPx) }.
export async function openPdf(file) {
  const { getDocument } = await pdfjs();
  const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const draw = async (i, maxPx) => {
    const page = await doc.getPage(i + 1); const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(6, maxPx / Math.max(v1.width, v1.height)); const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise; return c;
  };
  // Renders the region r = { x, y, w, h } (page units of the scale-1 viewport) so that its long side has maxPx pixels.
  const region = async (i, r, maxPx) => {
    const page = await doc.getPage(i + 1); const scale = Math.min(12, maxPx / Math.max(r.w, r.h));
    const vp = page.getViewport({ scale, offsetX: -r.x * scale, offsetY: -r.y * scale });
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(r.w * scale)); c.height = Math.max(1, Math.round(r.h * scale));
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise; return { canvas: c, scale };
  };
  return { pages: doc.numPages, thumb: (i) => draw(i, 220), render: (i, maxPx = 3200) => draw(i, maxPx), region, analyze: async (i) => analyzePage(doc, i, (await pdfjs()).OPS) };
}

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const app = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// Text items and straight line segments of a page in units of the scale-1 viewport (x right, y down,
// page rotation applied). Vector PDFs only; scanned pages return few or no items.
export async function analyzePage(doc, i, OPS) {
  const page = await doc.getPage(i + 1); const vp = page.getViewport({ scale: 1 }); const V = vp.transform;
  const items = [];
  for (const it of (await page.getTextContent()).items) {
    if (!it.str || !it.str.trim()) continue;
    const t = it.transform, fh = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]); const dl = Math.hypot(t[0], t[1]) || 1;
    const p0 = app(V, t[4], t[5]), p1 = app(V, t[4] + (t[0] / dl) * (it.width || fh), t[5] + (t[1] / dl) * (it.width || fh));
    const h = Math.abs(fh * Math.hypot(V[0], V[1]));
    items.push({ str: it.str, x: p0[0], y: p0[1], w: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), h, angle: Math.round(Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 1800 / Math.PI) / 10 });
  }
  const segments = [];
  try {
    const ol = await page.getOperatorList(); let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
    const push = (a, b) => { const p = app(mul(V, ctm), a[0], a[1]), q = app(mul(V, ctm), b[0], b[1]); const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L > 1 && (Math.abs(q[0] - p[0]) < 0.05 * L || Math.abs(q[1] - p[1]) < 0.05 * L)) segments.push({ x1: p[0], y1: p[1], x2: q[0], y2: q[1] }); };
    for (let k = 0; k < ol.fnArray.length && segments.length < 60000; k++) {
      const fn = ol.fnArray[k], args = ol.argsArray[k];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args[0]) && args[0].length === 6) ctm = mul(ctm, args[0]); }
      else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.constructPath) {
        const [ops, a] = args; let j = 0, cur = [0, 0], start = [0, 0];
        for (const op of ops) {
          if (op === OPS.moveTo) { cur = [a[j], a[j + 1]]; start = cur; j += 2; }
          else if (op === OPS.lineTo) { const n = [a[j], a[j + 1]]; push(cur, n); cur = n; j += 2; }
          else if (op === OPS.curveTo) { cur = [a[j + 4], a[j + 5]]; j += 6; }
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur = [a[j + 2], a[j + 3]]; j += 4; }
          else if (op === OPS.rectangle) { const [x, y, w, h] = [a[j], a[j + 1], a[j + 2], a[j + 3]]; j += 4; push([x, y], [x + w, y]); push([x + w, y], [x + w, y + h]); push([x + w, y + h], [x, y + h]); push([x, y + h], [x, y]); cur = [x, y]; start = cur; }
          else if (op === OPS.closePath) { push(cur, start); cur = start; }
        }
      }
    }
  } catch (e) { console.warn('HomeTwin: PDF line analysis failed', e); }
  return { width: vp.width, height: vp.height, items, segments };
}
