"""Discover and fetch robot-vacuum map images from Home Assistant entities."""

from __future__ import annotations

import base64
from typing import Any

from homeassistant.components import camera, image
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity import entity_sources

from .const import MAX_UNDERLAY_BYTES

_IMAGE_DOMAINS = {"camera", "image"}
_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAP_PLATFORMS = {"dreame_vacuum", "xiaomi_cloud_map_extractor"}


class VacuumMapError(HomeAssistantError):
    """A safe error that can be returned by the vacuum-map websocket API."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def map_sources(hass: HomeAssistant) -> list[dict[str, str]]:
    """Return active camera/image entities that can safely be used as vacuum maps."""
    registry = er.async_get(hass)
    vacuum_devices = {
        entry.device_id
        for entry in registry.entities.values()
        if entry.domain == "vacuum" and entry.device_id and entry.disabled_by is None
    }
    runtime_sources = entity_sources(hass)
    result: list[dict[str, str]] = []

    for state in hass.states.async_all():
        domain = state.entity_id.partition(".")[0]
        if domain not in _IMAGE_DOMAINS:
            continue
        entry = registry.async_get(state.entity_id)
        if entry is not None and entry.disabled_by is not None:
            continue
        platform = (entry.platform if entry is not None else None) or runtime_sources.get(
            state.entity_id, {}
        ).get("domain", "")
        shares_vacuum_device = bool(
            entry is not None and entry.device_id and entry.device_id in vacuum_devices
        )
        if not shares_vacuum_device and platform.lower() not in _MAP_PLATFORMS:
            continue
        name = state.attributes.get("friendly_name") or state.entity_id
        result.append({"entity_id": state.entity_id, "name": str(name)})

    return sorted(result, key=lambda item: (item["name"].casefold(), item["entity_id"]))


async def async_fetch_map(hass: HomeAssistant, entity_id: str) -> dict[str, Any]:
    """Fetch one eligible map through Home Assistant's entity APIs."""
    if entity_id not in {item["entity_id"] for item in map_sources(hass)}:
        raise VacuumMapError("not_found", "Vacuum map entity not found")

    domain = entity_id.partition(".")[0]
    try:
        snapshot = (
            await camera.async_get_image(hass, entity_id, timeout=10)
            if domain == "camera"
            else await image.async_get_image(hass, entity_id, timeout=10)
        )
    except (HomeAssistantError, TimeoutError) as err:
        raise VacuumMapError("image_unavailable", "Vacuum map image is unavailable") from err

    content = snapshot.content
    content_type = snapshot.content_type.partition(";")[0].strip().lower()
    if not content:
        raise VacuumMapError("image_unavailable", "Vacuum map image is unavailable")
    if len(content) > MAX_UNDERLAY_BYTES:
        raise VacuumMapError("image_too_large", "Vacuum map image is too large")
    if content_type not in _IMAGE_TYPES:
        raise VacuumMapError("image_type", "Vacuum map image type is not supported")

    encoded = base64.b64encode(content).decode("ascii")
    return {"entity_id": entity_id, "image": f"data:{content_type};base64,{encoded}"}
