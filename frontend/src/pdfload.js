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
  return { pages: doc.numPages, thumb: (i) => draw(i, 220), render: (i, maxPx = 3200) => draw(i, maxPx) };
}
