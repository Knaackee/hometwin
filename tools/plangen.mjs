// Generates simple vector floor-plan PDFs with known ground truth, in different drawing conventions.
// Used by tests: no real plans are stored in the repository.
//   const { pdf, truth } = makePlan({ convention: 'metric-cm' | 'mm' | 'imperial', ratio: 100, rotate: 0 | 90, sheet: 'A3' | 'letter', titleBlock: true })
// Coordinates: plan metres, x right, z down. PDF: points, origin bottom-left.

const PT = 72 / 0.0254; // points per metre on paper

const SHEETS = { A3: [1190.55, 841.89], A4: [841.89, 595.28], letter: [792, 612], tabloid: [1224, 792] };

function fmtLength(m, convention) {
  if (convention === 'mm') return { text: String(Math.round(m * 1000)) };
  if (convention === 'imperial') {
    const inches = Math.round(m / 0.0254 * 2) / 2; const ft = Math.floor(inches / 12), inch = inches - ft * 12;
    const inchStr = Number.isInteger(inch) ? String(inch) : `${Math.floor(inch)} 1/2`;
    return { text: `${ft}'-${inchStr}"` };
  }
  // metric: metres with comma; below 1 m in centimetres; half centimetres as a raised 5
  const cm = Math.round(m * 200) / 2; const half = cm % 1 !== 0;
  if (m < 1) return { text: String(Math.floor(cm)), sup: half ? '5' : null };
  const whole = Math.floor(cm); const s = (whole / 100).toFixed(2).replace('.', ',');
  return { text: s, sup: half ? '5' : null };
}

export function makePlan({ convention = 'metric-cm', ratio = 100, rotate = 0, sheet = 'A3', titleBlock = true, seed = 1 } = {}) {
  let rnd = seed; const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const [W, H] = SHEETS[sheet];
  const k = PT / ratio; // points per plan metre
  // house: 2×2 rooms with random sizes (metres)
  const a = 3 + Math.round(rand() * 20) / 10, b = 2.5 + Math.round(rand() * 20) / 10, c = 3.5 + Math.round(rand() * 20) / 10, d = 2.5 + Math.round(rand() * 15) / 10;
  const rooms = [
    { name: 'Living', rect: [0, 0, a, c] }, { name: 'Kitchen', rect: [a, 0, a + b, c] },
    { name: 'Bed', rect: [0, c, a, c + d] }, { name: 'Bath', rect: [a, c, a + b, c + d] },
  ];
  const totalW = a + b, totalD = c + d;
  const ox = 90, oy = H - 90 - totalD * k; // plan origin in points (top-left of the house), y from bottom
  const P = (x, z) => [ox + x * k, oy + (totalD - z) * k]; // plan metres → PDF points (y up)
  const ops = []; const texts = [];
  const line = (p, q, w = 0.5) => ops.push(`${w} w ${p[0].toFixed(2)} ${p[1].toFixed(2)} m ${q[0].toFixed(2)} ${q[1].toFixed(2)} l S`);
  const text = (str, p, size = 7, angle = 0) => { const r = (angle * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r); texts.push(`BT /F1 ${size} Tf ${cs.toFixed(4)} ${sn.toFixed(4)} ${(-sn).toFixed(4)} ${cs.toFixed(4)} ${p[0].toFixed(2)} ${p[1].toFixed(2)} Tm (${str.replace(/[()\\]/g, '\\$&')}) Tj ET`); };
  const label = (m, p, angle = 0, size = 7) => { const f = fmtLength(m, convention); text(f.text, p, size, angle); if (f.sup) { const r = (angle * Math.PI) / 180, w = f.text.length * size * 0.55; text(f.sup, [p[0] + Math.cos(r) * w - Math.sin(r) * size * 0.45, p[1] + Math.sin(r) * w + Math.cos(r) * size * 0.45], size * 0.62, angle); } };
  // walls (outlines of rooms)
  for (const r of rooms) { const [x0, z0, x1, z1] = r.rect; line(P(x0, z0), P(x1, z0), 1.2); line(P(x1, z0), P(x1, z1), 1.2); line(P(x1, z1), P(x0, z1), 1.2); line(P(x0, z1), P(x0, z0), 1.2); const cp = P((x0 + x1) / 2 - 0.5, (z0 + z1) / 2); text(r.name, cp, 8); text(`${((x1 - x0) * (z1 - z0)).toFixed(2).replace('.', convention === 'imperial' ? '.' : ',')} m2`, [cp[0], cp[1] - 10], 6); }
  // openings: a window in each exterior wall of Living and Bed, doors between rooms
  const openings = [];
  const win = (x, z, len, horizontal) => { const p = P(x, z), q = horizontal ? P(x + len, z) : P(x, z + len); for (const off of [-1.5, 0, 1.5]) line(horizontal ? [p[0], p[1] + off] : [p[0] + off, p[1]], horizontal ? [q[0], q[1] + off] : [q[0] + off, q[1]], 0.25); const lw = fmtLength(len, convention), lh = fmtLength(1.25, convention); const mp = horizontal ? P(x + len / 2 - 0.3, z - 0.35) : P(x - 0.45, z + len / 2); text(`${lw.text}`, mp, 6); text(`${lh.text}`, [mp[0], mp[1] - 8], 6); openings.push({ type: 'window', from: [x, z], to: horizontal ? [x + len, z] : [x, z + len], w: len, h: 1.25 }); };
  const door = (x, z, len, horizontal) => { const p = P(x, z), q = horizontal ? P(x + len, z) : P(x, z + len); const r = len * k; const n = 12; let prev = q; for (let i = 1; i <= n; i++) { const th = (i / n) * Math.PI / 2; const pt = horizontal ? [p[0] + Math.cos(th) * r, p[1] - Math.sin(th) * r] : [p[0] + Math.sin(th) * r, p[1] - Math.cos(th) * r]; line(prev, pt, 0.2); prev = pt; } line(p, prev, 0.4); const f = fmtLength(len, convention); text(f.text, horizontal ? P(x + len / 2 - 0.2, z + 0.3) : P(x + 0.15, z + len / 2), 6); openings.push({ type: 'door', from: [x, z], to: horizontal ? [x + len, z] : [x, z + len], w: len }); };
  win(0.8, 0, 1.5, true); win(0, c + 0.6, 1.2, false); win(a + 0.5, c + d, 1.0, true);
  door(a - 1.2, c, 0.875, true); door(a, 0.6, 0.875, false);
  // dimension chains: top (total and per room), left; dimension lines exactly as long as their value
  const dimH = (x0, x1, z) => { line(P(x0, z), P(x1, z), 0.3); for (const x of [x0, x1]) line(P(x, z - 0.12), P(x, z + 0.12), 0.3); label(x1 - x0, P((x0 + x1) / 2 - 0.3, z - 0.08)); };
  const dimV = (z0, z1, x) => { line(P(x, z0), P(x, z1), 0.3); for (const z of [z0, z1]) line(P(x - 0.12, z), P(x + 0.12, z), 0.3); label(z1 - z0, P(x - 0.08, (z0 + z1) / 2 + 0.3), 90); };
  dimH(0, totalW, -1.6); dimH(0, a, -1.0); dimH(a, totalW, -1.0); dimV(0, totalD, -1.6); dimV(0, c, -1.0); dimV(c, totalD, -1.0);
  dimH(0, 0.49, totalD + 0.9); dimH(0.49, a, totalD + 0.9);
  // title block (not part of the plan) and a second, unrelated drawing
  if (titleBlock) { const tx = W - 230; line([tx, 30], [tx, H - 30], 1); line([tx, 30], [W - 30, 30], 1); line([W - 30, 30], [W - 30, H - 30], 1); text('PROJECT: Example house', [tx + 10, H - 60], 10); text(convention === 'imperial' ? `SCALE: 1/${ratio === 48 ? '4' : '8'}" = 1'-0"` : `Scale 1:${ratio}`, [tx + 10, H - 90], 9); text('Drawn by: test', [tx + 10, H - 110], 8); }
  const content = [...ops, ...texts].join('\n');
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Rotate ${rotate} /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`);
  objs.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const mPerPt = 0.0254 / 72 * ratio;
  return { pdf: Buffer.from(pdf, 'latin1'), truth: { mPerPt, rooms, openings, totalW, totalD, sheet: [W, H], rotate } };
}
