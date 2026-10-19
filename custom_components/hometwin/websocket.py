"""Websocket API used by the HomeTwin panel."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .agent import AgentConfig, image_max_px, job_state, run_agent, run_detect, start_detect_job
from .const import CONF_UI_LANGUAGE, UI_LANGUAGES, DOMAIN, SIGNAL_PLAN_UPDATED
from .i18n import hass_message
from .robot_control import RobotControlError, async_clean_zones, robot_entities
from .vacuum_maps import VacuumMapError, async_fetch_map, map_sources


def _store(hass: HomeAssistant):
    store = hass.data.get(DOMAIN, {}).get("store")
    if store is None:
        raise HomeAssistantError(hass_message(hass, "not_loaded"))
    return store


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    for cmd in (
        ws_language_set,
        ws_plan_get,
        ws_plan_save,
        ws_plan_subscribe,
        ws_agent_info,
        ws_agent_chat,
        ws_agent_detect,
        ws_detect_start,
        ws_job,
        ws_job_consume,
        ws_vacuum_maps,
        ws_vacuum_map,
        ws_robots_list,
        ws_robots_clean_zone,
    ):
        websocket_api.async_register_command(hass, cmd)


@websocket_api.websocket_command({
    vol.Required("type"): "hometwin/language/set",
    vol.Required("language"): vol.In(UI_LANGUAGES),
})
@websocket_api.require_admin
@callback
def ws_language_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    entry = hass.data.get(DOMAIN, {}).get("entry")
    if entry is None:
        connection.send_error(msg["id"], "not_loaded", hass_message(hass, "not_loaded"))
        return
    hass.config_entries.async_update_entry(entry, options={**entry.options, CONF_UI_LANGUAGE: msg["language"]})
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): "hometwin/plan/get"})
@callback
def ws_plan_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        connection.send_result(msg["id"], {"plan": _store(hass).plan})
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "not_loaded", str(err))


@websocket_api.websocket_command(
    {vol.Required("type"): "hometwin/plan/save", vol.Required("plan"): dict, vol.Optional("client_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_plan_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    try:
        await _store(hass).async_save(msg["plan"], msg.get("client_id"))
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "invalid_plan", str(err))
        return
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): "hometwin/plan/subscribe"})
@callback
def ws_plan_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    @callback
    def forward(plan: dict[str, Any], client_id: str | None) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {"plan": plan, "client_id": client_id}))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_PLAN_UPDATED, forward)
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): "hometwin/agent/info"})
@websocket_api.require_admin
@callback
def ws_agent_info(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    entry = hass.data.get(DOMAIN, {}).get("entry")
    cfg = AgentConfig.from_options(entry.options if entry else {})
    connection.send_result(msg["id"], {"configured": cfg.configured, "model": cfg.model, "base_url": cfg.base_url, "image_max_px": image_max_px(cfg.model)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "hometwin/agent/chat",
        vol.Required("messages"): [dict],
        vol.Optional("level_id"): vol.Any(str, None),
        vol.Optional("include_underlay", default=False): bool,
        vol.Optional("plan"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_agent_chat(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    entry = hass.data.get(DOMAIN, {}).get("entry")
    cfg = AgentConfig.from_options(entry.options if entry else {})
    if not cfg.configured:
        connection.send_error(msg["id"], "not_configured", hass_message(hass, "not_configured"))
        return
    plan = msg.get("plan") or (_store(hass).plan or {"levels": []})
    try:
        result = await run_agent(hass, cfg, msg["messages"], plan, msg.get("level_id"), msg["include_underlay"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "agent_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "hometwin/agent/detect",
        vol.Required("image"): str,
        vol.Required("width"): int,
        vol.Required("height"): int,
        vol.Optional("mode", default="rooms"): vol.In(["rooms", "scale"]),
        vol.Optional("mpp"): vol.Coerce(float),
        vol.Optional("x0"): vol.Coerce(float),
        vol.Optional("z0"): vol.Coerce(float),
        vol.Optional("options"): dict,
        vol.Optional("hints"): str,
        vol.Optional("language"): str,
        vol.Optional("locked"): [dict],
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_agent_detect(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    entry = hass.data.get(DOMAIN, {}).get("entry")
    cfg = AgentConfig.from_options(entry.options if entry else {})
    if not cfg.configured:
        connection.send_error(msg["id"], "not_configured", hass_message(hass, "not_configured"))
        return
    if msg["mode"] == "rooms" and not msg.get("mpp"):
        connection.send_error(msg["id"], "invalid", hass_message(hass, "scale_missing"))
        return
    try:
        result = await run_detect(hass, cfg, msg)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "agent_failed", str(err))
        return
    connection.send_result(msg["id"], result)


_DETECT_SCHEMA = {
    vol.Required("image"): str,
    vol.Required("width"): int,
    vol.Required("height"): int,
    vol.Optional("mode", default="rooms"): vol.In(["rooms", "scale", "refine", "layout", "openings"]),
    vol.Optional("labels"): [dict],
    vol.Optional("walls"): [list],
    vol.Optional("rooms"): [dict],
    vol.Optional("mpp"): vol.Any(None, vol.Coerce(float)),
    vol.Optional("overlay"): str,
    vol.Optional("current"): dict,
    vol.Optional("x0"): vol.Coerce(float),
    vol.Optional("z0"): vol.Coerce(float),
    vol.Optional("options"): dict,
    vol.Optional("hints"): str,
    vol.Optional("language"): str,
    vol.Optional("locked"): [dict],
    vol.Optional("level_id"): vol.Any(str, None),
}


@websocket_api.websocket_command({vol.Required("type"): "hometwin/agent/detect_start", **_DETECT_SCHEMA})
@websocket_api.require_admin
@callback
def ws_detect_start(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    entry = hass.data.get(DOMAIN, {}).get("entry")
    cfg = AgentConfig.from_options(entry.options if entry else {})
    if not cfg.configured:
        connection.send_error(msg["id"], "not_configured", hass_message(hass, "not_configured"))
        return
    req = {k: v for k, v in msg.items() if k not in ("id", "type")}
    connection.send_result(msg["id"], {"job_id": start_detect_job(hass, cfg, req)})


@websocket_api.websocket_command({vol.Required("type"): "hometwin/agent/job", vol.Optional("job_id"): vol.Any(str, None), vol.Optional("with_image", default=False): bool, vol.Optional("with_raw", default=False): bool})
@websocket_api.require_admin
@callback
def ws_job(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], {"job": job_state(hass, msg.get("job_id"), msg["with_image"], msg["with_raw"])})


@websocket_api.websocket_command({vol.Required("type"): "hometwin/agent/job_consume", vol.Required("job_id"): str})
@websocket_api.require_admin
@callback
def ws_job_consume(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    job = hass.data.get(DOMAIN, {}).get("jobs", {}).get(msg["job_id"])
    if job:
        job["consumed"] = True
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): "hometwin/vacuum/maps"})
@websocket_api.require_admin
@callback
def ws_vacuum_maps(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    connection.send_result(msg["id"], {"maps": map_sources(hass)})


@websocket_api.websocket_command(
    {vol.Required("type"): "hometwin/vacuum/map", vol.Required("entity_id"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_map(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    try:
        result = await async_fetch_map(hass, msg["entity_id"])
    except VacuumMapError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): "hometwin/robots/list"})
@websocket_api.require_admin
@callback
def ws_robots_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    connection.send_result(msg["id"], {"robots": robot_entities(hass)})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "hometwin/robots/clean_zone",
        vol.Required("entity_id"): str,
        vol.Required("zones"): list,
        vol.Required("repeats"): int,
        vol.Required("confirmed"): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_robots_clean_zone(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    try:
        await async_clean_zones(
            hass, msg["entity_id"], msg["zones"], msg["repeats"], msg["confirmed"]
        )
    except RobotControlError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    connection.send_result(msg["id"], {})
