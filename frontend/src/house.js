// Turns one level of the plan (polygon rooms + openings) into floors, walls, windows,
// doors, garage doors, slabs and shadow blockers. Walls are derived from room edges:
// an edge shared by two rooms becomes an interior wall, a lone edge an exterior wall.
// The segmentation idea comes from house-control (MIT, 0xProbabillity), generalised
// here from axis-aligned rectangles to arbitrary polygons.
import * as THREE from 'three';
import { mergeByMaterial } from '../../engine/recipe.js';
import { box, mat, surfaceMat, slatTex, garageTex, blockerMat, canvasTex, shade } from './kit.js';
import { edges, lineOf, lineKey, pointInPolygon, bbox, centroid } from './geometry.js';
import { slabThickness, plinthHeight } from './plan.js';
import { facadeMaterial, metricUV } from './roof.js';

export const EXT_T = 0.24, INT_T = 0.11, CURB = 0.14;
const EPS = 1e-4, PLINTH_OUT = 0.0225; // plinth stands 2.25 cm proud of the facade
const k3 = (v) => Math.round(v * 1000);

export const isIndoor = (r) => !r.kind || r.kind === 'room' || r.kind === 'garage';
const formsWalls = (r) => isIndoor(r) || r.kind === 'void';

function wallSegments(level) {
  const lines = new Map();
  for (const r of level.rooms.filter(formsWalls)) {
    for (const [a, b] of edges(r.points)) {
      const l = lineOf(a, b); const key = lineKey(l);
      if (!lines.has(key)) lines.set(key, { l, edges: [], openings: [] });
      const ta = a[0] * l.ux + a[1] * l.uz, tb = b[0] * l.ux + b[1] * l.uz;
      if (Math.abs(tb - ta) < 0.01) continue;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const side = pointInPolygon([mx + l.nx * 0.03, mz + l.nz * 0.03], r.points) ? 1 : -1;
      lines.get(key).edges.push({ a: Math.min(ta, tb), b: Math.max(ta, tb), side, room: r });
    }
  }
  for (const o of level.openings) {
    const lo = lineOf(o.from, o.to); let best = null, bd = 0.06;
    for (const L of lines.values()) {
      const da = Math.abs(L.l.ang - lo.ang); if (Math.min(da, Math.PI - da) > 0.01) continue;
      const d = Math.abs(L.l.off - (o.from[0] * L.l.nx + o.from[1] * L.l.nz)); if (d < bd) { bd = d; best = L; }
    }
    if (!best) continue;
    const ta = o.from[0] * best.l.ux + o.from[1] * best.l.uz, tb = o.to[0] * best.l.ux + o.to[1] * best.l.uz;
    best.openings.push({ o, a: Math.min(ta, tb), b: Math.max(ta, tb) });
  }
  const segs = [];
  for (const L of lines.values()) {
    const pts = [...new Set([...L.edges, ...L.openings].flatMap((e) => [k3(e.a), k3(e.b)]))].sort((p, q) => p - q).map((v) => v / 1000);
    const run = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const mid = (pts[i] + pts[i + 1]) / 2;
      const cov = L.edges.filter((e) => e.a < mid && mid < e.b);
      if (!cov.length) continue;
      const voidOnly = cov.every((e) => e.room.kind === 'void');
      if (voidOnly && cov.length === 1) { /* edge of a stair hole facing outside: railing */ }
      const seg = { l: L.l, a: pts[i], b: pts[i + 1], kind: cov.length > 1 || cov.some((e) => e.room.kind === 'void') ? 'interior' : 'exterior', side: cov[0].side, opening: L.openings.find((o) => o.a < mid && mid < o.b)?.o || null };
      const prev = run[run.length - 1];
      if (prev && Math.abs(prev.b - seg.a) < EPS && prev.kind === seg.kind && prev.side === seg.side && prev.opening === seg.opening) prev.b = seg.b; else run.push(seg);
    }
    run.forEach((s, i) => { s.freeA = !(run[i - 1] && Math.abs(run[i - 1].b - s.a) < EPS); s.freeB = !(run[i + 1] && Math.abs(run[i + 1].a - s.b) < EPS); });
    segs.push(...run);
  }
  return segs;
}

function shapeOf(points, holes = []) {
  const s = new THREE.Shape(); points.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); s.closePath();
  for (const h of holes) { const p = new THREE.Path(); h.forEach(([x, z], i) => (i ? p.lineTo(x, -z) : p.moveTo(x, -z))); p.closePath(); s.holes.push(p); }
  return s;
}
// Flat polygon at height y with world-metre UVs.
export function polyMesh(points, material, y = 0, uvScale = 2.4, holes = []) {
  const g = new THREE.ShapeGeometry(shapeOf(points, holes)); g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / uvScale, pos.getZ(i) / uvScale);
  return new THREE.Mesh(g, material);
}
function slab(points, y0, y1, material, holes = []) {
  const g = new THREE.ExtrudeGeometry(shapeOf(points, holes), { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return new THREE.Mesh(g, material);
}

const wallBody = () => mat('#e7e3db', { rough: 0.95 });
// Shared wall-top material: dark in 3D, light in the plan (top) view so walls read as lines.
export const capMat = new THREE.MeshStandardMaterial({ color: '#262b3a', roughness: 0.8 });
const frameMat = (c = '#2c3142') => mat(c, { rough: 0.6 });

// opts.terrain: terrain height relative to this floor (only for the storey standing on the
// terrain). Only that storey gets a plinth; it reaches from the terrain to plinth height.
export function buildLevel(level, site = {}, opts = {}) {
  const fac = facadeMaterial(site.facade), plinthM = mat(site.facade?.plinth || '#5f636b', { rough: 0.9 }), frameColor = site.facade?.frame || '#2c3142';
  const H = level.height, Hi = Math.min(level.cutHeight ?? 1.2, H), slabDepth = slabThickness(level);
  const terrain = Number.isFinite(opts.terrain) ? opts.terrain : null, plinthTop = terrain === null ? 0 : Math.max(terrain + plinthHeight(site), 0);
  const g = new THREE.Group();
  const floors = {}, overlays = {}, exterior = [], windows = {}, doors = {}, garages = {}, openingHits = [];
  const wb = wallBody(), cap = capMat;
  const wallMats = [wb, wb, cap, wb, wb, wb];

  const voids = level.rooms.filter((r) => r.kind === 'void'), walled = level.rooms.filter(formsWalls);
  for (const r of level.rooms) {
    if (r.kind === 'void') continue;
    const outdoor = r.kind === 'outdoor';
    const holes = outdoor ? [] : voids.filter((v) => pointInPolygon(centroid(v.points), r.points)).map((v) => v.points);
    const y = outdoor ? (r.surface === 'pool' ? 0.004 : 0.008 + (r.raise || 0)) : 0;
    const f = polyMesh(r.points, surfaceMat(r.surface || (outdoor ? 'lawn' : 'oak')), y, 2.4, holes);
    f.receiveShadow = true; f.userData = { room: r.id }; g.add(f); floors[r.id] = f;
    const ov = polyMesh(r.points, new THREE.MeshBasicMaterial({ color: '#79a6ff', transparent: true, opacity: 0, depthWrite: false }), y + 0.006, 2.4, holes);
    ov.renderOrder = 1; g.add(ov); overlays[r.id] = ov;
    if (!outdoor) {
      if (slabDepth > EPS) { const s = slab(r.points, -slabDepth, 0, mat('#1a2030', { rough: 0.9 }), holes); s.receiveShadow = true; s.castShadow = true; g.add(s); }
      const ceil = slab(r.points, H, H + 0.05, blockerMat); ceil.castShadow = true; ceil.userData.blocker = true; g.add(ceil);
    } else if (r.raise) {
      const s = slab(r.points, -0.02, r.raise, mat(shade('#6d6a63', 0), { rough: 0.9 })); s.receiveShadow = true; s.castShadow = true; g.add(s);
    }
  }

  // A wall piece on segment s from t=a..b, heights y0..y1, thickness t, shifted along the outward normal by off.
  const piece = (target, s, a, b, y0, y1, t, m = wallMats, off = 0) => {
    const len = b - a; if (len <= 0.001 || y1 - y0 <= 0.001) return null;
    const mesh = new THREE.Mesh(metricUV(new THREE.BoxGeometry(len, y1 - y0, t), len, y1 - y0, t), m);
    const mid = (a + b) / 2, l = s.l, on = -s.side; // outward normal sign
    mesh.position.set(l.ux * mid + l.nx * (l.off + on * off), (y0 + y1) / 2, l.uz * mid + l.nz * (l.off + on * off));
    mesh.rotation.y = Math.atan2(-l.uz, l.ux);
    mesh.castShadow = m !== blockerMat || true; mesh.receiveShadow = m !== blockerMat;
    target.add(mesh); return mesh;
  };
  const glassMat = () => new THREE.MeshStandardMaterial({ color: '#9cc0ff', roughness: 0.08, transparent: true, opacity: 0.22, emissive: '#3d5fae', emissiveIntensity: 0.5 });

  const opInfo = {};
  const inner = new THREE.Group(); // static interior walls, merged per material after the loop
  for (const s of wallSegments(level)) {
    const ext = s.kind === 'exterior', t = ext ? EXT_T : INT_T, o = s.opening, type = o?.type;
    if (o && !opInfo[o.id]) opInfo[o.id] = { t, side: s.side, l: s.l };
    // Free ends reach half their own thickness past the corner point: exterior corners close
    // flush, interior walls end inside the wall they meet instead of poking through its face.
    const a = s.a - (s.freeA ? t / 2 : 0), b = s.b + (s.freeB ? t / 2 : 0);
    const wallRot = Math.atan2(-s.l.uz, s.l.ux);
    const at = (tt, y = 0) => new THREE.Vector3(s.l.ux * tt + s.l.nx * s.l.off, y, s.l.uz * tt + s.l.nz * s.l.off);

    if (type === 'door') {
      const hinge = new THREE.Group(); const L = s.b - s.a - 0.04, h = ext ? (o.head ?? 2.1) : Math.min(o.head ?? 2.05, Hi - 0.02);
      const leaf = box(L, h, 0.04, mat(ext ? '#3a3f4b' : '#d6d0c4', { rough: 0.7 }), 0.01); leaf.position.x = L / 2; leaf.castShadow = true;
      hinge.add(leaf); hinge.position.copy(at(s.a + 0.02)); hinge.rotation.y = wallRot; hinge.userData.keep = true;
      doors[o.id] = { hinge, base: wallRot, swing: -s.side, cur: 0, ext };
    }
    if (type === 'garage') {
      const head = o.head ?? 2.2, w = s.b - s.a;
      const tex = garageTex.clone(); tex.repeat.set(Math.max(1, w / 1.2), head / 1.6); tex.needsUpdate = true;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, head, 0.05), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
      panel.geometry.translate(0, -head / 2, 0); panel.position.copy(at((s.a + s.b) / 2, head)); panel.rotation.y = wallRot; panel.castShadow = true; panel.userData.keep = true;
      garages[o.id] = { panel, cur: 0 };
    }
    if (!ext) {
      if (!type) { piece(inner, s, a, b, 0, Hi, t); if (Hi < H) piece(inner, s, a, b, Hi, H, 0.04, blockerMat); }
      else if (type === 'door') { g.add(doors[o.id].hinge); if (Hi < H) piece(inner, s, a, b, Math.max(Hi, o.head ?? 2.05), H, 0.04, blockerMat); }
      else if (type === 'garage') g.add(garages[o.id].panel);
      continue;
    }
    const full = new THREE.Group(), curb = new THREE.Group();
    const em = s.side > 0 ? [fac, fac, cap, fac, wb, fac] : [fac, fac, cap, fac, fac, wb];
    // The floor plate reaches the exterior face. This closes the seam to the level below
    // without extending the room slab across interior stair voids.
    if (slabDepth > EPS) { piece(full, s, a, b, -slabDepth, 0, t, em); piece(curb, s, a, b, -slabDepth, 0, t, em); }
    if (terrain !== null) {
      // Plinth 2.25 cm proud of the facade; its inner face stays inside the wall. Below the floor it
      // runs under every opening (step / foundation), above the floor only under solid wall.
      const grow = (tt, dir) => { const l = s.l, px = l.ux * (tt + dir * 0.15) + l.nx * (l.off + s.side * 0.15), pz = l.uz * (tt + dir * 0.15) + l.nz * (l.off + s.side * 0.15);
        return walled.some((r) => pointInPolygon([px, pz], r.points)) ? 0 : PLINTH_OUT; }; // only convex corners grow
      const pa = a - (s.freeA ? grow(s.a, -1) : 0), pb = b + (s.freeB ? grow(s.b, 1) : 0);
      const pl = (y0, y1) => piece(full, s, pa, pb, y0, y1, t + 0.02, plinthM, PLINTH_OUT - 0.01);
      const low = Math.min(terrain - 0.05, -slabDepth);
      if (!type || (type === 'window' && (o.sill ?? 0.9) >= plinthTop + 0.05)) pl(low, plinthTop);
      else if (low < 0) pl(low, Math.min(plinthTop, 0));
    }
    const blocker = (y0, y1) => piece(curb, s, a, b, y0, y1, t, blockerMat);
    if (type === 'door' || type === 'garage') {
      const head = o.head ?? (type === 'garage' ? 2.2 : 2.1);
      piece(full, s, a, b, head, H, t, em); blocker(head, H);
      const leafObj = type === 'door' ? doors[o.id].hinge : garages[o.id].panel; full.add(leafObj);
      if (type === 'garage') { const ghost = new THREE.Group(); curb.add(ghost); garages[o.id].curbParent = curb; garages[o.id].fullParent = full; }
    } else if (type === 'window') {
      const sill = o.sill ?? 0.9, head = Math.min(o.head ?? 2.2, H);
      piece(full, s, a, b, 0, sill, t, em); piece(full, s, a, b, head, H, t, em);
      piece(curb, s, a, b, 0, CURB, t, em); blocker(CURB, sill); blocker(head, H);
      const gm = glassMat(); const glass = piece(full, s, a, b, sill, head, 0.03, gm); glass.castShadow = false;
      const fw = 0.05;
      for (const [fa, fb, y0, y1] of [[a, a + fw, sill, head], [b - fw, b, sill, head], [a, b, sill, sill + fw], [a, b, head - fw, head]]) piece(full, s, fa, fb, y0, y1, 0.07, frameMat(frameColor));
      if (b - a > 1.3) piece(full, s, (a + b) / 2 - 0.025, (a + b) / 2 + 0.025, sill, head, 0.07, frameMat(frameColor));
      const sm = new THREE.MeshStandardMaterial({ map: slatTex.clone(), roughness: 0.6 }); sm.map.repeat.set(1, (head - sill) * 3); sm.map.needsUpdate = true;
      const shutter = piece(g, s, a + 0.03, b - 0.03, sill, head, 0.035, sm, 0.13);
      shutter.geometry.translate(0, -(head - sill) / 2, 0); shutter.position.y = head; shutter.castShadow = true; shutter.visible = !!o.cover;
      windows[o.id] = { glassMat: gm, shutter, cur: 1 };
      const hit = piece(g, s, a, b, sill, head, 0.4, new THREE.MeshBasicMaterial({ visible: false })); hit.userData.opening = o.id; hit.castShadow = false; openingHits.push(hit);
    } else if (type === 'open') {
      piece(full, s, a, b, Math.min(o.head ?? 2.3, H), H, t, em); blocker(Math.min(o.head ?? 2.3, H), H);
    } else { piece(full, s, a, b, 0, H, t, em); piece(curb, s, a, b, 0, CURB, t, em); blocker(CURB, H); }
    if (type === 'door' || type === 'garage' || type === 'open') { /* no curb in the opening */ }
    if (type === 'garage' || (type === 'door' && o.contact)) {
      const head = o.head ?? 2.2; const hit = piece(g, s, s.a, s.b, 0, head, 0.5, new THREE.MeshBasicMaterial({ visible: false })); hit.userData.opening = o.id; hit.castShadow = false; openingHits.push(hit);
    }
    full.traverse((m) => { if (m.isMesh && m.material !== blockerMat) { m.castShadow = true; m.receiveShadow = true; } });
    curb.traverse((m) => { if (m.isMesh && m.material === blockerMat) { m.castShadow = true; m.receiveShadow = false; } });
    // one mesh per material for this wall (door leaves and garage doors stay separate objects)
    const fullM = mergeByMaterial(full), curbM = mergeByMaterial(curb);
    if (garages[o?.id]) { garages[o.id].fullParent = fullM; garages[o.id].curbParent = curbM; }
    g.add(fullM, curbM);
    exterior.push({ nx: -s.side * s.l.nx, nz: -s.side * s.l.nz, full: fullM, curb: curbM });
  }
  inner.traverse((m) => { if (m.isMesh && m.material === blockerMat) { m.castShadow = true; m.receiveShadow = false; } });
  g.add(mergeByMaterial(inner));
  // blocker meshes are invisible to the camera but must cast shadows
  g.traverse((m) => { if (m.isMesh && m.material === blockerMat) { m.castShadow = true; m.receiveShadow = false; } });
  // Plan symbols (only shown in the top view): gap in the wall, glass line, door swing.
  const symbols = new THREE.Group(); symbols.visible = false; g.add(symbols);
  const gapM = new THREE.MeshBasicMaterial({ color: '#1a2133' }), glassM = new THREE.MeshBasicMaterial({ color: '#7fb2ff' }), gateM = new THREE.MeshBasicMaterial({ color: '#ffb35c' });
  const lineM = new THREE.LineBasicMaterial({ color: '#cfd6e4' });
  const ys = H + 0.08;
  for (const o of level.openings) {
    const info = opInfo[o.id]; if (!info) continue;
    const w = Math.hypot(o.to[0] - o.from[0], o.to[1] - o.from[1]); if (w < 0.05) continue;
    const ux = (o.to[0] - o.from[0]) / w, uz = (o.to[1] - o.from[1]) / w, cx = (o.from[0] + o.to[0]) / 2, cz = (o.from[1] + o.to[1]) / 2, rot = Math.atan2(-uz, ux);
    const bar = (len, thick, m, y) => { const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.01, thick), m); b.position.set(cx, y, cz); b.rotation.y = rot; b.renderOrder = 4; symbols.add(b); return b; };
    bar(w, info.t + 0.03, gapM, ys);
    if (o.type === 'window') bar(w, Math.max(0.04, info.t * 0.35), glassM, ys + 0.01);
    if (o.type === 'garage') bar(w, 0.05, gateM, ys + 0.01);
    if (o.type === 'door') {
      const nx = info.side * info.l.nx, nz = info.side * info.l.nz; const pts = [];
      const hx = o.from[0], hz = o.from[1];
      pts.push(new THREE.Vector3(hx, ys + 0.02, hz));
      for (let i = 0; i <= 16; i++) { const th = (i / 16) * Math.PI / 2; pts.push(new THREE.Vector3(hx + w * (Math.cos(th) * ux + Math.sin(th) * nx), ys + 0.02, hz + w * (Math.cos(th) * uz + Math.sin(th) * nz))); }
      pts.push(new THREE.Vector3(hx, ys + 0.02, hz));
      symbols.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineM));
    }
  }
  return { group: g, floors, overlays, exterior, windows, doors, garages, openingHits, symbols };
}

