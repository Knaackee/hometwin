"""Focused tests for robot discovery and guarded zone cleaning."""

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
homeassistant.helpers = helpers
sys.modules.update(
    {
        "homeassistant": homeassistant,
        "homeassistant.core": core,
        "homeassistant.exceptions": exceptions,
        "homeassistant.helpers": helpers,
        "homeassistant.helpers.entity": entity,
        "homeassistant.helpers.entity_registry": entity_registry,
    }
)

robot_control = importlib.import_module("custom_components.hometwin.robot_control")


class Entry:
    def __init__(self, domain, platform, disabled_by=None):
        self.domain = domain
        self.platform = platform
        self.disabled_by = disabled_by


class Registry:
    def __init__(self, entities):
        self.entities = entities

    def async_get(self, entity_id):
        return self.entities.get(entity_id)


class States:
    def __init__(self, states):
        self._states = {state.entity_id: state for state in states}

    def async_all(self):
        return list(self._states.values())

    def get(self, entity_id):
        return self._states.get(entity_id)


class Services:
    def __init__(self, available=True):
        self.available = available
        self.calls = []

    def has_service(self, domain, service):
        assert (domain, service) == ("xiaomi_miio", "vacuum_clean_zone")
        return self.available

    async def async_call(self, domain, service, data, blocking):
        self.calls.append((domain, service, data, blocking))


def state(entity_id, name, value="idle"):
    return types.SimpleNamespace(
        entity_id=entity_id, state=value, attributes={"friendly_name": name}
    )


entities = {
    "vacuum.robot": Entry("vacuum", "xiaomi_miio"),
    "vacuum.other": Entry("vacuum", "dreame_vacuum"),
    "lawn_mower.garden": Entry("lawn_mower", "husqvarna_automower"),
    "vacuum.disabled": Entry("vacuum", "xiaomi_miio", disabled_by="user"),
}
services = Services()
hass = types.SimpleNamespace(
    registry=Registry(entities),
    sources={},
    services=services,
    states=States(
        [
            state("vacuum.other", "Other"),
            state("vacuum.robot", "Robot"),
            state("lawn_mower.garden", "Garden"),
            state("vacuum.disabled", "Disabled"),
            state("sensor.ignore", "Ignore"),
        ]
    ),
)

assert robot_control.robot_entities(hass) == [
    {
        "entity_id": "lawn_mower.garden",
        "name": "Garden",
        "platform": "husqvarna_automower",
        "domain": "lawn_mower",
        "zone_cleaning": False,
    },
    {
        "entity_id": "vacuum.other",
        "name": "Other",
        "platform": "dreame_vacuum",
        "domain": "vacuum",
        "zone_cleaning": False,
    },
    {
        "entity_id": "vacuum.robot",
        "name": "Robot",
        "platform": "xiaomi_miio",
        "domain": "vacuum",
        "zone_cleaning": True,
    },
]

asyncio.run(
    robot_control.async_clean_zones(
        hass, "vacuum.robot", [[100, 200, 300, 400]], 2, True
    )
)
assert services.calls == [
    (
        "xiaomi_miio",
        "vacuum_clean_zone",
        {"entity_id": "vacuum.robot", "zone": [[100, 200, 300, 400]], "repeats": 2},
        True,
    )
]


def expect_error(code, entity_id="vacuum.robot", zones=None, repeats=1, confirmed=True):
    try:
        asyncio.run(
            robot_control.async_clean_zones(
                hass,
                entity_id,
                [[100, 200, 300, 400]] if zones is None else zones,
                repeats,
                confirmed,
            )
        )
    except robot_control.RobotControlError as err:
        assert err.code == code, (err.code, code)
    else:
        raise AssertionError(f"expected {code}")


expect_error("confirmation_required", confirmed=False)
expect_error("unsupported", entity_id="vacuum.other")
expect_error("not_found", entity_id="vacuum.missing")
expect_error("invalid_zones", zones=[])
expect_error("invalid_zones", zones=[[100, 200, 100, 400]])
expect_error("invalid_zones", zones=[[True, 200, 300, 400]])
expect_error("invalid_zones", zones=[[100, 200, float("nan"), 400]])
expect_error("invalid_zones", zones=[[100, 200, 51201, 400]])
expect_error("invalid_zones", zones=[[100, 200, 300, 400]] * 6)
expect_error("invalid_zones", repeats=True)

hass.states._states["vacuum.robot"].state = "unavailable"
expect_error("unavailable")
hass.states._states["vacuum.robot"].state = "idle"
services.available = False
expect_error("unsupported")

print("PASS: robot actions are discovered and guarded before service calls")
