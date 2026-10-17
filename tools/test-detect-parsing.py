"""Floor-plan recognition: model answers in different shapes must give the same rooms (no Home Assistant needed)."""

from __future__ import annotations

import importlib
import asyncio
import json
import math
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("custom_components.hometwin")
package.__path__ = [str(ROOT / "custom_components" / "hometwin")]
sys.modules.setdefault("custom_components", types.ModuleType("custom_components"))
sys.modules["custom_components.hometwin"] = package


class HomeAssistantError(Exception):
    pass


def _module(name: str, **attrs):
    mod = types.ModuleType(name)
    mod.__dict__.update(attrs)
    sys.modules[name] = mod
    return mod


_module("aiohttp", ClientTimeout=lambda **_k: None, ClientError=Exception)
_module("homeassistant")
_module("homeassistant.core", HomeAssistant=object, callback=lambda f: f)
_module("homeassistant.exceptions", HomeAssistantError=HomeAssistantError)
helpers = _module("homeassistant.helpers")
for sub in ("area_registry", "device_registry", "entity_registry"):
    setattr(helpers, sub, _module(f"homeassistant.helpers.{sub}"))
_module("homeassistant.helpers.aiohttp_client", async_get_clientsession=lambda _h: None)
_module("custom_components.hometwin.views", read_underlay=lambda *_a, **_k: None)

agent = importlib.import_module("custom_components.hometwin.agent")

W, H = 1000, 800
ROOMS_PX = [
    {"name": "Living", "kind": "room", "points": [[100, 100], [500, 100], [500, 500], [100, 500]]},
    {"name": "Kitchen", "kind": "room", "points": [[500, 100], [800, 100], [800, 500], [500, 500]]},
]
DIMS_PX = [{"from": [100, 60], "to": [800, 60], "meters": 7.0}, {"from": [60, 100], "to": [60, 500], "meters": 4.0}]
REQ = {"width": W, "height": H, "mpp": 0.01, "x0": 0, "z0": 0, "language": "en"}


def post(answer: str, **req):
    return agent._detect_post(answer, {**REQ, **req}, lambda *_a, **_k: None)


def areas(res):
    return sorted(round(r["area"], 2) for r in res["rooms"])


plain = json.dumps({"rooms": ROOMS_PX, "openings": [], "dimensions": DIMS_PX})
expected = areas(post(plain))
assert expected == [12.0, 16.0], expected

# 1. Prose around a ```json fence, with braces in the prose (typical Claude answer).
claude = "Looking at the plan {carefully}, here is the result:\n\n```json\n" + plain + "\n```\n\nNote: the {w} value was used."
assert areas(post(claude)) == expected

# 2. Points as objects and numbers as strings with decimal comma.
obj = json.dumps({"rooms": [{"name": r["name"], "kind": r["kind"], "polygon": [{"x": str(p[0]).replace(".", ","), "y": p[1]} for p in r["points"]]} for r in ROOMS_PX]})
assert areas(post(obj)) == expected

# 3. Normalised 0..1 coordinates.
unit = json.dumps({"rooms": [{**r, "points": [[p[0] / W, p[1] / H] for p in r["points"]]} for r in ROOMS_PX]})
assert areas(post(unit)) == expected

# 4. Scale from dimension chains given as strings ("7,00 m"), no measured scale.
auto = json.dumps({"rooms": ROOMS_PX, "dimensions": [{**d, "meters": f"{d['meters']:.2f} m".replace(".", ",")} for d in DIMS_PX]})
res = post(auto, mpp=None)
assert abs(res["mpp"] - 0.01) < 1e-9 and areas(res) == expected

# 5. Answer nested one level deeper.
assert areas(post(json.dumps({"result": {"rooms": ROOMS_PX}}))) == expected

# 6. No silent empty result: unusable rooms and missing rooms raise a clear error.
for bad, word in ((json.dumps({"rooms": [{"name": "X", "points": "none"}]}), "none could be used"), (json.dumps({"rooms": []}), "did not return any rooms")):
    try:
        post(bad)
    except HomeAssistantError as err:
        assert word in str(err), err
    else:
        raise AssertionError("expected an error")

for coordinate in (float('nan'), float('inf'), float('-inf'), 1e309):
    bad = json.dumps({'rooms': [{'name': 'Invalid', 'points': [[0, 0], [coordinate, 0], [200, 200], [0, 200]]}]})
    try:
        post(bad)
    except HomeAssistantError as err:
        assert 'none could be used' in str(err), err
    else:
        raise AssertionError('non-finite coordinates must not become rooms')

# --- readings and scale by consistency (any notation) ---
r = agent._readings
assert 3.4 in r("3,40") and 0.875 in r("87,5") and any(abs(x - 3.315) < 1e-9 for x in r("3,31⁵")) and 3.4 in r("3400")
assert abs(r("12'-6\"")[0] - 3.81) < 1e-9 and abs(r("340 cm")[0] - 3.4) < 1e-9
# dimension texts in centimetres (values the old filter rejected) still give the scale
cm = json.dumps({"rooms": ROOMS_PX, "dimensions": [{"from": [100, 60], "to": [800, 60], "text": "700", "meters": 700}, {"from": [60, 100], "to": [60, 500], "text": "400", "meters": 400}]})
res = post(cm, mpp=None)
assert abs(res["mpp"] - 0.01) < 1e-9 and res["scale_source"] == "dimensions", res["mpp"]
# feet and inches
ft = json.dumps({"rooms": ROOMS_PX, "dimensions": [{"from": [100, 60], "to": [800, 60], "text": "22'-11 5/8\""}, {"from": [60, 100], "to": [60, 500], "text": "13'-1 1/2\""}]})
res = post(ft, mpp=None)
assert abs(res["mpp"] / 0.01 - 1) < 0.01, res["mpp"]
# no readable dimensions: printed room areas give the scale
areas = json.dumps({"rooms": [{**rm, "label_area_m2": a} for rm, a in zip(ROOMS_PX + [{"name": "Hall", "kind": "room", "points": [[100, 500], [800, 500], [800, 700], [100, 700]]}], (16.0, 12.0, 14.0))]})
res = post(areas, mpp=None)
assert res["scale_source"] == "areas" and abs(res["mpp"] - 0.01) < 1e-4, res["mpp"]
# nothing at all: rooms are kept, the wizard asks for one measurement
res = post(json.dumps({"rooms": ROOMS_PX}), mpp=None)
assert res["scale_source"] == "unknown" and len(res["rooms"]) == 2

# --- openings: printed label width wins, sill/height and door orientation are kept ---
labels = [{"id": "t1", "text": "1,25/1,15", "x": 0, "y": 0, "w": 1.25, "h": 1.15}, {"id": "t2", "text": "87,5", "x": 0, "y": 0, "m": 0.875, "w": 0.875}]
ops = json.dumps({"rooms": ROOMS_PX, "openings": [
    {"type": "window", "from": [150, 100], "to": [270, 100], "label": "t1"},
    {"type": "door", "from": [500, 200], "to": [500, 290], "label": "t2", "hinge": "to", "opens_into": "Kitchen"},
    {"type": "window", "from": [600, 100], "to": [700, 100], "width_m": "1,00", "sill_m": 0.6, "height_m": 1.4}]})
res = post(ops, labels=labels)
w0, d0, w1 = res["openings"]
assert abs(math.dist(w0["from"], w0["to"]) - 1.25) < 1e-6 and w0["printed"] and abs(w0["head"] - (0.9 + 1.15)) < 1e-6
assert abs(math.dist(d0["from"], d0["to"]) - 0.875) < 1e-6 and d0["hinge"] == "to" and d0["opens_into"] == "Kitchen"
assert abs(w1["sill"] - 0.6) < 1e-9 and abs(w1["head"] - 2.0) < 1e-9

# --- layout pass and openings pass ---
lay = agent._layout_post({"drawings": [{"type": "floor_plan", "label": "OG", "box": [10, 20, 500, 600]}, {"type": "title_block", "box": ["900", 0, 1200, 800]}, {"type": "x", "box": [1, 1, 2, 2]}]}, 1000, 800)
assert [d["type"] for d in lay["drawings"]] == ["floor_plan", "title_block"] and lay["drawings"][1]["box"][2] == 1000
tile = agent._openings_from({"openings": [{"wall": 2, "type": "door", "from": [10, 10], "to": [10, 98], "hinge": "from", "opens_into": "Hall"}, {"type": "sofa", "from": [0, 0], "to": [9, 9]}]}, {"mpp": 0.01, "x0": 5.0, "z0": 2.0}, "en")
assert len(tile) == 1 and tile[0]["from"] == [5.1, 2.1] and tile[0]["wall"] == 2
assert agent.image_max_px("anthropic/claude-opus-5.5") == 1568 and agent.image_max_px("google/gemini-4-argon") == 3072

async def check_openings_request():
    """Exercise real prompt construction and response parsing; only the model transport is stubbed."""
    payloads = []
    async def respond(hass, cfg, payload, on_text):
        payloads.append(payload)
        return json.dumps({"openings": [{"wall": 0, "type": "door", "from": [10, 10], "to": [10, 98]}]})

    original = agent._post_stream
    agent._post_stream = respond
    try:
        cfg = agent.AgentConfig("https://example.invalid", "", "test-model", "none", 1, "")
        result = await agent.run_detect(None, cfg, {**REQ, "mode": "openings", "image": "data:image/png;base64,test",
                                                   "walls": [[0, 0, 100, 0, "exterior"]] * 201, "rooms": []})
        assert result["openings"][0]["from"] == [0.1, 0.1]
        prompt = payloads[0]["messages"][1]["content"][0]["text"]
        assert "199: [0, 0, 100, 0] exterior" in prompt
        assert "200: [0, 0, 100, 0] exterior" not in prompt
    finally:
        agent._post_stream = original

asyncio.run(check_openings_request())
print("PASS: detection parsing and real openings request construction")
