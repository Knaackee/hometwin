"""HomeTwin: a 3D home dashboard panel for Home Assistant."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_DEMO,
    CONF_TITLE,
    CONF_UI_LANGUAGE,
    DEFAULT_UI_LANGUAGE,
    DEFAULT_TITLE,
    DOMAIN,
    LEGACY_DOMAIN,
    PANEL_COMPONENT,
    PANEL_ICON,
    PANEL_URL_PATH,
    STATIC_URL,
    VERSION,
)
from .store import PlanStore
from .views import UnderlayView
from .websocket import async_register_websocket

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
FRONTEND_DIR = Path(__file__).parent / "frontend"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register things that live for the whole HA run (websocket commands, views)."""
    hass.data.setdefault(DOMAIN, {})
    async_register_websocket(hass)
    hass.http.register_view(UnderlayView())
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), cache_headers=False)]
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up HomeTwin from a config entry: load the plan and show the panel."""
    if not entry.options:  # take over AI settings from a former Raumwerk installation
        old = hass.config_entries.async_entries(LEGACY_DOMAIN)
        if old and old[0].options:
            hass.config_entries.async_update_entry(entry, options={**old[0].options, CONF_TITLE: DEFAULT_TITLE})
    store = PlanStore(hass)
    await store.async_load()
    hass.data[DOMAIN]["store"] = store
    hass.data[DOMAIN]["entry"] = entry

    bundle = FRONTEND_DIR / "hometwin-panel.js"
    mtime = int((await hass.async_add_executor_job(bundle.stat)).st_mtime)
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_COMPONENT,
        sidebar_title=entry.options.get(CONF_TITLE, DEFAULT_TITLE),
        sidebar_icon=PANEL_ICON,
        module_url=f"{STATIC_URL}/hometwin-panel.js?v={VERSION}-{mtime}",
        embed_iframe=False,
        require_admin=False,
        config={
            "demo": entry.options.get(CONF_DEMO, True),
            "ui_language": entry.options.get(CONF_UI_LANGUAGE)
            if entry.options.get(CONF_UI_LANGUAGE) in {"en", "de"}
            else DEFAULT_UI_LANGUAGE,
        },
    )
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the panel. Websocket commands stay registered but report not loaded."""
    try:
        frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    except TypeError:  # Home Assistant before the keyword existed
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    hass.data[DOMAIN].pop("store", None)
    hass.data[DOMAIN].pop("entry", None)
    return True
