"""The HomeTwin agent: an OpenAI-compatible chat-completions loop with plan-editing tools.

The agent never edits the stored plan. Every tool call is validated and collected as an
operation; the panel shows them to the user, who applies the ones they want.
"""

from __future__ import annotations

import base64
import math
import time as _time_mod
import json
import re
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_API_KEY,
    CONF_BASE_URL,
    CONF_MAX_STEPS,
    CONF_MODEL,
    CONF_REASONING,
    CONF_SYSTEM_PROMPT,
    DEFAULT_BASE_URL,
    DEFAULT_MAX_STEPS,
    LEGACY_PROMPT_PREFIX,
    RELEVANT_DOMAINS,
)
from . import geometry as geo
from .i18n import hass_message, language_from_hass, message, normalize_language
from .views import read_underlay

_LOGGER = logging.getLogger(__name__)
_CATALOG: dict[str, Any] | None = None


@dataclass
class AgentConfig:
    base_url: str
    api_key: str
    model: str
    reasoning: str
    max_steps: int
    system_prompt: str

    @classmethod
    def from_options(cls, o: dict[str, Any]) -> AgentConfig:
        return cls(
            base_url=(o.get(CONF_BASE_URL) or DEFAULT_BASE_URL).rstrip("/"),
            api_key=o.get(CONF_API_KEY) or "",
            model=o.get(CONF_MODEL) or "",
            reasoning=o.get(CONF_REASONING) or "none",
            max_steps=int(o.get(CONF_MAX_STEPS) or DEFAULT_MAX_STEPS),
            system_prompt=_extra_prompt(o.get(CONF_SYSTEM_PROMPT)),
        )

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.model)


def _extra_prompt(v: Any) -> str:
    v = (v or "").strip()
    return "" if v.startswith(LEGACY_PROMPT_PREFIX) else v


CORE_PROMPT = """You are the assistant of HomeTwin, a 3D model of the user's home inside Home Assistant. You build and edit the model: levels, rooms, doors, windows, furniture and the placement of Home Assistant entities. You never control devices.

# How the model works
- A plan has levels (floors). Each level has rooms, openings, devices and furniture.
- Rooms are polygons in metres: points [[x, z], ...]. x grows to the right (east when north = 0), z grows downwards in the floor plan (south). A rectangle can be given as rect [x, z, width, depth] (x, z = top-left corner).
- Room polygons are WALL CENTRE LINES. Walls are generated automatically: an edge shared by two rooms becomes an interior wall (11 cm), a free edge an exterior wall (24 cm, centred on the edge). So the clear interior is about 6–12 cm smaller per side than the polygon.
- Room kinds: room (heated indoor room, gets walls), garage (gets walls), outdoor (terrace, garden, driveway: no walls), void (stairwell opening in a floor; created automatically above stairs).
- Openings (door, window, garage, open = passage without door) sit ON a room edge: from and to are two points on that edge. Rollers/blinds (cover.*) and door/window contacts (binary_sensor.*) belong to openings, not to devices.
- Devices are HA entities shown as 3D objects (lights, sensors, radiators …) at pos [x, z], with mounting height y and rotation rot in degrees (0 = front faces +z, 90 = +x, -90 = -x, 180 = -z).

# Geometry rules (critical)
1. Rooms on one level must NEVER overlap.
2. Neighbouring rooms share their common wall EXACTLY: identical coordinates on the shared edge, no gaps, no offsets. Build a floor like a puzzle: start with the outer footprint, then cut it into rooms that tile it completely.
3. Use a 5 cm grid. Prefer rectangles and L-shapes; walls are axis-parallel unless the plan clearly shows otherwise.
4. Corridors, hallways, stairs areas and storage rooms are rooms too. Leave no unexplained holes inside the footprint.
5. The tools snap corners to neighbouring walls and reject overlapping rooms with an error. When you get such an error, fix the coordinates and call the tool again; never ignore it.
6. Before you finish a floor, call check_plan and fix every reported overlap or gap.
7. Never invent dimensions. If size or position of a room is unknown, ask for width × depth and its position relative to an existing room, or suggest loading a floor plan image with the wizard.

# Floor plan images
- When an image is attached you get its pixel size and the scale (metres per pixel). Read the rooms at the centre of the wall lines, convert pixels to metres exactly as stated and name rooms after their labels.
- Dimension chains in the plan beat estimated pixel measurements. Check the total of each chain against the footprint.

# Entities
- Find entities with list_entities (filter by area). Only use entities that exist. Link rooms to the matching Home Assistant area (area_id).
- Placement: ceiling lights in the room centre or above tables; table and floor lamps next to sofa, bed or desk; wall devices (sensors, thermostats, wall lights, cameras) 0.02 m in front of the wall with the front facing into the room; radiators below windows. Covers and contacts: update_opening on the matching window/door, add the opening first if it is missing.

# Answering
- All changes go through the tools and are shown to the user as a preview first.
- Reply briefly in the user's language. Summarise what you propose, what you assumed and what is still missing."""


def _load_catalog() -> dict[str, Any]:
    return json.loads((Path(__file__).parent / "catalog.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- tool schema
_PT = {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2, "description": "[x, z] in Metern"}


def _fn(name: str, desc: str, props: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {"type": "object", "properties": props, "required": required}}}


def _tools(cat: dict[str, Any]) -> list[dict[str, Any]]:
    kinds = list(cat["device_kinds"])
    styles = sorted({s for group in cat["styles"].values() for s in group})
    return [
        _fn("list_entities", "Listet Home-Assistant-Entitäten mit Bereich, Etage und ob sie schon im Modell platziert sind.",
            {"area_id": {"type": "string"}, "domain": {"type": "string"}, "only_unplaced": {"type": "boolean"}}, []),
        _fn("add_level", "Neue Etage anlegen.", {"name": {"type": "string"}, "elevation": {"type": "number", "description": "Fußbodenhöhe über Grund in m"}, "height": {"type": "number", "description": "Lichte Raumhöhe in m"}, "slab": {"type": "number", "description": "Deckenstärke unter dieser Etage in m (Standard 0.25)"}, "floor_id": {"type": "string"}}, ["name", "elevation"]),
        _fn("add_room", "Raum oder Außenfläche anlegen. Entweder rect [x, z, breite, tiefe] oder points.",
            {"level_id": {"type": "string"}, "name": {"type": "string"}, "kind": {"type": "string", "enum": cat["room_kinds"]}, "surface": {"type": "string", "enum": list(cat["surfaces"])},
             "area_id": {"type": "string"}, "rect": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4}, "points": {"type": "array", "items": _PT, "minItems": 3}}, ["level_id", "name"]),
        _fn("update_room", "Raum ändern (Name, Art, Oberfläche, Bereich, Form).",
            {"room_id": {"type": "string"}, "name": {"type": "string"}, "kind": {"type": "string", "enum": cat["room_kinds"]}, "surface": {"type": "string", "enum": list(cat["surfaces"])},
             "area_id": {"type": "string"}, "rect": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4}, "points": {"type": "array", "items": _PT, "minItems": 3}}, ["room_id"]),
        _fn("add_opening", "Tür, Fenster, Garagentor oder Durchgang auf eine Raumkante setzen (from/to liegen auf der Kante).",
            {"level_id": {"type": "string"}, "type": {"type": "string", "enum": cat["opening_types"]}, "from": _PT, "to": _PT, "sill": {"type": "number"}, "head": {"type": "number"},
             "cover": {"type": "string", "description": "cover.* Entität (Rollladen/Tor)"}, "contact": {"type": "string", "description": "binary_sensor.* Tür-/Fensterkontakt"}}, ["level_id", "type", "from", "to"]),
        _fn("update_opening", "Öffnung ändern oder mit Rollladen/Kontakt verknüpfen.",
            {"opening_id": {"type": "string"}, "type": {"type": "string", "enum": cat["opening_types"]}, "sill": {"type": "number"}, "head": {"type": "number"}, "cover": {"type": "string"}, "contact": {"type": "string"}}, ["opening_id"]),
        _fn("place_device", "Gerät setzen und optional mit einer Entität verknüpfen.",
            {"level_id": {"type": "string"}, "kind": {"type": "string", "enum": kinds}, "style": {"type": "string", "enum": styles}, "entity_id": {"type": "string"}, "pos": _PT,
             "y": {"type": "number", "description": "Montagehöhe in m (optional)"}, "elevation": {"type": "number", "description": "Object bottom above this floor in metres (independent of object dimensions)."}, "autoElevation": {"type": "boolean", "description": "Automatically settle onto supporting furniture or floor when moved; false keeps the explicit elevation."}, "rot": {"type": "number"}, "length": {"type": "number"}}, ["level_id", "kind", "pos"]),
        _fn("update_device", "Gerät ändern (Entität, Darstellung, Position).",
            {"device_id": {"type": "string"}, "entity_id": {"type": "string"}, "kind": {"type": "string", "enum": kinds}, "style": {"type": "string", "enum": styles}, "pos": _PT, "y": {"type": "number"}, "elevation": {"type": "number", "description": "Object bottom above this floor in metres (independent of object dimensions)."}, "autoElevation": {"type": "boolean", "description": "Automatically settle onto supporting furniture or floor when moved; false keeps the explicit elevation."}, "rot": {"type": "number"}, "length": {"type": "number"}}, ["device_id"]),
        _fn("place_furniture", "Möbel oder Gartenobjekt setzen.",
            {"level_id": {"type": "string"}, "type": {"type": "string", "enum": list(cat["furniture"])}, "pos": _PT, "elevation": {"type": "number", "description": "Object bottom above this floor in metres (independent of object dimensions)."}, "autoElevation": {"type": "boolean", "description": "Automatically settle onto supporting furniture or floor when moved; false keeps the explicit elevation."}, "rot": {"type": "number"}, "width": {"type": "number"}, "depth": {"type": "number"}, "height": {"type": "number"}, "color": {"type": "string"}}, ["level_id", "type", "pos"]),
        _fn("move_item", "Gerät oder Möbel verschieben/drehen.", {"item_id": {"type": "string"}, "pos": _PT, "elevation": {"type": "number", "description": "Object bottom above this floor in metres (independent of object dimensions)."}, "autoElevation": {"type": "boolean", "description": "Automatically settle onto supporting furniture or floor when moved; false keeps the explicit elevation."}, "rot": {"type": "number"}}, ["item_id"]),
        _fn("delete_item", "Raum, Öffnung, Gerät oder Möbel löschen.", {"item_id": {"type": "string"}}, ["item_id"]),
        _fn("check_plan", "Prüft die Geometrie (inklusive deiner bisherigen Vorschläge): Überlappungen, Lücken zwischen Räumen, sehr kleine Räume. Gibt pro Etage Probleme und eine Raumliste mit Flächen zurück.",
            {"level_id": {"type": "string"}}, []),
    ]


# ---------------------------------------------------------------- context
def _r(v: Any) -> Any:
    if isinstance(v, float):
        return round(v, 2)
    if isinstance(v, list):
        return [_r(x) for x in v]
    return v


def _used(plan: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for lvl in plan.get("levels", []):
        out.update(d["entity_id"] for d in lvl.get("devices", []) if d.get("entity_id"))
        for o in lvl.get("openings", []):
            out.update(x for x in (o.get("cover"), o.get("contact")) if x)
    return out


def _plan_summary(plan: dict[str, Any]) -> dict[str, Any]:
    levels = []
    for lvl in plan.get("levels", []):
        levels.append({
            "id": lvl["id"], "name": lvl.get("name"), "floor_id": lvl.get("floor_id"), "elevation": lvl.get("elevation"), "height": lvl.get("height"),
            "rooms": [{"id": r["id"], "name": r.get("name"), "kind": r.get("kind"), "area_id": r.get("area_id"), "points": _r(r.get("points"))} for r in lvl.get("rooms", [])],
            "openings": [{k: _r(o.get(k)) for k in ("id", "type", "from", "to", "cover", "contact") if o.get(k) is not None} for o in lvl.get("openings", [])],
            "devices": [{k: _r(d.get(k)) for k in ("id", "kind", "style", "entity_id", "pos", "y", "rot") if d.get(k) is not None} for d in lvl.get("devices", [])],
            "furniture": [{k: _r(f.get(k)) for k in ("id", "type", "pos", "rot", "width", "depth") if f.get(k) is not None} for f in lvl.get("furniture", [])],
            "underlay": {k: lvl["underlay"].get(k) for k in ("x0", "z0", "mpp", "wpx", "hpx")} if lvl.get("underlay") else None,
        })
    return {"name": plan.get("name"), "north": (plan.get("site") or {}).get("north", 0), "levels": levels}


def _entities(hass: HomeAssistant, plan: dict[str, Any]) -> list[dict[str, Any]]:
    ent_reg, dev_reg, area_reg = er.async_get(hass), dr.async_get(hass), ar.async_get(hass)
    used = _used(plan)
    out = []
    for st in hass.states.async_all(list(RELEVANT_DOMAINS)):
        dom, dc = st.domain, st.attributes.get("device_class")
        if dom == "sensor" and dc not in ("temperature", "humidity"):
            continue
        if dom == "binary_sensor" and dc not in ("door", "window", "garage_door", "opening", "motion", "occupancy", "presence", "smoke", "carbon_monoxide", "gas", "moisture", "safety"):
            continue
        entry = ent_reg.async_get(st.entity_id)
        area_id = entry.area_id if entry else None
        if not area_id and entry and entry.device_id and (dev := dev_reg.async_get(entry.device_id)):
            area_id = dev.area_id
        if dom == "switch" and not area_id:
            continue
        area = area_reg.async_get_area(area_id) if area_id else None
        out.append({"entity_id": st.entity_id, "name": st.name, "device_class": dc, "area_id": area_id, "area": area.name if area else None,
                    "floor_id": area.floor_id if area else None, "placed": st.entity_id in used})
    return out


def _context(hass: HomeAssistant, cat: dict[str, Any], plan: dict[str, Any], level_id: str | None) -> str:
    areas = [{"area_id": a.id, "name": a.name, "floor_id": a.floor_id} for a in ar.async_get(hass).async_list_areas()]
    floors = []
    try:
        from homeassistant.helpers import floor_registry as fr  # noqa: PLC0415
        floors = [{"floor_id": f.floor_id, "name": f.name, "level": f.level} for f in fr.async_get(hass).async_list_floors()]
    except ImportError:
        pass
    kinds = {k: {"label": v["label"], "domains": v["domains"], "styles": cat["styles"].get(k)} for k, v in cat["device_kinds"].items()}
    furniture = {k: f'{v["label"]} ({v["width"]}×{v["depth"]} m, {v["category"]})' for k, v in cat["furniture"].items()}
    return "\n".join([
        f"Aktive Etage (level_id): {level_id}",
        "Home-Assistant-Etagen: " + json.dumps(floors, ensure_ascii=False),
        "Home-Assistant-Bereiche: " + json.dumps(areas, ensure_ascii=False),
        "Gerätearten: " + json.dumps(kinds, ensure_ascii=False),
        "Möbeltypen: " + json.dumps(furniture, ensure_ascii=False),
        "Oberflächen: " + json.dumps({k: v["label"] for k, v in cat["surfaces"].items()}, ensure_ascii=False),
        "Aktueller Plan: " + json.dumps(_plan_summary(plan), ensure_ascii=False, separators=(",", ":")),
    ])


# ---------------------------------------------------------------- validation of tool calls
class _Work:
    """Tracks ids that exist (in the plan or created by this run) and collects operations."""

    def __init__(self, hass: HomeAssistant, cat: dict[str, Any], plan: dict[str, Any]) -> None:
        self.hass, self.cat, self.ops = hass, cat, []
        self.language = language_from_hass(hass)
        self.levels = {lvl["id"] for lvl in plan.get("levels", [])}
        self.items: dict[str, str] = {}
        self.rooms: dict[str, dict[str, Any]] = {}
        for lvl in plan.get("levels", []):
            for r in lvl.get("rooms", []):
                if len(r.get("points") or []) >= 3:
                    self.rooms[r["id"]] = {"level": lvl["id"], "name": r.get("name"), "kind": r.get("kind") or "room", "points": r["points"]}
        for lvl in plan.get("levels", []):
            for key, typ in (("rooms", "room"), ("openings", "opening"), ("devices", "device"), ("furniture", "furniture")):
                for it in lvl.get(key, []):
                    self.items[it["id"]] = typ
        self.n = 0

    def _id(self, prefix: str) -> str:
        self.n += 1
        return f"ai_{prefix}{self.n}"

    def _entity(self, eid: Any, domains: tuple[str, ...] | None = None) -> None:
        if eid in (None, ""):
            return
        if not isinstance(eid, str) or self.hass.states.get(eid) is None:
            raise ValueError(message(self.language, "entity_missing", entity=eid))
        if domains and eid.split(".")[0] not in domains:
            raise ValueError(message(self.language, "entity_domain", entity=eid, domains=", ".join(domains)))

    def _level(self, a: dict[str, Any]) -> None:
        if a.get("level_id") not in self.levels:
            raise ValueError(message(self.language, "unknown_level", level=a.get("level_id")))

    def _item(self, iid: Any, *types: str) -> None:
        if self.items.get(iid) not in types:
            raise ValueError(message(self.language, "unknown_id", id=iid))

    def _pt(self, p: Any, name: str) -> None:
        if not (isinstance(p, list) and len(p) == 2 and all(isinstance(v, (int, float)) for v in p)):
            raise ValueError(message(self.language, "point_shape", name=name))

    def _shape(self, a: dict[str, Any], level: str, kind: str, name: str, skip: str | None = None) -> tuple[list[list[float]], list[str]]:
        """Points from rect/points, snapped to the neighbours; raises on overlaps."""
        if isinstance(a.get("rect"), list) and len(a["rect"]) == 4:
            pts = geo.rect_points(a["rect"])
        else:
            for p in a.get("points") or []:
                self._pt(p, "points[]")
            pts = [[float(p[0]), float(p[1])] for p in a["points"]]
        if len(pts) < 3 or geo.area(pts) < 0.2:
            raise ValueError(message(self.language, "room_too_small_shape"))
        others = [r for rid, r in self.rooms.items() if r["level"] == level and rid != skip]
        pts, notes = geo.snap(pts, [r["points"] for r in others], self.language)
        if kind in ("room", "garage"):
            clashes = [(r, geo.overlap_area(pts, r["points"])) for r in others if r["kind"] in ("room", "garage")]
            clashes = [(r, ov) for r, ov in clashes if ov > geo.OVERLAP_TOL]
            if clashes:
                raise ValueError(message(self.language, "overlap_intro") + "; ".join(
                    message(self.language, "overlap_item", name=name, other=r["name"], area=ov, points=r["points"]) for r, ov in clashes)
                    + message(self.language, "overlap_hint"))
        return pts, notes

    def check(self, level_id: str | None) -> dict[str, Any]:
        out = {}
        for lid in ([level_id] if level_id in self.levels else sorted(self.levels)):
            rooms = [r for r in self.rooms.values() if r["level"] == lid]
            out[lid] = {"problems": geo.check_level(rooms, self.language) or [message(self.language, "none")],
                        "rooms": [{"name": r["name"], "kind": r["kind"], "area_m2": round(geo.area(r["points"]), 2), "bbox": [round(v, 2) for v in geo.bbox(r["points"])]} for r in rooms]}
        return out

    def call(self, name: str, a: dict[str, Any]) -> dict[str, Any]:
        cat = self.cat
        if name == "check_plan":
            return self.check(a.get("level_id"))
        if name == "add_level":
            lid = self._id("l"); self.levels.add(lid)
            self.ops.append({"op": "add_level", "id": lid, **{k: a[k] for k in ("name", "elevation", "height", "slab", "floor_id") if k in a}})
            return {"ok": True, "id": lid}
        if name == "add_room":
            self._level(a)
            if not (isinstance(a.get("rect"), list) and len(a["rect"]) == 4) and not (isinstance(a.get("points"), list) and len(a["points"]) >= 3):
                raise ValueError(message(self.language, "room_geometry"))
            for p in a.get("points") or []:
                self._pt(p, "points[]")
            if a.get("kind") and a["kind"] not in cat["room_kinds"]:
                raise ValueError(message(self.language, "unknown_room_kind"))
            kind = a.get("kind") or "room"
            pts, notes = self._shape(a, a["level_id"], kind, a.get("name") or message(self.language, "room"))
            rid = self._id("r"); self.items[rid] = "room"
            self.rooms[rid] = {"level": a["level_id"], "name": a.get("name"), "kind": kind, "points": pts}
            op = {k: v for k, v in a.items() if k != "rect"}
            self.ops.append({"op": "add_room", "id": rid, **op, "points": pts})
            return {"ok": True, "id": rid, "points": pts, "area_m2": round(geo.area(pts), 2), **({"adjusted": notes} if notes else {})}
        if name == "update_room":
            self._item(a.get("room_id"), "room")
            cur = self.rooms.get(a["room_id"]) or {}
            res: dict[str, Any] = {"ok": True}
            op = {k: v for k, v in a.items() if k != "rect"}
            if a.get("rect") or a.get("points"):
                pts, notes = self._shape(a, cur.get("level"), a.get("kind") or cur.get("kind", "room"), a.get("name") or cur.get("name") or message(self.language, "room"), skip=a["room_id"])
                op["points"] = pts; res.update({"points": pts, **({"adjusted": notes} if notes else {})})
                if cur:
                    cur["points"] = pts
            if cur and a.get("name"):
                cur["name"] = a["name"]
            if cur and a.get("kind"):
                cur["kind"] = a["kind"]
            self.ops.append({"op": "update_room", **op}); return res
        if name == "add_opening":
            self._level(a); self._pt(a.get("from"), "from"); self._pt(a.get("to"), "to")
            if a.get("type") not in cat["opening_types"]:
                raise ValueError(message(self.language, "unknown_opening_kind"))
            self._entity(a.get("cover"), ("cover",)); self._entity(a.get("contact"), ("binary_sensor",))
            oid = self._id("o"); self.items[oid] = "opening"
            self.ops.append({"op": "add_opening", "id": oid, **a}); return {"ok": True, "id": oid}
        if name == "update_opening":
            self._item(a.get("opening_id"), "opening"); self._entity(a.get("cover"), ("cover",)); self._entity(a.get("contact"), ("binary_sensor",))
            self.ops.append({"op": "update_opening", **a}); return {"ok": True}
        if name == "place_device":
            self._level(a); self._pt(a.get("pos"), "pos")
            kind = cat["device_kinds"].get(a.get("kind"))
            if not kind:
                raise ValueError(message(self.language, "unknown_device_kind"))
            self._entity(a.get("entity_id"), tuple(kind["domains"]))
            did = self._id("d"); self.items[did] = "device"
            self.ops.append({"op": "place_device", "id": did, **a}); return {"ok": True, "id": did}
        if name == "update_device":
            self._item(a.get("device_id"), "device"); self._entity(a.get("entity_id"))
            if a.get("pos") is not None:
                self._pt(a["pos"], "pos")
            self.ops.append({"op": "update_device", **a}); return {"ok": True}
        if name == "place_furniture":
            self._level(a); self._pt(a.get("pos"), "pos")
            if a.get("type") not in cat["furniture"]:
                raise ValueError(message(self.language, "unknown_furniture_kind"))
            fid = self._id("f"); self.items[fid] = "furniture"
            self.ops.append({"op": "place_furniture", "id": fid, **a}); return {"ok": True, "id": fid}
        if name == "move_item":
            self._item(a.get("item_id"), "device", "furniture")
            if a.get("pos") is not None:
                self._pt(a["pos"], "pos")
            self.ops.append({"op": "move_item", **a}); return {"ok": True}
        if name == "delete_item":
            self._item(a.get("item_id"), "room", "opening", "device", "furniture")
            self.items.pop(a["item_id"], None); self.rooms.pop(a["item_id"], None); self.ops.append({"op": "delete_item", **a}); return {"ok": True}
        raise ValueError(message(self.language, "unknown_tool", tool=name))


# ---------------------------------------------------------------- loop
def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ""


async def _post(hass: HomeAssistant, cfg: AgentConfig, payload: dict[str, Any]) -> dict[str, Any]:
    headers = {"Content-Type": "application/json", "X-Title": "HomeTwin for Home Assistant"}
    if cfg.api_key:
        headers["Authorization"] = f"Bearer {cfg.api_key}"
    session = async_get_clientsession(hass)
    try:
        async with session.post(f"{cfg.base_url}/chat/completions", json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=240)) as resp:
            body = await resp.text()
            if resp.status != 200:
                raise HomeAssistantError(hass_message(hass, "endpoint_status", status=resp.status, body=body[:400]))
            return json.loads(body)
    except (aiohttp.ClientError, TimeoutError) as err:
        raise HomeAssistantError(hass_message(hass, "endpoint_unreachable", error=err)) from err
    except json.JSONDecodeError as err:
        raise HomeAssistantError(hass_message(hass, "endpoint_not_json")) from err


async def _post_stream(hass: HomeAssistant, cfg: AgentConfig, payload: dict[str, Any], on_text: Any = None) -> str:
    """Streams a chat completion (SSE) and returns the full message text; falls back to plain JSON."""
    headers = {"Content-Type": "application/json", "X-Title": "HomeTwin for Home Assistant", "Accept": "text/event-stream"}
    if cfg.api_key:
        headers["Authorization"] = f"Bearer {cfg.api_key}"
    session = async_get_clientsession(hass)
    text = ""
    try:
        async with session.post(f"{cfg.base_url}/chat/completions", json={**payload, "stream": True}, headers=headers,
                                timeout=aiohttp.ClientTimeout(total=300, sock_read=90)) as resp:
            if resp.status != 200:
                raise HomeAssistantError(hass_message(hass, "endpoint_status", status=resp.status, body=(await resp.text())[:400]))
            if "text/event-stream" not in resp.headers.get("Content-Type", ""):
                data = json.loads(await resp.text())
                return _text(data["choices"][0]["message"].get("content"))
            buf = b""
            async for chunk in resp.content.iter_any():
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    line = line.strip()
                    if not line.startswith(b"data:"):
                        continue
                    data_s = line[5:].strip()
                    if data_s == b"[DONE]":
                        return text
                    try:
                        ev = json.loads(data_s)
                    except json.JSONDecodeError:
                        continue
                    if ev.get("error"):
                        raise HomeAssistantError(hass_message(hass, "model_error", error=str(ev["error"])[:300]))
                    choice = (ev.get("choices") or [{}])[0]
                    delta = (choice.get("delta") or {}).get("content")
                    if delta:
                        text += delta if isinstance(delta, str) else _text(delta)
                        if on_text:
                            on_text(text)
                    if choice.get("finish_reason"):
                        if choice["finish_reason"] == "length":
                            _LOGGER.warning("HomeTwin: model output was cut off (max tokens); trying to use the partial answer")
                        return text  # do not wait for the server to close the stream
            return text
    except (aiohttp.ClientError, TimeoutError) as err:
        raise HomeAssistantError(hass_message(hass, "model_connection", error=err or type(err).__name__)) from err
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as err:
        raise HomeAssistantError(hass_message(hass, "endpoint_unreadable")) from err


async def run_agent(hass: HomeAssistant, cfg: AgentConfig, history: list[dict[str, Any]], plan: dict[str, Any], level_id: str | None, include_underlay: bool) -> dict[str, Any]:
    global _CATALOG  # noqa: PLW0603
    if _CATALOG is None:
        _CATALOG = await hass.async_add_executor_job(_load_catalog)
    cat = _CATALOG
    level_id = level_id or (plan.get("levels") or [{}])[0].get("id")
    system = CORE_PROMPT + (f"\n\n# Additional instructions from the owner\n{cfg.system_prompt}" if cfg.system_prompt else "")
    messages: list[dict[str, Any]] = [{"role": "system", "content": f"{system}\n\n# Current context\n{_context(hass, cat, plan, level_id)}"}]
    for m in history[-16:]:
        if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str):
            messages.append({"role": m["role"], "content": m["content"]})

    if include_underlay and messages[-1]["role"] == "user":
        level = next((lvl for lvl in plan.get("levels", []) if lvl.get("id") == level_id), None)
        u = (level or {}).get("underlay")
        img = await hass.async_add_executor_job(read_underlay, hass.config.path(), level_id) if u else None
        if img:
            mime = "image/png" if img.startswith(b"\x89PNG") else "image/jpeg"
            note = (f"Grundriss-Bild der Etage {level_id}: {u['wpx']}×{u['hpx']} Pixel. Pixel (px, py) entspricht x = {u['x0']} + px·{u['mpp']:.5f}, "
                    f"z = {u['z0']} + py·{u['mpp']:.5f} (Meter). Lege Räume als Polygone in diesen Koordinaten an.")
            messages[-1] = {"role": "user", "content": [{"type": "text", "text": f"{messages[-1]['content']}\n\n{note}"},
                                                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(img).decode()}"}}]}

    work = _Work(hass, cat, plan)
    tools = _tools(cat)
    reply = ""
    for _step in range(max(1, cfg.max_steps)):
        payload: dict[str, Any] = {"model": cfg.model, "messages": messages, "tools": tools, "tool_choice": "auto"}
        if cfg.reasoning in ("low", "medium", "high"):
            if "openrouter.ai" in cfg.base_url:
                payload["reasoning"] = {"effort": cfg.reasoning}
            else:
                payload["reasoning_effort"] = cfg.reasoning
        data = await _post(hass, cfg, payload)
        try:
            msg = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as err:
            raise HomeAssistantError(hass_message(hass, "unexpected_response", response=str(data)[:300])) from err
        calls = msg.get("tool_calls") or []
        messages.append({"role": "assistant", "content": _text(msg.get("content")) or None, **({"tool_calls": calls} if calls else {})})
        if not calls:
            reply = _text(msg.get("content"))
            break
        for tc in calls:
            fn = tc.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
                if fn.get("name") == "list_entities":
                    ents = _entities(hass, plan)
                    if args.get("area_id"):
                        ents = [e for e in ents if e["area_id"] == args["area_id"]]
                    if args.get("domain"):
                        ents = [e for e in ents if e["entity_id"].startswith(args["domain"] + ".")]
                    if args.get("only_unplaced"):
                        ents = [e for e in ents if not e["placed"]]
                    result: dict[str, Any] = {"entities": ents[:300]}
                else:
                    result = work.call(fn.get("name", ""), args)
            except (ValueError, TypeError, json.JSONDecodeError) as err:
                result = {"ok": False, "error": str(err)}
            messages.append({"role": "tool", "tool_call_id": tc.get("id"), "content": json.dumps(result, ensure_ascii=False)})
    else:
        reply = "Ich habe die maximale Anzahl an Schritten erreicht. Hier ist der bisherige Vorschlag."
    _LOGGER.debug("HomeTwin agent proposed %d operations", len(work.ops))
    return {"reply": reply, "operations": work.ops}


# ---------------------------------------------------------------- floor plan recognition (wizard)
DETECT_PROMPT = """You read architectural floor plans. Return ONLY a JSON object, no prose, no code fence.

Coordinates are PIXELS of the attached image: [px, py], origin top-left, px to the right, py downwards.
Image size: {w} × {h} px. Scale: 1 px = {mpp:.5f} m (so 1 m = {ppm:.1f} px).

Return:
{{
  "rooms": [{{"name": "Kitchen", "kind": "room", "points": [[px, py], ...], "label_area_m2": 12.4, "clear_w": 3.51, "clear_d": 2.76}}],
  "openings": [{{"type": "door", "from": [px, py], "to": [px, py], "label": "t12", "width_m": 0.885, "height_m": null, "sill_m": null, "hinge": "from", "opens_into": "Kitchen"}}],
  "stairs": [{{"points": [[px, py], ...], "up_from": [px, py], "up_to": [px, py], "width_m": 1.0}}],
  "dimensions": [{{"from": [px, py], "to": [px, py], "meters": 11.49, "text": "11,49"}}],
  "level": {{"name": "Erdgeschoss", "floor_elevation_m": 0.0, "room_height_m": 2.6, "slab_thickness_m": null}},
  "roof": {{"type": "gable", "pitch_deg": 38, "ridge": "x", "main_building": [[px, py], ...]}},
  "notes": "short remarks on anything unclear"
}}

Rules:
- Trace every room along the CENTRE of its wall lines. Neighbouring rooms use IDENTICAL coordinates for the shared wall. Rooms must not overlap and must tile the building footprint without gaps (hallways, storage, stairs areas are rooms too).
- Walls are horizontal/vertical unless clearly drawn otherwise. Use as few corners as possible (rectangles, L-shapes).
- kind: "room" for indoor rooms, "garage" for garages with walls, "outdoor" for terraces, balconies, gardens and open carports. Outdoor areas must NOT overlap rooms or garages: they end at the wall of the neighbouring building part (a carport next to a garage stops at the garage wall).
- Stairs: the stair area belongs to the hallway room it is in (Flur, Diele, hall) unless the plan labels it as its own room – include it in that room's polygon AND report it in "stairs".
- L-shaped or irregular rooms: the polygon must match the printed area (label_area_m2) after subtracting the walls; check this before answering.
- name: the label written in the plan (keep its language); if there is none, a sensible name in {lang}.
- label_area_m2: the area printed in the plan for that room (e.g. "12,40 m²"), if any (number), else null.
- clear_w / clear_d: the CLEAR interior dimensions printed for that room (inner dimension lines or labels like "3,51 x 2,76"), in metres: clear_w along the image x axis (left-right), clear_d along the image y axis (top-bottom). null if not printed. Read printed numbers exactly; do not estimate them.
- stairs: footprint polygon of the flight, "up_from"/"up_to" = start and end of the walking line in the direction going UP (follow the arrow / "S" marks / step numbers), width_m = flight width.
- level: the storey shown (name as printed, e.g. "Erdgeschoss", "Obergeschoss", "Kellergeschoss"), floor elevation (e.g. "OKFF ±0,00" or "+2,85") and clear room height if printed (e.g. "RH 2,50", "lichte Höhe"). floor_elevation_m is relative to the ground floor (±0,00), never metres above sea level. slab_thickness_m: thickness of the floor slab under this storey including screed, only if dimensioned (section, "Decke 22 cm + Estrich"). null values if not printed; never guess.
- roof: only if the plan shows or states it (roof outline, "SD 38°", "Satteldach", ridge line "First"): type one of flat, shed, gable, hip; pitch in degrees; ridge "x" if the ridge runs left-right in the image, "y" if top-bottom; main_building = outline of the part the roof covers (without garage/carport). Otherwise null.
- dimensions: up to 8 printed dimension lines (long outer chains preferred) with their two end points in pixels, the printed text exactly as written in "text" and your reading in metres. They are used to verify the scale.
- PRINTED DIMENSIONS BEAT PIXELS: place walls so that the printed dimensions are met.
- openings: doors ("door"), windows ("window"), garage doors ("garage"), openings without door ("open"); from/to are the two ends ON the wall centre line.
  Be exhaustive: walk along EVERY wall of EVERY room and report each gap in the wall. A door usually shows a leaf line and a quarter-circle swing arc; a window shows two or three thin parallel lines inside the wall; glazed doors (to terraces, balconies) count as doors; sliding doors show overlapping leaves.
  hinge: "from" or "to" = the end where the door leaf is attached (where the arc starts); opens_into: name of the room (or "outside") the leaf swings into. null for windows and openings without a door.
  width_m / height_m / sill_m: from the printed opening label if there is one (often "width/height", sometimes a sill mark), else null. label: id of that label from the label list, if a list is given.{skip}
{notation}{labels}{locked}{hints}"""

NOTATION_HELP = """
Plans use different notations: lengths in metres ("3,40" or "3.40"), centimetres for values under one metre ("87,5", "49"), millimetres ("3400") or feet and inches ("12'-6\""). A small raised digit after a number adds a fraction of the last digit ("3,31⁵" = 3.315; "11⁵" = 11.5 cm). Opening labels are often "width/height". Ignore title blocks, legends, site plans, sections and other drawings on the sheet: only the floor plan counts.
"""

LABELS_HELP = """
Text labels printed on this plan (exact text from the PDF; x/y = label centre in pixels of the attached image; interpretation = possible readings):
id | text | x | y | angle | interpretation
{rows}
Use these labels for all printed numbers instead of reading them from the pixels. Assign room names and areas to the rooms they are in, and opening labels to their openings (return the id in "label").
"""

OPENINGS_PROMPT = """You check one section of a floor plan for doors and windows. Return ONLY a JSON object, no prose.
Coordinates are PIXELS of the attached image ({w} × {h} px, origin top-left). Scale: 1 px = {mpp:.5f} m (1 m = {ppm:.1f} px).
Known walls in this section (index: [x1, y1, x2, y2] kind):
{walls}
Rooms (polygons in pixels): {rooms}
Report EVERY door, glazed door, sliding door, window, garage door and opening without door that lies on one of these walls. Walk along each wall from end to end; do not skip small ones (WC, storage, technical rooms).
Return: {{"openings": [{{"wall": 3, "type": "door", "from": [px, py], "to": [px, py], "label": "t7", "width_m": 0.885, "height_m": null, "sill_m": null, "hinge": "from", "opens_into": "Hall"}}]}}
type: door, window, garage or open. from/to: both ends on the wall centre line. hinge ("from"/"to") and opens_into (room name or "outside") for doors only. width_m/height_m/sill_m from the printed label if any, else null.
{notation}{labels}"""

LAYOUT_PROMPT = """You look at a drawing sheet. Return ONLY a JSON object, no prose.
List every separate drawing on the sheet with its bounding box in PIXELS of the attached image ({w} × {h} px, origin top-left): floor plans of a storey, site plan, sections, elevations, details, title block, legend, other.
A floor plan box must include its dimension lines and labels, but not the site plan, title block or other drawings around it.
Return: {{"drawings": [{{"type": "floor_plan", "label": "printed storey name or null", "box": [x0, y0, x1, y1]}}]}}
type is one of floor_plan, site_plan, section, elevation, detail, title_block, legend, other."""

REFINE_PROMPT = """You check an automatic floor plan reading. Image 1 is the original plan. Image 2 is the same plan with the current reading drawn on top: every room is a coloured, numbered polygon.
Compare carefully: wrong or missing walls, rooms that are too large/small, rooms overlapping or leaving gaps, missing rooms (hallway, storage, stairs area), wrong names, missing doors/windows, wrong stair direction.
Current reading (pixels of the same image size {w} × {h}):
{current}
Return the COMPLETE corrected result in exactly the same JSON format as before (rooms with points, kind, name, label_area_m2, clear_w, clear_d; openings; stairs; dimensions; level; roof; notes). Keep what is correct; change only what is wrong. In "notes", list briefly what you corrected. Output JSON only."""

SCALE_PROMPT = """You read architectural floor plans. Return ONLY a JSON object, no prose.
Find up to 3 clearly printed dimension annotations (dimension lines with a number, e.g. "4,25" or "425" or "4.25 m"), preferably long ones along the outer walls.
Coordinates are PIXELS of the attached image (origin top-left). Image size: {w} × {h} px.
Return: {{"dimensions": [{{"from": [px, py], "to": [px, py], "meters": 4.25, "label": "4,25"}}]}}
"from"/"to" are the two ends of the dimension line that the number refers to. Convert cm or mm to metres. If you find none, return {{"dimensions": []}}."""


_FENCE = re.compile(r"```(?:json|JSON)?\s*(\{.*?\})\s*```", re.S)


def _json_from(text: str, language: str = "en") -> dict[str, Any]:
    text = (text or "").strip()
    # Some models (e.g. Claude) wrap the JSON in prose and a ```json fence; take the fenced object
    # that contains the answer, preferring one with "rooms".
    fenced = []
    for block in _FENCE.findall(text):
        try:
            obj = json.loads(block)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            fenced.append(obj)
    if fenced:
        return next((o for o in fenced if "rooms" in o or "dimensions" in o), fenced[0])
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):]
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b <= a:
        raise HomeAssistantError(message(language, "model_no_json"))
    try:
        return json.loads(text[a:b + 1])
    except json.JSONDecodeError as err:
        fixed = _repair_json(text[a:])
        if fixed is not None:
            _LOGGER.warning("HomeTwin: repaired an incomplete JSON answer (%s)", err)
            return fixed
        raise HomeAssistantError(message(language, "model_invalid_json", error=err)) from err


def _repair_json(text: str) -> dict[str, Any] | None:
    """Closes a JSON answer that was cut off: drops the unfinished last element and closes brackets."""
    for cut in range(len(text), max(0, len(text) - 4000), -1):
        if text[cut - 1] not in "}]":
            continue
        head = text[:cut]
        stack, in_str, esc = [], False, False
        for ch in head:
            if in_str:
                esc = (ch == "\\") and not esc
                if ch == '"' and not esc:
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch in "{[":
                stack.append("}" if ch == "{" else "]")
            elif ch in "}]" and stack:
                stack.pop()
        if in_str:
            continue
        try:
            out = json.loads(head + "".join(reversed(stack)))
            return out if isinstance(out, dict) else None
        except json.JSONDecodeError:
            continue
    return None


def _cluster(values: list[float], tol: float) -> dict[float, float]:
    """Maps each value to the mean of its cluster (values closer than tol)."""
    out: dict[float, float] = {}
    vals = sorted(set(values))
    group: list[float] = []
    for v in vals + [math.inf]:
        if group and v - group[-1] > tol:
            m = round(sum(group) / len(group) / geo.GRID) * geo.GRID
            for g in group:
                out[g] = round(m, 3)
            group = []
        if v != math.inf:
            group.append(v)
    return out


def _regularise(rooms: list[dict[str, Any]]) -> None:
    """Straightens nearly axis-parallel edges and makes shared walls coincide."""
    for r in rooms:
        pts = r["points"]
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            dx, dz = b[0] - a[0], b[1] - a[1]
            if abs(dx) > 1e-6 and abs(dz) / max(abs(dx), 1e-6) < 0.08:
                b[1] = a[1] if i + 1 < len(pts) else b[1]
            elif abs(dz) > 1e-6 and abs(dx) / max(abs(dz), 1e-6) < 0.08:
                b[0] = a[0] if i + 1 < len(pts) else b[0]
    xs = _cluster([p[0] for r in rooms for p in r["points"]], 0.14)
    zs = _cluster([p[1] for r in rooms for p in r["points"]], 0.14)
    for r in rooms:
        pts = [[xs.get(p[0], p[0]), zs.get(p[1], p[1])] for p in r["points"]]
        r["points"] = [p for i, p in enumerate(pts) if p != pts[i - 1]]


def _fit_dimensions(rooms: list[dict[str, Any]], raw: list[dict[str, Any]], language: str = "en") -> tuple[list[str], list[str]]:
    """Moves the wall lines so that rectangular rooms get the clear dimensions printed in the plan.

    Every distinct x (and z) coordinate is one wall line. For a rectangle with printed clear width
    w, the distance between its two wall lines must be w + half the wall thickness on each side.
    The lines are solved by least squares, so neighbours stay flush. Large leftovers are reported.
    """
    by_name = {}
    for r in raw:
        if isinstance(r, dict) and r.get("name"):
            by_name.setdefault(str(r["name"])[:60], r)
    notes: list[str] = []
    problems: list[str] = []
    for axis in (0, 1):
        lines = sorted({p[axis] for r in rooms for p in r["points"]})
        idx = {v: i for i, v in enumerate(lines)}
        cons = []  # (i, j, target, room)
        for r in rooms:
            pts = r["points"]
            src = by_name.get(r["name"]) or {}
            want = src.get("clear_w" if axis == 0 else "clear_d")
            if not isinstance(want, (int, float)) or want <= 0.3 or len(pts) != 4:
                continue
            xs = sorted({p[axis] for p in pts})
            if len(xs) != 2:
                continue
            lo, hi = xs
            # wall thickness on both sides: shared edge -> interior wall, free edge -> exterior wall
            half = []
            for v in (lo, hi):
                side = [p for p in pts if p[axis] == v]
                a, b = side[0], side[-1]
                shared = any(o is not r and geo.shares_edge((a, b), o["points"]) for o in rooms if o.get("kind") != "outdoor")
                half.append(geo.INT_HALF if shared else geo.EXT_HALF)
            target = float(want) + half[0] + half[1]
            if abs(target - (hi - lo)) > max(0.6, 0.25 * target):
                problems.append(message(language, "dimension_mismatch", room=r["name"], wanted=want, actual=hi - lo - half[0] - half[1]))
                continue
            cons.append((idx[lo], idx[hi], target, r))
        if not cons:
            continue
        x = list(lines)
        x0 = list(lines)
        deg = [0.02] * len(x)
        for i, j, _t, _r in cons:
            deg[i] += 1
            deg[j] += 1
        for _ in range(600):  # Jacobi relaxation, step scaled by the number of constraints per line (stable)
            grad = [0.02 * (x[i] - x0[i]) for i in range(len(x))]
            for i, j, t, _r in cons:
                e = (x[j] - x[i]) - t
                grad[j] += e
                grad[i] -= e
            for i in range(len(x)):
                x[i] -= 0.5 * grad[i] / deg[i]
        # safety net: never move a wall line by more than 0.8 m or produce invalid numbers
        if any(not math.isfinite(v) or abs(v - v0) > 0.8 for v, v0 in zip(x, x0)):
            problems.append(message(language, "dimension_conflict", axis=message(language, "width" if axis == 0 else "depth")))
            continue
        moved = {lines[i]: round(x[i], 3) for i in range(len(x))}
        for r in rooms:
            for p in r["points"]:
                p[axis] = moved.get(p[axis], p[axis])
        worst = [(abs((x[j] - x[i]) - t), r) for i, j, t, r in cons]
        fixed = sum(1 for e, _r in worst if e <= 0.03)
        if fixed:
            notes.append(message(language, "dimensions_applied", count=fixed, axis=message(language, "width" if axis == 0 else "depth")))
        for e, r in worst:
            if e > 0.08:
                problems.append(message(language, "neighbour_dimension_conflict", room=r["name"], error=e))
    return notes, problems


async def run_detect(hass: HomeAssistant, cfg: AgentConfig, req: dict[str, Any], progress: Any = None) -> dict[str, Any]:
    """Floor plan wizard: rooms/openings from an image, or a scale suggestion (mode = scale).

    Without "mpp" the scale is taken from the printed dimension chains in the same pass.
    """
    report = progress or (lambda *_a, **_k: None)
    language = normalize_language(req.get("language") or language_from_hass(hass))
    w, h = int(req["width"]), int(req["height"])
    image = req["image"]
    if not image.startswith("data:image/"):
        raise HomeAssistantError(message(language, "image_missing"))
    if req.get("mode") == "scale":
        text = SCALE_PROMPT.format(w=w, h=h)
    elif req.get("mode") == "layout":
        text = LAYOUT_PROMPT.format(w=w, h=h)
    elif req.get("mode") == "openings":
        text = OPENINGS_PROMPT.format(w=w, h=h, mpp=float(req.get("mpp") or 0.01), ppm=1 / float(req.get("mpp") or 0.01), notation=NOTATION_HELP, labels=_labels_block(req),
                                      walls="\n".join(f"{i}: [{', '.join(str(round(v)) for v in wl[:4])}] {wl[4] if len(wl) > 4 else ''}" for i, wl in enumerate((req.get("walls") or [])[:200])),
                                      rooms=json.dumps([{"name": r.get("name"), "points": [[round(p[0]), round(p[1])] for p in r.get("points") or []]} for r in (req.get("rooms") or [])[:60]], ensure_ascii=False))
    elif req.get("mode") == "refine":
        text = DETECT_PROMPT.format(
            w=w, h=h, mpp=float(req.get("mpp") or 0.01), ppm=1 / float(req.get("mpp") or 0.01), lang=req.get("language") or "the user's language", skip="", locked="", notation=NOTATION_HELP, labels=_labels_block(req), hints=(f"Hints from the owner: {req['hints']}\n" if req.get("hints") else "")) + "\n\n" + REFINE_PROMPT.format(
            w=w, h=h, current=json.dumps(req.get("current") or {}, ensure_ascii=False)[:30000])
    else:
        auto_scale = not req.get("mpp")
        mpp, x0, z0 = float(req.get("mpp") or 0.01), float(req.get("x0") or 0), float(req.get("z0") or 0)
        opts = req.get("options") or {}
        locked = req.get("locked") or []
        locked_txt = ("These rooms are already correct and fixed (pixels) – do NOT return them again, fit the other rooms against them:\n"
                      + json.dumps([{"name": r.get("name"), "points": [[round((p[0] - x0) / mpp, 1), round((p[1] - z0) / mpp, 1)] for p in r["points"]]} for r in locked], ensure_ascii=False) + "\n") if locked else ""
        tmpl = DETECT_PROMPT if not auto_scale else DETECT_PROMPT.replace(
            "Scale: 1 px = {mpp:.5f} m (so 1 m = {ppm:.1f} px).",
            "Scale: UNKNOWN. You MUST return the printed dimension chains in \"dimensions\" (at least 2, long ones along the outer walls); the scale is computed from them.")
        text = tmpl.format(
            w=w, h=h, mpp=mpp, ppm=1 / mpp, lang=req.get("language") or "the user's language",
            skip=("" if opts.get("openings", True) else "\n- Return an empty openings list."),
            locked=locked_txt, notation=NOTATION_HELP, labels=_labels_block(req), hints=(f"Hints from the owner: {req['hints']}\n" if req.get("hints") else ""))
    payload: dict[str, Any] = {"model": cfg.model, "messages": [
        {"role": "system", "content": "You are a precise floor plan reader. Output strictly valid JSON."},
        {"role": "user", "content": [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": image}},
                                     *([{"type": "image_url", "image_url": {"url": req["overlay"]}}] if req.get("mode") == "refine" and req.get("overlay") else [])]}], "max_tokens": 16000}
    if cfg.reasoning in ("low", "medium", "high"):
        if "openrouter.ai" in cfg.base_url:
            payload["reasoning"] = {"effort": cfg.reasoning}
        else:
            payload["reasoning_effort"] = cfg.reasoning
    report("sent", kb=round(len(image) * 3 / 4 / 1024))
    first = {"t": True}

    def on_text(t: str) -> None:
        if first["t"]:
            first["t"] = False
            report("reading")
        report("chars", chars=len(t), rooms=t.count('"points"') - t.count('"stairs"'))

    t0 = _time_mod.monotonic()
    content = await _post_stream(hass, cfg, payload, on_text)
    _LOGGER.info("HomeTwin: model answered in %.1f s (%d characters)", _time_mod.monotonic() - t0, len(content))
    report("parsing", chars=len(content), raw=content[:20000])
    if req.get("mode") == "layout":
        return _layout_post(_json_from(content, language), w, h)
    if req.get("mode") == "openings":
        return {"openings": _openings_from(_json_from(content, language), req, language)}
    if req.get("mode") != "scale":
        # geometry work runs in a worker thread so Home Assistant stays responsive
        return await hass.async_add_executor_job(_detect_post, content, {**req, "_ui_language": language}, report)
    out = _json_from(content, language)

    if req.get("mode") == "scale":
        dims = []
        for d in out.get("dimensions") or []:
            try:
                a, b, m = d["from"], d["to"], float(d["meters"])
                px = math.hypot(b[0] - a[0], b[1] - a[1])
                if px > 20 and 0.3 < m < 100:
                    dims.append({"from": a, "to": b, "meters": m, "label": d.get("label"), "mpp": m / px})
            except (KeyError, TypeError, ValueError):
                continue
        return {"dimensions": dims}



def image_max_px(model: str) -> int:
    """Largest image side the model reads without resampling (OpenAI-compatible ids, any provider prefix)."""
    m = (model or "").lower()
    if "claude" in m or m.startswith("anthropic/"):
        return 1568
    if "gemini" in m or m.startswith("google/"):
        return 3072
    if "gpt" in m or m.startswith("openai/"):
        return 2048
    return 2048


def _labels_block(req: dict[str, Any]) -> str:
    rows = []
    for lb in (req.get("labels") or [])[:400]:
        if not isinstance(lb, dict):
            continue
        try:
            rows.append(f"{str(lb.get('id'))[:8]} | {str(lb.get('text'))[:40]} | {round(float(lb.get('x')))} | {round(float(lb.get('y')))} | {round(float(lb.get('angle') or 0))} | {str(lb.get('interp') or '')[:80]}")
        except (TypeError, ValueError):
            continue
    return LABELS_HELP.format(rows="\n".join(rows)) if rows else ""


def _layout_post(out: dict[str, Any], w: int, h: int) -> dict[str, Any]:
    kinds = {"floor_plan", "site_plan", "section", "elevation", "detail", "title_block", "legend", "other"}
    drawings = []
    for d in out.get("drawings") or []:
        try:
            x0, y0, x1, y1 = (_num(v) for v in d["box"][:4])
        except (KeyError, TypeError, ValueError, IndexError):
            continue
        x0, x1 = sorted((max(0.0, min(w, x0)), max(0.0, min(w, x1))))
        y0, y1 = sorted((max(0.0, min(h, y0)), max(0.0, min(h, y1))))
        if x1 - x0 < w * 0.03 or y1 - y0 < h * 0.03:
            continue
        drawings.append({"type": d.get("type") if d.get("type") in kinds else "other", "label": str(d.get("label") or "")[:40] or None, "box": [x0, y0, x1, y1]})
    return {"drawings": drawings}


def _label_size(req: dict[str, Any], lid: Any) -> tuple[float | None, float | None]:
    """Printed width/height of an opening label (from the client's label list), in metres."""
    for lb in req.get("labels") or []:
        if isinstance(lb, dict) and lb.get("id") == lid:
            w, h = lb.get("w"), lb.get("h")
            return (float(w) if isinstance(w, (int, float)) else None, float(h) if isinstance(h, (int, float)) else None)
    return None, None


def _opening(o: dict[str, Any], tm: Any, req: dict[str, Any]) -> dict[str, Any] | None:
    if o.get("type") not in ("door", "window", "garage", "open"):
        return None
    a, b = tm(o["from"]), tm(o["to"])
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    if not math.isfinite(length) or length < 0.2:
        return None
    item: dict[str, Any] = {"type": o["type"], "from": a, "to": b}
    lw, lh = _label_size(req, o.get("label")) if o.get("label") else (None, None)
    width = lw if lw is not None else (_num(o["width_m"]) if isinstance(o.get("width_m"), (int, float, str)) and o.get("width_m") not in ("", None) else None)
    if width is not None and 0.4 <= width <= 6 and 0.6 <= width / length <= 1.6:
        cx, cz, ux, uz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (b[0] - a[0]) / length, (b[1] - a[1]) / length
        item["from"], item["to"] = [cx - ux * width / 2, cz - uz * width / 2], [cx + ux * width / 2, cz + uz * width / 2]
        item["printed"] = True
    height = lh if lh is not None else (_num(o["height_m"]) if isinstance(o.get("height_m"), (int, float, str)) and o.get("height_m") not in ("", None) else None)
    sill = _num(o["sill_m"]) if isinstance(o.get("sill_m"), (int, float, str)) and o.get("sill_m") not in ("", None) else None
    if o["type"] == "window":
        if sill is not None and 0 <= sill <= 2.5:
            item["sill"] = round(sill, 3)
        if height is not None and 0.3 <= height <= 3:
            item["head"] = round((item.get("sill", 0.9 if height < 1.9 else 0.0)) + height, 3)
            item.setdefault("sill", 0.9 if height < 1.9 else 0.0)
    elif o["type"] in ("door", "garage") and height is not None and 1.7 <= height <= 3.2:
        item["head"] = round(height, 3)
    if o["type"] == "door":
        if o.get("hinge") in ("from", "to"):
            item["hinge"] = o["hinge"]
        if isinstance(o.get("opens_into"), str) and o["opens_into"].strip():
            item["opens_into"] = o["opens_into"].strip()[:60]
    return item


def _openings_from(out: dict[str, Any], req: dict[str, Any], language: str) -> list[dict[str, Any]]:
    mpp, x0, z0 = float(req.get("mpp") or 0.01), float(req.get("x0") or 0), float(req.get("z0") or 0)
    tm = lambda p: (lambda q: [x0 + q[0] * mpp, z0 + q[1] * mpp])(_pt(p))  # noqa: E731
    res = []
    for o in out.get("openings") or []:
        try:
            item = _opening(o, tm, req) if isinstance(o, dict) else None
        except (KeyError, TypeError, ValueError, IndexError):
            item = None
        if item:
            if isinstance(o.get("wall"), int):
                item["wall"] = o["wall"]
            res.append(item)
    return res


_SUP = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")


def _readings(text: Any) -> list[float]:
    """All plausible metre readings of a printed length (m, cm, mm, feet-inches); mirrors dimtext.js."""
    t = str(text or "").strip().replace("\u00a0", " ").replace("’", "'").replace("”", '"')
    if not t:
        return []
    imp = re.fullmatch(r"(?:(\d+)\s*')?\s*-?\s*(?:(\d+)(?:\s+(\d+)/(\d+))?\s*\"?)?", t)
    if imp and ("'" in t or '"' in t) and (imp.group(1) or imp.group(2)):
        inch = float(imp.group(2) or 0) + (float(imp.group(3)) / float(imp.group(4)) if imp.group(3) else 0)
        return [float(imp.group(1) or 0) * 0.3048 + inch * 0.0254]
    sup = None
    m = re.fullmatch(r"(.*?\d)([⁰¹²³⁴⁵⁶⁷⁸⁹])", t)
    if m:
        t, sup = m.group(1), int(m.group(2).translate(_SUP))
    unit = re.search(r"(mm|cm|m)$", t, re.I)
    core = re.sub(r"\s*(mm|cm|m)$", "", t, flags=re.I).replace(" ", "")
    if not re.fullmatch(r"\d+(?:[.,]\d+)*", core):
        return []
    last = max(core.rfind(","), core.rfind("."))
    v = float(core) if last < 0 else float(re.sub(r"[.,]", "", core[:last]) + "." + core[last + 1:])
    decimals = len(core) - last - 1 if last >= 0 else 0
    if sup is not None:
        v += sup / 10 * (10 ** -decimals if decimals else 1)
    if unit:
        return [v * {"m": 1, "cm": 0.01, "mm": 0.001}[unit.group(1).lower()]]
    out = []
    if last >= 0 and decimals <= 3:
        out.append(v)
    if last < 0 or decimals <= 1:
        out.append(v / 100)
    if last < 0 and v >= 10:
        out.append(v / 1000)
    return [x for x in out if 0.005 < x < 500]


def _scale_from_dimensions(dims: list[Any], px: Any) -> float | None:
    """Metres per pixel that the most printed dimensions agree on (each may be read as m, cm, mm or ft-in)."""
    cands: list[tuple[float, int]] = []
    for i, d in enumerate(dims):
        try:
            a, b = px(d["from"]), px(d["to"])
            dist = math.hypot(b[0] - a[0], b[1] - a[1])
        except (KeyError, TypeError, ValueError, IndexError):
            continue
        if not (dist > 30 and math.isfinite(dist)):
            continue
        vals = _readings(d.get("text")) if d.get("text") else []
        try:
            vals.append(_num(d.get("meters", d.get("m"))))
        except (TypeError, ValueError):
            pass
        for v in sorted({round(x, 6) for x in vals if 0.05 < x < 300}):
            cands.append((v / dist, i, v))
    best: tuple[int, bool, float] | None = None
    for k, _, _ in cands:
        near = [(i, v) for k2, i, v in cands if abs(k2 / k - 1) < 0.02]
        support = len({i for i, _ in near})
        # equal support happens when a whole plan reads in two units (cm vs mm): prefer a plausible building size
        plausible = 2 <= max(v for _, v in near) <= 60
        if best is None or (support, plausible) > (best[0], best[1]):
            best = (support, plausible, k)
    if not best or best[0] < (2 if len(dims) >= 2 else 1):
        return None
    close = sorted(k2 for k2, _, _ in cands if abs(k2 / best[2] - 1) < 0.02)
    return close[len(close) // 2]


def _scale_from_areas(rooms: list[Any], px: Any) -> float | None:
    """Metres per pixel from printed room areas: sqrt(m² / px²), when at least three rooms agree within 5 %."""
    ks = []
    for r in rooms:
        if not isinstance(r, dict) or not isinstance(r.get("label_area_m2"), (int, float)) or r["label_area_m2"] <= 0.5:
            continue
        try:
            pts = [px(p) for p in _room_points(r) or []]
        except (TypeError, ValueError, KeyError, IndexError):
            continue
        a = geo.area(pts) if len(pts) >= 3 else 0
        if a > 100 and math.isfinite(a):
            ks.append(math.sqrt(r["label_area_m2"] / a))
    if len(ks) < 3:
        return None
    ks.sort()
    med = ks[len(ks) // 2]
    close = [k for k in ks if abs(k / med - 1) < 0.05]
    return med if len(close) >= max(3, len(ks) // 2) else None


def _num(v: Any) -> float:
    """Number from a JSON number or a string such as "11,49" / "11.49 m"."""
    if isinstance(v, bool):
        raise ValueError("bool")
    if isinstance(v, (int, float)):
        n = float(v)
        if math.isfinite(n):
            return n
        raise ValueError("non-finite number")
    if isinstance(v, str):
        m = re.search(r"-?\d+(?:[.,]\d+)?", v)
        if m:
            n = float(m.group(0).replace(",", "."))
            if math.isfinite(n):
                return n
    raise ValueError(f"not a number: {v!r}")


def _pt(p: Any) -> list[float]:
    """Point from [x, y], {"x": .., "y": ..} (also px/py) or "x,y"."""
    if isinstance(p, (list, tuple)) and len(p) >= 2:
        return [_num(p[0]), _num(p[1])]
    if isinstance(p, dict):
        for kx, ky in (("x", "y"), ("px", "py"), ("X", "Y")):
            if kx in p and ky in p:
                return [_num(p[kx]), _num(p[ky])]
    if isinstance(p, str):
        parts = re.findall(r"-?\d+(?:\.\d+)?", p)
        if len(parts) >= 2:
            return [_num(parts[0]), _num(parts[1])]
    raise ValueError(f"not a point: {p!r}")


def _room_points(r: dict[str, Any]) -> Any:
    for key in ("points", "polygon", "vertices", "corners", "outline"):
        if r.get(key):
            return r[key]
    return None


def _coord_scale(out: dict[str, Any], w: int, h: int) -> tuple[float, float, str | None]:
    """Detects answers in normalised coordinates (0..1 or 0..1000) instead of image pixels."""
    xs, ys = [], []
    for r in out.get("rooms") or []:
        for p in (_room_points(r) if isinstance(r, dict) else None) or []:
            try:
                x, y = _pt(p)
            except (ValueError, TypeError):
                continue
            xs.append(x)
            ys.append(y)
    if len(xs) < 3:
        return 1.0, 1.0, None
    mx, my = max(xs), max(ys)
    if mx <= 1.0001 and my <= 1.0001:
        return float(w), float(h), "unit"
    # 0..1000 grid (Gemini style) on an image that is clearly not ~1000 px: points run past the image
    # or the drawing only fills a corner of it.
    if mx <= 1000.5 and my <= 1000.5 and (mx > w * 1.05 or my > h * 1.05) and max(w, h) < 950:
        return w / 1000.0, h / 1000.0, "per_mille"
    return 1.0, 1.0, None


def _detect_post(content: str, req: dict[str, Any], report: Any) -> dict[str, Any]:
    """Turns the model's JSON into rooms in metres, fitted to the printed dimensions (worker thread)."""
    language = normalize_language(req.get("_ui_language") or req.get("language"))
    out = _json_from(content, language)
    if not isinstance(out.get("rooms"), list):  # some models nest the answer
        for v in out.values():
            if isinstance(v, dict) and isinstance(v.get("rooms"), list):
                out = v
                break
    sx, sy, frame = _coord_scale(out, int(req.get("width") or 0), int(req.get("height") or 0))
    if frame:
        _LOGGER.warning("HomeTwin: model answered in %s coordinates; converted to pixels", frame)
    px = lambda p: (lambda q: [q[0] * sx, q[1] * sy])(_pt(p))  # noqa: E731
    mpp, x0, z0 = float(req.get("mpp") or 0), float(req.get("x0") or 0), float(req.get("z0") or 0)
    scale_source = "measured"
    if not mpp:  # scale from the printed dimension chains, then from printed room areas
        mpp = _scale_from_dimensions(out.get("dimensions") or [], px)
        scale_source = "dimensions"
        if not mpp:
            mpp = _scale_from_areas(out.get("rooms") or [], px)
            scale_source = "areas"
        if not mpp:  # keep the rooms; the wizard asks for one measured length and rescales them
            mpp, scale_source = 0.01, "unknown"
        req = {**req, "mpp": mpp, "_auto": True}
    report("fitting")
    tm = lambda p: (lambda q: [x0 + q[0] * mpp, z0 + q[1] * mpp])(px(p))  # noqa: E731
    kinds = {"room", "garage", "outdoor"}
    rooms = []
    raw_rooms = [r for r in (out.get("rooms") or []) if isinstance(r, dict)]
    dropped: dict[str, int] = {}
    for r in raw_rooms:
        try:
            pts = [tm(p) for p in _room_points(r) or []]
        except (KeyError, TypeError, ValueError, IndexError):
            dropped["points"] = dropped.get("points", 0) + 1
            continue
        if len(pts) < 3:
            dropped["corners"] = dropped.get("corners", 0) + 1
        elif not math.isfinite(geo.area(pts)):
            dropped["points"] = dropped.get("points", 0) + 1
        elif geo.area(pts) < 0.5:
            dropped["tiny"] = dropped.get("tiny", 0) + 1
        else:
            kind = r.get("kind") if r.get("kind") in kinds else r.get("type") if r.get("type") in kinds else "room"
            rooms.append({"name": str(r.get("name") or message(language, "room"))[:60], "kind": kind,
                          "points": pts, "label_area": r.get("label_area_m2") if isinstance(r.get("label_area_m2"), (int, float)) else None})
    report("fitting", rooms_raw=len(raw_rooms), rooms_used=len(rooms), dropped=dropped, frame=frame)
    if not rooms and not req.get("locked"):
        _LOGGER.warning("HomeTwin: no usable rooms (%d returned, dropped %s). Model answer starts with: %s", len(raw_rooms), dropped, content[:1500])
        if raw_rooms:
            raise HomeAssistantError(message(language, "rooms_unusable", count=len(raw_rooms), reason=", ".join(f"{k}: {v}" for k, v in dropped.items())))
        raise HomeAssistantError(message(language, "rooms_none"))
    locked_m = [{"name": r.get("name"), "kind": "room", "points": r["points"], "locked": True} for r in (req.get("locked") or [])]
    if locked_m:  # pull new rooms onto the walls of the locked rooms, which keep their exact shape
        for r in rooms:
            r["points"], _ = geo.snap(r["points"], [lr["points"] for lr in locked_m], language)
    _regularise(rooms)
    fit_notes, fit_problems = _fit_dimensions(rooms, out.get("rooms") or [], language)
    openings = []
    for o in out.get("openings") or []:
        try:
            item = _opening(o, tm, req) if isinstance(o, dict) else None
        except (KeyError, TypeError, ValueError, IndexError):
            item = None
        if item:
            openings.append(item)
    stairs = []
    for st in out.get("stairs") or []:
        try:
            pts = [tm(p) for p in _room_points(st) or []]
            if len(pts) >= 3:
                item: dict[str, Any] = {"points": pts}
                if st.get("up_from") and st.get("up_to"):
                    item["up_from"], item["up_to"] = tm(st["up_from"]), tm(st["up_to"])
                if isinstance(st.get("width_m"), (int, float)) and 0.5 < st["width_m"] < 3:
                    item["width"] = float(st["width_m"])
                stairs.append(item)
        except (KeyError, TypeError, ValueError, IndexError):
            continue
    level_info = out.get("level") if isinstance(out.get("level"), dict) else None
    roof_info = None
    if isinstance(out.get("roof"), dict) and out["roof"].get("type") in ("flat", "shed", "gable", "hip"):
        rf = out["roof"]
        roof_info = {"type": rf["type"], "pitch": rf.get("pitch_deg") if isinstance(rf.get("pitch_deg"), (int, float)) else None,
                     "ridge": "x" if rf.get("ridge") == "x" else "z" if rf.get("ridge") in ("y", "z") else None}
        try:
            mb = [tm(p) for p in rf.get("main_building") or []]
            if len(mb) >= 3:
                roof_info["outline"] = mb
        except (TypeError, ValueError, IndexError):
            pass
    all_rooms = [*({**r, "kind": r.get("kind") or "room"} for r in (req.get("locked") or [])), *rooms]
    for r in rooms:
        r["area"] = round(geo.area(r["points"]), 2)
        r["net_area"] = round(geo.net_area(r, all_rooms), 2)
    problems = geo.check_level(all_rooms, language) + fit_problems
    # scale check against printed dimension chains
    scale = None
    ratios = []
    for d in out.get("dimensions") or []:
        try:
            a, b = px(d["from"]), px(d["to"])
            dist = math.hypot(b[0] - a[0], b[1] - a[1])
            m = _num(d.get("meters", d.get("m")))
            if dist > 40 and 0.5 < m < 100:
                ratios.append(m / (dist * mpp))
        except (KeyError, TypeError, ValueError, IndexError):
            continue
    if ratios and not req.get("_auto"):
        ratios.sort()
        f = ratios[len(ratios) // 2]
        scale = {"factor": round(f, 4), "samples": len(ratios)}
    return {"rooms": rooms, "openings": openings, "stairs": stairs, "problems": problems, "adjusted": fit_notes, "scale_check": scale, "notes": out.get("notes") or "",
            "level": level_info, "roof": roof_info,
            "mpp": mpp, "scale_source": scale_source,
            "dimensions": [{"from": d.get("from"), "to": d.get("to"), "meters": d.get("meters")} for d in (out.get("dimensions") or []) if isinstance(d, dict)][:6]}


# ---------------------------------------------------------------- background jobs
import time as _time  # noqa: E402
import uuid as _uuid  # noqa: E402


def start_detect_job(hass: HomeAssistant, cfg: AgentConfig, req: dict[str, Any]) -> str:
    """Runs run_detect in the background; state lives in hass.data so the panel can poll and reconnect."""
    from .const import DOMAIN  # noqa: PLC0415
    jobs: dict[str, Any] = hass.data.setdefault(DOMAIN, {}).setdefault("jobs", {})
    for jid in sorted(jobs, key=lambda k: jobs[k]["started"])[:-3]:  # keep the last few
        jobs.pop(jid, None)
    jid = _uuid.uuid4().hex[:12]
    job: dict[str, Any] = {"id": jid, "mode": req.get("mode", "rooms"), "status": "running", "started": _time.time(), "stage": "queued",
                           "chars": 0, "rooms": 0, "kb": 0, "result": None, "error": None, "image": req["image"],
                           "width": req["width"], "height": req["height"], "level_id": req.get("level_id"), "consumed": False, "model": cfg.model}
    jobs[jid] = job

    def progress(stage: str, **info: Any) -> None:
        if stage != "chars":
            job["stage"] = stage
        job.update(info)

    async def runner() -> None:
        import asyncio  # noqa: PLC0415
        try:
            job["result"] = await asyncio.wait_for(run_detect(hass, cfg, req, progress), timeout=330)
            job["status"] = "done"
            _LOGGER.info("HomeTwin: recognition %s finished in %.0f s", jid, _time.time() - job["started"])
        except TimeoutError:
            job["status"], job["error"] = "error", hass_message(hass, "detect_timeout")
        except HomeAssistantError as err:
            _LOGGER.warning("HomeTwin: recognition %s failed: %s", jid, err)
            job["status"], job["error"] = "error", str(err)
        except Exception as err:  # noqa: BLE001
            _LOGGER.exception("HomeTwin floor plan recognition failed")
            job["status"], job["error"] = "error", hass_message(hass, "unexpected_error", error=err)
        job["finished"] = _time.time()

    hass.async_create_background_task(runner(), f"hometwin_detect_{jid}")
    return jid


def job_state(hass: HomeAssistant, jid: str | None, with_image: bool = False, with_raw: bool = False) -> dict[str, Any] | None:
    from .const import DOMAIN  # noqa: PLC0415
    jobs = hass.data.get(DOMAIN, {}).get("jobs", {})
    if not jid:
        jid = max(jobs, key=lambda k: jobs[k]["started"], default=None)
    job = jobs.get(jid) if jid else None
    if not job:
        return None
    out = {k: v for k, v in job.items() if k not in ("image", "raw")}
    out["elapsed"] = round((job.get("finished") or _time.time()) - job["started"], 1)
    if with_image:
        out["image"] = job["image"]
    if with_raw:
        out["raw"] = job.get("raw", "")
        out["model"] = job.get("model")
    return out
