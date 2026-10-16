"""Plan geometry checks used by the agent: snapping, overlaps, gaps.

Rooms are polygons of wall centre lines in metres ([x, z]); neighbouring rooms must share
edges exactly and must never overlap.
"""

from __future__ import annotations

import math
from typing import Any

Pt = list[float]

GRID = 0.05            # coordinates are rounded to this grid
SNAP_VERTEX = 0.15     # a vertex this close to an existing vertex is moved onto it
SNAP_EDGE = 0.12       # a vertex this close to an existing edge is moved onto it
OVERLAP_TOL = 0.04     # m² of overlap that is ignored (numeric noise)
GAP_MAX = 0.6          # parallel edges closer than this but not touching are reported as a gap

WALL_KINDS = ("room", "garage", None)
EXT_HALF = 0.12   # half of the 24 cm exterior wall
INT_HALF = 0.055  # half of the 11 cm interior wall


def rect_points(rect: list[float]) -> list[Pt]:
    x, z, w, d = (float(v) for v in rect)
    return [[x, z], [x + w, z], [x + w, z + d], [x, z + d]]


def area(pts: list[Pt]) -> float:
    s = 0.0
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        s += a[0] * b[1] - b[0] * a[1]
    return abs(s) / 2


def inside(p: Pt, pts: list[Pt]) -> bool:
    x, z = p
    c = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, zi = pts[i]
        xj, zj = pts[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi:
            c = not c
        j = i
    return c


def bbox(pts: list[Pt]) -> tuple[float, float, float, float]:
    xs, zs = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(zs), max(xs), max(zs)


def overlap_area(a: list[Pt], b: list[Pt], step: float = 0.05) -> float:
    """Approximate overlap area by sampling a grid inside the common bounding box."""
    ax0, az0, ax1, az1 = bbox(a)
    bx0, bz0, bx1, bz1 = bbox(b)
    x0, z0, x1, z1 = max(ax0, bx0), max(az0, bz0), min(ax1, bx1), min(az1, bz1)
    if x1 - x0 <= step or z1 - z0 <= step:
        return 0.0
    n = 0
    nx, nz = int((x1 - x0) / step), int((z1 - z0) / step)
    if nx * nz > 12000:  # keep it cheap: about 12k samples per pair is precise enough (±0.1 m²)
        step = math.sqrt((x1 - x0) * (z1 - z0) / 12000)
        nx, nz = max(1, int((x1 - x0) / step)), max(1, int((z1 - z0) / step))
    for i in range(nx):
        x = x0 + (i + 0.5) * step
        for k in range(nz):
            p = [x, z0 + (k + 0.5) * step]
            if inside(p, a) and inside(p, b):
                n += 1
    return n * step * step


def _closest_on_seg(p: Pt, a: Pt, b: Pt) -> tuple[Pt, float]:
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
    q = [a[0] + dx * t, a[1] + dz * t]
    return q, math.hypot(p[0] - q[0], p[1] - q[1])


def snap(points: list[Pt], others: list[list[Pt]]) -> tuple[list[Pt], list[str]]:
    """Aligns vertices with the walls of other rooms and rounds to the grid.

    Each coordinate snaps separately to the nearest x (or z) used by an existing vertex, so a
    rectangle stays a rectangle while it is pulled flush against its neighbours. Vertices that are
    not near an existing line are rounded to the 5 cm grid.
    """
    notes: list[str] = []
    xs = sorted({v[0] for poly in others for v in poly})
    zs = sorted({v[1] for poly in others for v in poly})

    def near(v: float, vals: list[float], tol: float) -> float | None:
        best = min(vals, key=lambda w: abs(w - v), default=None)
        return best if best is not None and abs(best - v) <= tol else None

    out = []
    moved = 0
    for p in points:
        x, z = float(p[0]), float(p[1])
        nx, nz = near(x, xs, SNAP_EDGE), near(z, zs, SNAP_EDGE)
        x2 = nx if nx is not None else round(x / GRID) * GRID
        z2 = nz if nz is not None else round(z / GRID) * GRID
        if (nx is not None and abs(nx - x) > 1e-6) or (nz is not None and abs(nz - z) > 1e-6):
            moved += 1
        out.append([round(x2, 3), round(z2, 3)])
    if moved:
        notes.append(f"{moved} Ecke(n) bündig an vorhandene Wände angepasst")
    clean = [p for i, p in enumerate(out) if math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1e-4]
    return clean, notes


def fmt(p: Pt) -> str:
    return f"[{p[0]:.2f}, {p[1]:.2f}]"


def gaps(a: list[Pt], b: list[Pt]) -> float | None:
    """Smallest distance between parallel, overlapping edges that do not touch (0 < d < GAP_MAX)."""
    best = None
    for i in range(len(a)):
        p, q = a[i], a[(i + 1) % len(a)]
        for k in range(len(b)):
            r, s = b[k], b[(k + 1) % len(b)]
            u = [q[0] - p[0], q[1] - p[1]]
            v = [s[0] - r[0], s[1] - r[1]]
            lu, lv = math.hypot(*u), math.hypot(*v)
            if lu < 0.3 or lv < 0.3:
                continue
            if abs(u[0] * v[1] - u[1] * v[0]) / (lu * lv) > 0.02:
                continue  # not parallel
            n = [-u[1] / lu, u[0] / lu]
            d = abs((r[0] - p[0]) * n[0] + (r[1] - p[1]) * n[1])
            if d < 0.02 or d > GAP_MAX:
                continue
            # overlap along the edge direction
            t = lambda w: ((w[0] - p[0]) * u[0] + (w[1] - p[1]) * u[1]) / lu  # noqa: E731
            lo, hi = sorted((t(r), t(s)))
            if min(hi, lu) - max(lo, 0) > 0.3:
                best = d if best is None else min(best, d)
    return best


def check_level(rooms: list[dict[str, Any]]) -> list[str]:
    """Human-readable problems of one level."""
    probs: list[str] = []
    walled = [r for r in rooms if r.get("kind") in WALL_KINDS and len(r.get("points") or []) >= 3]
    outdoor = [r for r in rooms if r.get("kind") == "outdoor" and len(r.get("points") or []) >= 3]
    for o in outdoor:
        for w in walled:
            ov = overlap_area(o["points"], w["points"])
            if ov > 0.3:
                probs.append(f"Außenfläche „{o.get('name')}“ liegt unter „{w.get('name')}“ ({ov:.1f} m²) – Außenfläche bis an die Wand zuschneiden")
    for i, a in enumerate(walled):
        if area(a["points"]) < 0.5:
            probs.append(f"„{a.get('name')}“ ist sehr klein ({area(a['points']):.2f} m²)")
        for b in walled[i + 1:]:
            ov = overlap_area(a["points"], b["points"])
            if ov > OVERLAP_TOL:
                probs.append(f"„{a.get('name')}“ und „{b.get('name')}“ überlappen um ca. {ov:.2f} m²")
                continue
            g = gaps(a["points"], b["points"])
            if g is not None:
                probs.append(f"Zwischen „{a.get('name')}“ und „{b.get('name')}“ ist eine Lücke von {g:.2f} m – gemeinsame Wand exakt auf dieselbe Linie legen")
    return probs


def shares_edge(edge: tuple[Pt, Pt], poly: list[Pt], tol: float = 0.03) -> bool:
    """True if the edge lies on an edge of poly for a length of at least 30 cm."""
    a, b = edge
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    if L < 1e-6:
        return False
    ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    for i in range(len(poly)):
        c, d = poly[i], poly[(i + 1) % len(poly)]
        if abs((c[0] - a[0]) * uz - (c[1] - a[1]) * ux) > tol or abs((d[0] - a[0]) * uz - (d[1] - a[1]) * ux) > tol:
            continue
        t1 = (c[0] - a[0]) * ux + (c[1] - a[1]) * uz
        t2 = (d[0] - a[0]) * ux + (d[1] - a[1]) * uz
        lo, hi = sorted((t1, t2))
        if min(hi, L) - max(lo, 0) > 0.3:
            return True
    return False


def net_area(room: dict[str, Any], rooms: list[dict[str, Any]]) -> float:
    """Clear floor area: the polygon minus half the wall thickness along each edge."""
    pts = room["points"]
    a = area(pts)
    if room.get("kind") == "outdoor":
        return a
    for i in range(len(pts)):
        e = (pts[i], pts[(i + 1) % len(pts)])
        L = math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1])
        shared = any(o is not room and o.get("kind") != "outdoor" and shares_edge(e, o["points"]) for o in rooms)
        a -= L * (INT_HALF if shared else EXT_HALF)
    return max(0.0, a + len(pts) * 0.01)  # small corner correction
