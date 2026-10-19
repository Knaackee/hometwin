"""Focused tests for safe robot-vacuum map discovery and image fetching."""

from __future__ import annotations

import asyncio
import importlib
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


camera = types.ModuleType("homeassistant.components.camera")
image = types.ModuleType("homeassistant.components.image")
components = types.ModuleType("homeassistant.components")
components.camera = camera
components.image = image
core = types.ModuleType("homeassistant.core")
core.HomeAssistant = object
exceptions = types.ModuleType("homeassistant.exceptions")
exceptions.HomeAssistantError = HomeAssistantError
entity = types.ModuleType("homeassistant.helpers.entity")
entity.entity_sources = lambda hass: hass.sources
entity_registry = types.ModuleType("homeassistant.helpers.entity_registry")
entity_registry.async_get = lambda hass: hass.registry
helpers = types.ModuleType("homeassistant.helpers")
helpers.entity_registry = entity_registry
homeassistant = types.ModuleType("homeassistant")
homeassistant.components = components
homeassistant.helpers = helpers
sys.modules.update(
    {
        "homeassistant": homeassistant,
        "homeassistant.components": components,
        "homeassistant.components.camera": camera,
        "homeassistant.components.image": image,
        "homeassistant.core": core,
        "homeassistant.exceptions": exceptions,
        "homeassistant.helpers": helpers,
        "homeassistant.helpers.entity": entity,
        "homeassistant.helpers.entity_registry": entity_registry,
    }
)

vacuum_maps = importlib.import_module("custom_components.hometwin.vacuum_maps")


class Entry:
    def __init__(self, domain, platform, device_id=None, disabled_by=None):
        self.domain = domain
        self.platform = platform
        self.device_id = device_id
        self.disabled_by = disabled_by


class Registry:
    def __init__(self, entities):
        self.entities = entities

    def async_get(self, entity_id):
        return self.entities.get(entity_id)


class States:
    def __init__(self, states):
        self._states = states

    def async_all(self):
        return self._states


def state(entity_id, name):
    return types.SimpleNamespace(entity_id=entity_id, attributes={"friendly_name": name})


entities = {
    "vacuum.robot": Entry("vacuum", "xiaomi_miio", "robot-device"),
    "image.robot_map": Entry("image", "generic_map", "robot-device"),
    "camera.disabled_map": Entry("camera", "dreame_vacuum", disabled_by="user"),
}
hass = types.SimpleNamespace(
    registry=Registry(entities),
    sources={
        "camera.xiaomi_cloud_map_extractor": {"domain": "xiaomi_cloud_map_extractor"},
        "camera.unrelated": {"domain": "generic"},
    },
    states=States(
        [
            state("camera.unrelated", "Unrelated"),
            state("image.robot_map", "Robot map"),
            state("camera.xiaomi_cloud_map_extractor", "Xiaomi map"),
            state("camera.disabled_map", "Disabled map"),
        ]
    ),
)

assert vacuum_maps.map_sources(hass) == [
    {"entity_id": "image.robot_map", "name": "Robot map"},
    {"entity_id": "camera.xiaomi_cloud_map_extractor", "name": "Xiaomi map"},
]


async def camera_snapshot(_hass, entity_id, timeout):
    assert entity_id == "camera.xiaomi_cloud_map_extractor"
    assert timeout == 10
    return types.SimpleNamespace(content=b"png", content_type="image/png")


async def image_snapshot(_hass, entity_id, timeout):
    assert entity_id == "image.robot_map"
    assert timeout == 10
    return types.SimpleNamespace(content=b"jpg", content_type="image/jpeg; charset=binary")


camera.async_get_image = camera_snapshot
image.async_get_image = image_snapshot

result = asyncio.run(vacuum_maps.async_fetch_map(hass, "camera.xiaomi_cloud_map_extractor"))
assert result == {
    "entity_id": "camera.xiaomi_cloud_map_extractor",
    "image": "data:image/png;base64,cG5n",
}
result = asyncio.run(vacuum_maps.async_fetch_map(hass, "image.robot_map"))
assert result["image"] == "data:image/jpeg;base64,anBn"

try:
    asyncio.run(vacuum_maps.async_fetch_map(hass, "camera.unrelated"))
except vacuum_maps.VacuumMapError as err:
    assert err.code == "not_found"
else:
    raise AssertionError("unrelated cameras must not be fetched")


async def unavailable(*_args, **_kwargs):
    raise TimeoutError


camera.async_get_image = unavailable
try:
    asyncio.run(vacuum_maps.async_fetch_map(hass, "camera.xiaomi_cloud_map_extractor"))
except vacuum_maps.VacuumMapError as err:
    assert err.code == "image_unavailable"
else:
    raise AssertionError("camera timeouts must be reported safely")


async def oversized(*_args, **_kwargs):
    return types.SimpleNamespace(
        content=b"x" * (vacuum_maps.MAX_UNDERLAY_BYTES + 1), content_type="image/png"
    )


camera.async_get_image = oversized
try:
    asyncio.run(vacuum_maps.async_fetch_map(hass, "camera.xiaomi_cloud_map_extractor"))
except vacuum_maps.VacuumMapError as err:
    assert err.code == "image_too_large"
else:
    raise AssertionError("oversized map images must be rejected")


async def unsafe_type(*_args, **_kwargs):
    return types.SimpleNamespace(content=b"<svg/>", content_type="image/svg+xml")


camera.async_get_image = unsafe_type
try:
    asyncio.run(vacuum_maps.async_fetch_map(hass, "camera.xiaomi_cloud_map_extractor"))
except vacuum_maps.VacuumMapError as err:
    assert err.code == "image_type"
else:
    raise AssertionError("unsafe image types must be rejected")

print("PASS: vacuum maps are restricted, bounded, and fetched through Home Assistant entity APIs")
