// 2D helpers on the plan's ground plane. Points are [x, z] in metres.
export const SNAP = 0.05;
export const snapCfg = { on: true };
export const snap = (v, s = SNAP) => (snapCfg.on ? Math.round(v / s) * s : Math.round(v * 1000) / 1000);
export const r3 = (v) => Math.round(v * 1000) / 1000;

export function rectPoints(x, z, w, d) { return [[x, z], [x + w, z], [x + w, z + d], [x, z + d]]; }

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; a += x1 * z2 - x2 * z1; }
  return a / 2;
}
export const area = (pts) => Math.abs(signedArea(pts));

export function centroid(pts) {
  const A = signedArea(pts);
  if (Math.abs(A) < 1e-6) { const n = pts.length; return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]; }
  let cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; const f = x1 * z2 - x2 * z1; cx += (x1 + x2) * f; cz += (z1 + z2) * f; }
  return [cx / (6 * A), cz / (6 * A)];
}
// A point that is guaranteed to be inside (centroid if inside, else best interior sample).
export function labelPoint(pts) {
  const c = centroid(pts);
  if (pointInPolygon(c, pts)) return c;
  const b = bbox(pts); let best = c, bestD = -1;
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const p = [b.minX + (b.maxX - b.minX) * i / 12, b.minZ + (b.maxZ - b.minZ) * j / 12];
    if (!pointInPolygon(p, pts)) continue;
    const d = Math.min(...edges(pts).map(([a, bb]) => distToSeg(p, a, bb)));
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
}
export function pointInPolygon([x, z], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function bbox(pts) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) { minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); }
  return { minX, minZ, maxX, maxZ, w: maxX - minX, d: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}
export const edges = (pts) => pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
export function distToSeg([px, pz], [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
export function projectOnSeg([px, pz], [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  return { t, p: [ax + t * dx, az + t * dz], len: Math.sqrt(L) };
}
// Canonical description of the infinite line through a segment: direction angle in [0, π)
// and signed offset along its normal. Collinear segments share the same line.
export function lineOf([ax, az], [bx, bz]) {
  let ux = bx - ax, uz = bz - az; const L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;
  if (uz < -1e-9 || (Math.abs(uz) < 1e-9 && ux < 0)) { ux = -ux; uz = -uz; }
  const nx = -uz, nz = ux; // left normal
  return { ux, uz, nx, nz, off: ax * nx + az * nz, ang: Math.atan2(uz, ux) };
}
export const lineKey = (l) => `${Math.round(l.ang * 1800 / Math.PI)}|${Math.round(l.off * 100)}`;

// Snaps a point to grid, nearby vertices and (optionally) axis alignment with a previous point.
export function snapPoint(p, vertices = [], prev = null, tol = 0.15) {
  let best = null, bd = tol;
  for (const v of vertices) { const d = Math.hypot(v[0] - p[0], v[1] - p[1]); if (d < bd) { bd = d; best = v; } }
  if (best) return [best[0], best[1]];
  let [x, z] = [snap(p[0]), snap(p[1])];
  if (prev) {
    if (Math.abs(x - prev[0]) < tol) x = prev[0];
    if (Math.abs(z - prev[1]) < tol) z = prev[1];
    // align to vertices on the same row/column
    for (const v of vertices) { if (Math.abs(v[0] - x) < 0.08) x = v[0]; if (Math.abs(v[1] - z) < 0.08) z = v[1]; }
  }
  return [r3(x), r3(z)];
}
export function polyLength(pts) { return edges(pts).reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0); }
