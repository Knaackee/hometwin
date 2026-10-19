"""Discover robots and safely start supported zone-cleaning actions."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity import entity_sources

_ROBOT_DOMAINS = {"vacuum", "lawn_mower"}
_XIAOMI_DOMAIN = "xiaomi_miio"
_ZONE_SERVICE = "vacuum_clean_zone"
MAX_ZONES = 5
# Xiaomi vacuum maps use millimetre coordinates around 25500. Keep requests
# inside the commonly used 51.2 m square even though HA's action has no bound.
MIN_COORDINATE = 0
MAX_COORDINATE = 51200


class RobotControlError(HomeAssistantError):
    """A safe error that can be returned by the robot websocket API."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _platform(hass: HomeAssistant, entity_id: str, entry: Any) -> str:
    if entry is not None and entry.platform:
        return str(entry.platform)
    return str(entity_sources(hass).get(entity_id, {}).get("domain", ""))


def _zone_service_available(hass: HomeAssistant) -> bool:
    return hass.services.has_service(_XIAOMI_DOMAIN, _ZONE_SERVICE)


def robot_entities(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Return active robot entities and their supported HomeTwin actions."""
    registry = er.async_get(hass)
    service_available = _zone_service_available(hass)
    result: list[dict[str, Any]] = []

    for state in hass.states.async_all():
        domain = state.entity_id.partition(".")[0]
        if domain not in _ROBOT_DOMAINS:
            continue
        entry = registry.async_get(state.entity_id)
        if entry is not None and entry.disabled_by is not None:
            continue
        platform = _platform(hass, state.entity_id, entry)
        result.append(
            {
                "entity_id": state.entity_id,
                "name": str(state.attributes.get("friendly_name") or state.entity_id),
                "platform": platform,
                "domain": domain,
                "zone_cleaning": bool(
                    service_available
                    and domain == "vacuum"
                    and entry is not None
                    and entry.domain == "vacuum"
                    and entry.platform == _XIAOMI_DOMAIN
                ),
            }
        )

    return sorted(result, key=lambda item: (item["name"].casefold(), item["entity_id"]))


def _validated_zones(zones: Any) -> list[list[int]]:
    if not isinstance(zones, list) or not 1 <= len(zones) <= MAX_ZONES:
        raise RobotControlError("invalid_zones", "Provide between 1 and 5 cleaning zones")

    validated: list[list[int]] = []
    for zone in zones:
        if not isinstance(zone, list) or len(zone) != 4:
            raise RobotControlError("invalid_zones", "Each cleaning zone must contain four coordinates")
        if any(isinstance(value, bool) or not isinstance(value, int) for value in zone):
            raise RobotControlError("invalid_zones", "Cleaning-zone coordinates must be integers")
        if any(value < MIN_COORDINATE or value > MAX_COORDINATE for value in zone):
            raise RobotControlError(
                "invalid_zones", f"Cleaning-zone coordinates must be between {MIN_COORDINATE} and {MAX_COORDINATE}"
            )
        x1, y1, x2, y2 = zone
        if x2 <= x1 or y2 <= y1:
            raise RobotControlError("invalid_zones", "Cleaning zones must have positive width and height")
        validated.append([x1, y1, x2, y2])
    return validated


async def async_clean_zones(
    hass: HomeAssistant,
    entity_id: str,
    zones: Any,
    repeats: Any,
    confirmed: Any,
) -> None:
    """Validate and start a Xiaomi Miio zone-cleaning action."""
    if confirmed is not True:
        raise RobotControlError("confirmation_required", "Zone cleaning must be confirmed")
    if isinstance(repeats, bool) or not isinstance(repeats, int) or not 1 <= repeats <= 3:
        raise RobotControlError("invalid_zones", "Cleaning repeats must be between 1 and 3")

    state = hass.states.get(entity_id)
    if state is None or entity_id.partition(".")[0] != "vacuum":
        raise RobotControlError("not_found", "Robot entity not found")
    registry = er.async_get(hass)
    entry = registry.async_get(entity_id)
    if (
        entry is None
        or entry.domain != "vacuum"
        or entry.disabled_by is not None
        or entry.platform != _XIAOMI_DOMAIN
    ):
        raise RobotControlError("unsupported", "This robot does not support zone cleaning")
    if not _zone_service_available(hass):
        raise RobotControlError("unsupported", "Xiaomi zone cleaning is unavailable")
    if state.state in {"unavailable", "unknown"}:
        raise RobotControlError("unavailable", "Robot is unavailable")

    validated = _validated_zones(zones)
    try:
        await hass.services.async_call(
            _XIAOMI_DOMAIN,
            _ZONE_SERVICE,
            {"entity_id": entity_id, "zone": validated, "repeats": repeats},
            blocking=True,
        )
    except HomeAssistantError as err:
        raise RobotControlError("action_failed", "Zone cleaning could not be started") from err
