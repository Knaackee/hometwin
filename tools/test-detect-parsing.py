"""Floor-plan recognition: model answers in different shapes must give the same rooms (no Home Assistant needed)."""

from __future__ import annotations

import importlib
import json
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

print("PASS: detection parsing (fenced JSON, point/number formats, normalised coordinates, nested answers, clear errors)")
