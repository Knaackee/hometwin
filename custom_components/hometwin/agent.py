"""The HomeTwin agent: an OpenAI-compatible chat-completions loop with plan-editing tools.

The agent never edits the stored plan. Every tool call is validated and collected as an
operation; the panel shows them to the user, who applies the ones they want.
"""

from __future__ import annotations

import base64
import math
import time as _time_mod
import json
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
        _fn("add_level", "Neue Etage anlegen.", {"name": {"type": "string"}, "elevation": {"type": "number", "description": "Fußbodenhöhe über Grund in m"}, "height": {"type": "number"}, "floor_id": {"type": "string"}}, ["name", "elevation"]),
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
             "y": {"type": "number", "description": "Montagehöhe in m (optional)"}, "rot": {"type": "number"}, "length": {"type": "number"}}, ["level_id", "kind", "pos"]),
        _fn("update_device", "Gerät ändern (Entität, Darstellung, Position).",
            {"device_id": {"type": "string"}, "entity_id": {"type": "string"}, "kind": {"type": "string", "enum": kinds}, "style": {"type": "string", "enum": styles}, "pos": _PT, "y": {"type": "number"}, "rot": {"type": "number"}, "length": {"type": "number"}}, ["device_id"]),
        _fn("place_furniture", "Möbel oder Gartenobjekt setzen.",
            {"level_id": {"type": "string"}, "type": {"type": "string", "enum": list(cat["furniture"])}, "pos": _PT, "rot": {"type": "number"}, "width": {"type": "number"}, "depth": {"type": "number"}, "height": {"type": "number"}, "color": {"type": "string"}}, ["level_id", "type", "pos"]),
        _fn("move_item", "Gerät oder Möbel verschieben/drehen.", {"item_id": {"type": "string"}, "pos": _PT, "rot": {"type": "number"}}, ["item_id"]),
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
            raise ValueError(f"Entität {eid} existiert nicht")
        if domains and eid.split(".")[0] not in domains:
            raise ValueError(f"{eid} passt nicht (erwartet {', '.join(domains)})")

    def _level(self, a: dict[str, Any]) -> None:
        if a.get("level_id") not in self.levels:
            raise ValueError(f"Unbekannte level_id {a.get('level_id')}")

    def _item(self, iid: Any, *types: str) -> None:
        if self.items.get(iid) not in types:
            raise ValueError(f"Unbekannte ID {iid}")

    @staticmethod
    def _pt(p: Any, name: str) -> None:
        if not (isinstance(p, list) and len(p) == 2 and all(isinstance(v, (int, float)) for v in p)):
            raise ValueError(f"{name} muss [x, z] sein")

    def _shape(self, a: dict[str, Any], level: str, kind: str, name: str, skip: str | None = None) -> tuple[list[list[float]], list[str]]:
        """Points from rect/points, snapped to the neighbours; raises on overlaps."""
        if isinstance(a.get("rect"), list) and len(a["rect"]) == 4:
            pts = geo.rect_points(a["rect"])
        else:
            for p in a.get("points") or []:
                self._pt(p, "points[]")
            pts = [[float(p[0]), float(p[1])] for p in a["points"]]
        if len(pts) < 3 or geo.area(pts) < 0.2:
            raise ValueError("Raum ist zu klein oder hat weniger als 3 Ecken")
        others = [r for rid, r in self.rooms.items() if r["level"] == level and rid != skip]
        pts, notes = geo.snap(pts, [r["points"] for r in others])
        if kind in ("room", "garage"):
            clashes = [(r, geo.overlap_area(pts, r["points"])) for r in others if r["kind"] in ("room", "garage")]
            clashes = [(r, ov) for r, ov in clashes if ov > geo.OVERLAP_TOL]
            if clashes:
                raise ValueError("Überlappung – nicht angelegt. " + "; ".join(
                    f"„{name}“ überlappt „{r['name']}“ um {ov:.2f} m² (deren Ecken: {r['points']})" for r, ov in clashes)
                    + ". Lege die gemeinsame Wand exakt auf die Kante des Nachbarraums.")
        return pts, notes

    def check(self, level_id: str | None) -> dict[str, Any]:
        out = {}
        for lid in ([level_id] if level_id in self.levels else sorted(self.levels)):
            rooms = [r for r in self.rooms.values() if r["level"] == lid]
            out[lid] = {"problems": geo.check_level(rooms) or ["keine"],
                        "rooms": [{"name": r["name"], "kind": r["kind"], "area_m2": round(geo.area(r["points"]), 2), "bbox": [round(v, 2) for v in geo.bbox(r["points"])]} for r in rooms]}
        return out

    def call(self, name: str, a: dict[str, Any]) -> dict[str, Any]:
        cat = self.cat
        if name == "check_plan":
            return self.check(a.get("level_id"))
        if name == "add_level":
            lid = self._id("l"); self.levels.add(lid)
            self.ops.append({"op": "add_level", "id": lid, **{k: a[k] for k in ("name", "elevation", "height", "floor_id") if k in a}})
            return {"ok": True, "id": lid}
        if name == "add_room":
            self._level(a)
            if not (isinstance(a.get("rect"), list) and len(a["rect"]) == 4) and not (isinstance(a.get("points"), list) and len(a["points"]) >= 3):
                raise ValueError("rect oder points angeben")
            for p in a.get("points") or []:
                self._pt(p, "points[]")
            if a.get("kind") and a["kind"] not in cat["room_kinds"]:
                raise ValueError("unbekannte Raumart")
            kind = a.get("kind") or "room"
            pts, notes = self._shape(a, a["level_id"], kind, a.get("name") or "Raum")
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
                pts, notes = self._shape(a, cur.get("level"), a.get("kind") or cur.get("kind", "room"), a.get("name") or cur.get("name") or "Raum", skip=a["room_id"])
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
                raise ValueError("unbekannter Öffnungstyp")
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
                raise ValueError("unbekannte Geräteart")
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
                raise ValueError("unbekannter Möbeltyp")
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
        raise ValueError(f"unbekanntes Werkzeug {name}")


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
                raise HomeAssistantError(f"Endpunkt antwortete {resp.status}: {body[:400]}")
            return json.loads(body)
    except (aiohttp.ClientError, TimeoutError) as err:
        raise HomeAssistantError(f"Endpunkt nicht erreichbar: {err}") from err
    except json.JSONDecodeError as err:
        raise HomeAssistantError("Antwort des Endpunkts ist kein JSON") from err


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
                raise HomeAssistantError(f"Endpunkt antwortete {resp.status}: {(await resp.text())[:400]}")
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
                        raise HomeAssistantError(f"Modellfehler: {str(ev['error'])[:300]}")
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
        raise HomeAssistantError(f"Zeitüberschreitung oder Verbindungsfehler beim Modell: {err or type(err).__name__}") from err
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as err:
        raise HomeAssistantError("Antwort des Endpunkts nicht lesbar") from err


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
            raise HomeAssistantError(f"Unerwartete Antwort: {str(data)[:300]}") from err
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
  "openings": [{{"type": "door", "from": [px, py], "to": [px, py]}}],
  "stairs": [{{"points": [[px, py], ...], "up_from": [px, py], "up_to": [px, py], "width_m": 1.0}}],
  "dimensions": [{{"from": [px, py], "to": [px, py], "meters": 11.49}}],
  "level": {{"name": "Erdgeschoss", "floor_elevation_m": 0.0, "room_height_m": 2.6}},
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
- level: the storey shown (name as printed, e.g. "Erdgeschoss", "Obergeschoss", "Kellergeschoss"), floor elevation (e.g. "OKFF ±0,00" or "+2,85") and clear room height if printed (e.g. "RH 2,50", "lichte Höhe"). null values if not printed.
- roof: only if the plan shows or states it (roof outline, "SD 38°", "Satteldach", ridge line "First"): type one of flat, shed, gable, hip; pitch in degrees; ridge "x" if the ridge runs left-right in the image, "y" if top-bottom; main_building = outline of the part the roof covers (without garage/carport). Otherwise null.
- dimensions: up to 6 long printed dimension lines (outer chains preferred) with their two end points in pixels and the printed length in metres. They are used to verify the scale.
- PRINTED DIMENSIONS BEAT PIXELS: place walls so that the printed dimensions are met.
- openings: doors ("door"), windows ("window"), garage doors ("garage"), openings without door ("open"); from/to are the two ends ON the wall centre line.{skip}
{locked}{hints}"""

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


def _json_from(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):]
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b <= a:
        raise HomeAssistantError("Das Modell hat kein JSON geliefert. Ein Modell mit Bildverständnis verwenden.")
    try:
        return json.loads(text[a:b + 1])
    except json.JSONDecodeError as err:
        fixed = _repair_json(text[a:])
        if fixed is not None:
            _LOGGER.warning("HomeTwin: repaired an incomplete JSON answer (%s)", err)
            return fixed
        raise HomeAssistantError(f"Antwort des Modells ist kein gültiges JSON ({err}). Bitte erneut versuchen.") from err


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


def _fit_dimensions(rooms: list[dict[str, Any]], raw: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
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
                problems.append(f"„{r['name']}“: Maß {want:.2f} m aus dem Plan passt nicht zur Zeichnung ({hi - lo - half[0] - half[1]:.2f} m) – bitte prüfen")
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
            problems.append(f"Plan-Maße {'in der Breite' if axis == 0 else 'in der Tiefe'} widersprechen sich – Räume wurden nicht angepasst, bitte prüfen")
            continue
        moved = {lines[i]: round(x[i], 3) for i in range(len(x))}
        for r in rooms:
            for p in r["points"]:
                p[axis] = moved.get(p[axis], p[axis])
        worst = [(abs((x[j] - x[i]) - t), r) for i, j, t, r in cons]
        fixed = sum(1 for e, _r in worst if e <= 0.03)
        if fixed:
            notes.append(f"{fixed} Raummaß(e) {'in der Breite' if axis == 0 else 'in der Tiefe'} aus dem Plan übernommen")
        for e, r in worst:
            if e > 0.08:
                problems.append(f"„{r['name']}“: Plan-Maße widersprechen den Nachbarräumen (Abweichung {e:.2f} m) – bitte prüfen")
    return notes, problems


async def run_detect(hass: HomeAssistant, cfg: AgentConfig, req: dict[str, Any], progress: Any = None) -> dict[str, Any]:
    """Floor plan wizard: rooms/openings from an image, or a scale suggestion (mode = scale).

    Without "mpp" the scale is taken from the printed dimension chains in the same pass.
    """
    report = progress or (lambda *_a, **_k: None)
    w, h = int(req["width"]), int(req["height"])
    image = req["image"]
    if not image.startswith("data:image/"):
        raise HomeAssistantError("Bild fehlt")
    if req.get("mode") == "scale":
        text = SCALE_PROMPT.format(w=w, h=h)
    elif req.get("mode") == "refine":
        text = DETECT_PROMPT.format(
            w=w, h=h, mpp=float(req.get("mpp") or 0.01), ppm=1 / float(req.get("mpp") or 0.01), lang=req.get("language") or "the user's language", skip="", locked="", hints=(f"Hints from the owner: {req['hints']}\n" if req.get("hints") else "")) + "\n\n" + REFINE_PROMPT.format(
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
            locked=locked_txt, hints=(f"Hints from the owner: {req['hints']}\n" if req.get("hints") else ""))
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
    report("parsing", chars=len(content))
    if req.get("mode") != "scale":
        # geometry work runs in a worker thread so Home Assistant stays responsive
        return await hass.async_add_executor_job(_detect_post, content, req, report)
    out = _json_from(content)

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



def _detect_post(content: str, req: dict[str, Any], report: Any) -> dict[str, Any]:
    """Turns the model's JSON into rooms in metres, fitted to the printed dimensions (worker thread)."""
    out = _json_from(content)
    mpp, x0, z0 = float(req.get("mpp") or 0), float(req.get("x0") or 0), float(req.get("z0") or 0)
    if not mpp:  # scale from the printed dimension chains
        cands = []
        for d in out.get("dimensions") or []:
            try:
                px = math.hypot(d["to"][0] - d["from"][0], d["to"][1] - d["from"][1])
                m = float(d["meters"])
                if px > 40 and 0.5 < m < 100:
                    cands.append(m / px)
            except (KeyError, TypeError, ValueError, IndexError):
                continue
        if not cands:
            raise HomeAssistantError("Im Plan wurden keine lesbaren Maßketten gefunden. Bitte im Schritt Maßstab eine Strecke messen.")
        cands.sort()
        mpp = cands[len(cands) // 2]
        req = {**req, "mpp": mpp, "_auto": True}
    report("fitting")
    tm = lambda p: [x0 + float(p[0]) * mpp, z0 + float(p[1]) * mpp]  # noqa: E731
    kinds = {"room", "garage", "outdoor"}
    rooms = []
    for r in out.get("rooms") or []:
        try:
            pts = [tm(p) for p in r["points"]]
        except (KeyError, TypeError, ValueError, IndexError):
            continue
        if len(pts) >= 3 and geo.area(pts) >= 0.5:
            rooms.append({"name": str(r.get("name") or "Raum")[:60], "kind": r.get("kind") if r.get("kind") in kinds else "room",
                          "points": pts, "label_area": r.get("label_area_m2") if isinstance(r.get("label_area_m2"), (int, float)) else None})
    locked_m = [{"name": r.get("name"), "kind": "room", "points": r["points"], "locked": True} for r in (req.get("locked") or [])]
    if locked_m:  # pull new rooms onto the walls of the locked rooms, which keep their exact shape
        for r in rooms:
            r["points"], _ = geo.snap(r["points"], [lr["points"] for lr in locked_m])
    _regularise(rooms)
    fit_notes, fit_problems = _fit_dimensions(rooms, out.get("rooms") or [])
    openings = []
    for o in out.get("openings") or []:
        try:
            if o.get("type") in ("door", "window", "garage", "open"):
                openings.append({"type": o["type"], "from": tm(o["from"]), "to": tm(o["to"])})
        except (KeyError, TypeError, ValueError, IndexError):
            continue
    stairs = []
    for st in out.get("stairs") or []:
        try:
            pts = [tm(p) for p in st["points"]]
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
    problems = geo.check_level(all_rooms) + fit_problems
    # scale check against printed dimension chains
    scale = None
    ratios = []
    for d in out.get("dimensions") or []:
        try:
            px = math.hypot(d["to"][0] - d["from"][0], d["to"][1] - d["from"][1])
            m = float(d["meters"])
            if px > 40 and 0.5 < m < 100:
                ratios.append(m / (px * mpp))
        except (KeyError, TypeError, ValueError, IndexError):
            continue
    if ratios and not req.get("_auto"):
        ratios.sort()
        f = ratios[len(ratios) // 2]
        scale = {"factor": round(f, 4), "samples": len(ratios)}
    return {"rooms": rooms, "openings": openings, "stairs": stairs, "problems": problems, "adjusted": fit_notes, "scale_check": scale, "notes": out.get("notes") or "",
            "level": level_info, "roof": roof_info,
            "mpp": mpp, "scale_source": "dimensions" if req.get("_auto") else "measured",
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
                           "width": req["width"], "height": req["height"], "level_id": req.get("level_id"), "consumed": False}
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
            job["status"], job["error"] = "error", "Zeitüberschreitung: Das Modell hat nach 5 Minuten nicht fertig geantwortet. Bitte erneut versuchen oder ein schnelleres Modell / Reasoning „Aus“ wählen."
        except HomeAssistantError as err:
            _LOGGER.warning("HomeTwin: recognition %s failed: %s", jid, err)
            job["status"], job["error"] = "error", str(err)
        except Exception as err:  # noqa: BLE001
            _LOGGER.exception("HomeTwin floor plan recognition failed")
            job["status"], job["error"] = "error", f"Unerwarteter Fehler: {err}"
        job["finished"] = _time.time()

    hass.async_create_background_task(runner(), f"hometwin_detect_{jid}")
    return jid


def job_state(hass: HomeAssistant, jid: str | None, with_image: bool = False) -> dict[str, Any] | None:
    from .const import DOMAIN  # noqa: PLC0415
    jobs = hass.data.get(DOMAIN, {}).get("jobs", {})
    if not jid:
        jid = max(jobs, key=lambda k: jobs[k]["started"], default=None)
    job = jobs.get(jid) if jid else None
    if not job:
        return None
    out = {k: v for k, v in job.items() if k != "image"}
    out["elapsed"] = round((job.get("finished") or _time.time()) - job["started"], 1)
    if with_image:
        out["image"] = job["image"]
    return out
