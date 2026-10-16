"""Config and options flow for HomeTwin."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    BooleanSelector,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .const import (
    CONF_API_KEY,
    CONF_BASE_URL,
    CONF_DEMO,
    CONF_MAX_STEPS,
    CONF_MODEL,
    CONF_REASONING,
    CONF_SYSTEM_PROMPT,
    CONF_TITLE,
    DEFAULT_BASE_URL,
    DEFAULT_MAX_STEPS,
    DEFAULT_MODEL,
    DEFAULT_REASONING,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_TITLE,
    DOMAIN,
    LEGACY_PROMPT_PREFIX,
    REASONING_LEVELS,
)


def _extra(v: Any) -> str:
    """Stored extra instructions; the old full default prompt counts as empty."""
    v = (v or "").strip()
    return "" if v.startswith(LEGACY_PROMPT_PREFIX) else v


class HomeTwinConfigFlow(ConfigFlow, domain=DOMAIN):
    """One entry per installation; everything else lives in the options."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title=DEFAULT_TITLE, data={}, options={CONF_TITLE: user_input.get(CONF_TITLE, DEFAULT_TITLE), CONF_DEMO: user_input.get(CONF_DEMO, True)})
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Optional(CONF_TITLE, default=DEFAULT_TITLE): TextSelector(), vol.Optional(CONF_DEMO, default=True): BooleanSelector()}),
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return HomeTwinOptionsFlow()


class HomeTwinOptionsFlow(OptionsFlow):
    """Panel title and the optional AI agent endpoint."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        o = self.config_entry.options
        if user_input is not None:
            url = (user_input.get(CONF_BASE_URL) or "").strip()
            if url and not url.startswith(("http://", "https://")):
                errors[CONF_BASE_URL] = "invalid_url"
            else:
                return self.async_create_entry(data={**user_input, CONF_BASE_URL: url.rstrip("/")})
        schema = vol.Schema({
            vol.Optional(CONF_TITLE, default=o.get(CONF_TITLE, DEFAULT_TITLE)): TextSelector(),
            vol.Optional(CONF_DEMO, default=o.get(CONF_DEMO, True)): BooleanSelector(),
            vol.Optional(CONF_BASE_URL, default=o.get(CONF_BASE_URL, DEFAULT_BASE_URL)): TextSelector(TextSelectorConfig(type=TextSelectorType.URL)),
            vol.Optional(CONF_MODEL, default=o.get(CONF_MODEL, DEFAULT_MODEL)): TextSelector(),
            vol.Optional(CONF_API_KEY, default=o.get(CONF_API_KEY, "")): TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD)),
            vol.Optional(CONF_REASONING, default=o.get(CONF_REASONING, DEFAULT_REASONING)): SelectSelector(SelectSelectorConfig(options=REASONING_LEVELS, mode=SelectSelectorMode.DROPDOWN, translation_key="reasoning")),
            vol.Optional(CONF_MAX_STEPS, default=o.get(CONF_MAX_STEPS, DEFAULT_MAX_STEPS)): NumberSelector(NumberSelectorConfig(min=1, max=30, step=1, mode=NumberSelectorMode.BOX)),
            vol.Optional(CONF_SYSTEM_PROMPT, default=_extra(o.get(CONF_SYSTEM_PROMPT))): TextSelector(TextSelectorConfig(multiline=True)),
        })
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)
