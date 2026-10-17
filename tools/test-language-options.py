"""Focused tests for UI-language option normalization without Home Assistant installed."""

from __future__ import annotations

import importlib
import asyncio
import json
import sys
import types
from pathlib import Path
from string import Formatter

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("custom_components.hometwin")
package.__path__ = [str(ROOT / "custom_components" / "hometwin")]
sys.modules.setdefault("custom_components", types.ModuleType("custom_components"))
sys.modules["custom_components.hometwin"] = package


class _Marker:
    def __init__(self, key, default=None):
        self.key, self.default = key, default

    def __hash__(self):
        return hash((self.key, self.default))


vol = types.ModuleType("voluptuous")
vol.Optional = lambda key, default=None: _Marker(key, default)
vol.Schema = lambda schema: schema
sys.modules["voluptuous"] = vol


class _Flow:
    def __init_subclass__(cls, **_kwargs):
        return super().__init_subclass__()

    def async_create_entry(self, **kwargs):
        return {"type": "create_entry", **kwargs}

    def async_show_form(self, **kwargs):
        return {"type": "form", **kwargs}

    def async_abort(self, **kwargs):
        return {"type": "abort", **kwargs}


class _Selector:
    def __init__(self, config=None, **kwargs):
        self.config, self.kwargs = config, kwargs


class _SelectorConfig:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


ha = types.ModuleType("homeassistant")
entries = types.ModuleType("homeassistant.config_entries")
entries.ConfigEntry = type("ConfigEntry", (), {})
entries.ConfigFlow = _Flow
entries.ConfigFlowResult = dict
entries.OptionsFlow = _Flow
core = types.ModuleType("homeassistant.core")
core.callback = lambda func: func
helpers = types.ModuleType("homeassistant.helpers")
selector = types.ModuleType("homeassistant.helpers.selector")
for name in ("BooleanSelector", "NumberSelector", "SelectSelector", "TextSelector"):
    setattr(selector, name, type(name, (_Selector,), {}))
for name in ("NumberSelectorConfig", "SelectSelectorConfig", "TextSelectorConfig"):
    setattr(selector, name, type(name, (_SelectorConfig,), {}))
for name in ("NumberSelectorMode", "SelectSelectorMode", "TextSelectorType"):
    setattr(selector, name, type(name, (), {"BOX": "box", "DROPDOWN": "dropdown", "URL": "url", "PASSWORD": "password"}))
sys.modules.update({
    "homeassistant": ha,
    "homeassistant.config_entries": entries,
    "homeassistant.core": core,
    "homeassistant.helpers": helpers,
    "homeassistant.helpers.selector": selector,
})

const = importlib.import_module("custom_components.hometwin.const")
normalize_options = importlib.import_module("custom_components.hometwin.options").normalize_options
HomeTwinOptionsFlow = importlib.import_module("custom_components.hometwin.config_flow").HomeTwinOptionsFlow
backend_i18n = importlib.import_module("custom_components.hometwin.i18n")
geometry = importlib.import_module("custom_components.hometwin.geometry")


def run_flow(options, user_input):
    flow = HomeTwinOptionsFlow()
    flow.config_entry = types.SimpleNamespace(options=options)
    return asyncio.run(flow.async_step_init(user_input))

data, errors = normalize_options({const.CONF_BASE_URL: " https://example.test/v1/ "})
assert not errors
assert data[const.CONF_UI_LANGUAGE] == "en"
assert data[const.CONF_BASE_URL] == "https://example.test/v1"

for language in ("en", "de"):
    data, errors = normalize_options({const.CONF_UI_LANGUAGE: language, const.CONF_BASE_URL: ""})
    assert not errors
    assert data[const.CONF_UI_LANGUAGE] == language

_data, errors = normalize_options({const.CONF_UI_LANGUAGE: "fr"})
assert errors == {const.CONF_UI_LANGUAGE: "invalid_language"}

_data, errors = normalize_options({const.CONF_UI_LANGUAGE: "de", const.CONF_BASE_URL: "ftp://example.test"})
assert errors == {const.CONF_BASE_URL: "invalid_url"}

result = run_flow({}, {const.CONF_BASE_URL: "https://example.test/v1/"})
assert result["type"] == "create_entry"
assert result["data"][const.CONF_UI_LANGUAGE] == "en"
assert result["data"][const.CONF_BASE_URL] == "https://example.test/v1"
for language in ("en", "de"):
    result = run_flow({}, {const.CONF_UI_LANGUAGE: language, const.CONF_BASE_URL: ""})
    assert result["type"] == "create_entry"
    assert result["data"][const.CONF_UI_LANGUAGE] == language
result = run_flow({}, {const.CONF_UI_LANGUAGE: "fr", const.CONF_BASE_URL: ""})
assert result["type"] == "form"
assert result["errors"] == {const.CONF_UI_LANGUAGE: "invalid_language"}
result = run_flow({}, {const.CONF_UI_LANGUAGE: "de", const.CONF_BASE_URL: "ftp://example.test"})
assert result["errors"] == {const.CONF_BASE_URL: "invalid_url"}

rooms = [
    {"name": "A", "kind": "room", "points": [[0, 0], [2, 0], [2, 2], [0, 2]]},
    {"name": "B", "kind": "room", "points": [[1, 1], [3, 1], [3, 3], [1, 3]]},
]
assert "overlap" in geometry.check_level(rooms, "en")[0]
assert "überlappen" in geometry.check_level(rooms, "de")[0]
assert backend_i18n.message("fr", "scale_missing") == "Scale is missing"

catalogs = {
    language: json.loads((ROOT / "custom_components" / "hometwin" / "locales" / f"{language}.json").read_text(encoding="utf-8"))
    for language in ("en", "de")
}
assert catalogs["en"].keys() == catalogs["de"].keys()
for key in catalogs["en"]:
    placeholders = [
        {field for _, field, _, _ in Formatter().parse(catalogs[language][key]) if field}
        for language in ("en", "de")
    ]
    assert placeholders[0] == placeholders[1], f"backend placeholder mismatch for {key}: {placeholders}"

print("PASS: options flow and backend diagnostics use validated English/German languages with catalog parity")

