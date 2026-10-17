"""Small runtime message catalog for backend errors and diagnostics."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .const import CONF_UI_LANGUAGE, DEFAULT_UI_LANGUAGE, DOMAIN, UI_LANGUAGES

_LOCALES_DIR = Path(__file__).with_name("locales")
_MESSAGES = {
    language: json.loads((_LOCALES_DIR / f"{language}.json").read_text(encoding="utf-8"))
    for language in UI_LANGUAGES
}


def normalize_language(value: Any) -> str:
    """Return one of the supported interface languages."""
    return value if value in UI_LANGUAGES else DEFAULT_UI_LANGUAGE


def language_from_hass(hass: Any) -> str:
    """Read the configured interface language, defaulting safely to English."""
    entry = getattr(hass, "data", {}).get(DOMAIN, {}).get("entry")
    return normalize_language(entry.options.get(CONF_UI_LANGUAGE) if entry else None)


def message(language: str, key: str, **params: Any) -> str:
    """Format a backend message in the requested language with English fallback."""
    lang = normalize_language(language)
    template = _MESSAGES.get(lang, _MESSAGES["en"]).get(key, _MESSAGES["en"].get(key, key))
    return template.format(**params)


def hass_message(hass: Any, key: str, **params: Any) -> str:
    """Format a backend message using the integration option."""
    return message(language_from_hass(hass), key, **params)
