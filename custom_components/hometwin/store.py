"""Persistent storage of the house plan (in .storage, so it is part of HA backups)."""

from __future__ import annotations

import json
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

import logging
import shutil
from pathlib import Path

from .const import LEGACY_STORAGE_KEY, LEGACY_UNDERLAY_DIR, MAX_PLAN_BYTES, SIGNAL_PLAN_UPDATED, STORAGE_KEY, STORAGE_VERSION, UNDERLAY_DIR
from .i18n import language_from_hass, message

_LOGGER = logging.getLogger(__name__)


class PlanStore:
    """Holds the single house plan of this installation."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.plan: dict[str, Any] | None = None

    async def async_load(self) -> None:
        data = await self._store.async_load()
        self.plan = (data or {}).get("plan")
        if self.plan is None:  # first start after the rename: take over the Raumwerk plan and images
            legacy = await Store(self.hass, STORAGE_VERSION, LEGACY_STORAGE_KEY).async_load()
            if legacy and legacy.get("plan"):
                self.plan = legacy["plan"]
                await self._store.async_save({"plan": self.plan})
                await self.hass.async_add_executor_job(_copy_underlays, self.hass.config.path(LEGACY_UNDERLAY_DIR), self.hass.config.path(UNDERLAY_DIR))
                _LOGGER.info("HomeTwin: plan taken over from Raumwerk")

    async def async_save(self, plan: dict[str, Any], client_id: str | None = None) -> None:
        validate_plan(plan, language_from_hass(self.hass))
        self.plan = plan
        await self._store.async_save({"plan": plan})
        async_dispatcher_send(self.hass, SIGNAL_PLAN_UPDATED, plan, client_id)


def validate_plan(plan: Any, language: str = "en") -> None:
    """Light structural check; the frontend owns the detailed schema."""
    if not isinstance(plan, dict) or not isinstance(plan.get("levels"), list):
        raise HomeAssistantError(message(language, "plan_shape"))
    if len(json.dumps(plan)) > MAX_PLAN_BYTES:
        raise HomeAssistantError(message(language, "plan_too_large"))
    for level in plan["levels"]:
        if not isinstance(level, dict) or not isinstance(level.get("id"), str):
            raise HomeAssistantError(message(language, "invalid_level"))
        for key in ("rooms", "openings", "furniture", "devices"):
            if not isinstance(level.get(key, []), list):
                raise HomeAssistantError(message(language, "invalid_field", field=key))


def _copy_underlays(src: str, dst: str) -> None:
    s, d = Path(src), Path(dst)
    if not s.is_dir():
        return
    d.mkdir(parents=True, exist_ok=True)
    for f in s.glob("*.img"):
        if not (d / f.name).exists():
            shutil.copy2(f, d / f.name)
