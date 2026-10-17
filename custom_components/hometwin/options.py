"""Pure normalization and validation for integration options."""

from __future__ import annotations

from typing import Any

from .const import CONF_BASE_URL, CONF_UI_LANGUAGE, DEFAULT_UI_LANGUAGE, UI_LANGUAGES


def normalize_options(user_input: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    """Normalize submitted options and return Home Assistant field errors."""
    data = dict(user_input)
    errors: dict[str, str] = {}
    url = (data.get(CONF_BASE_URL) or "").strip()
    language = data.get(CONF_UI_LANGUAGE, DEFAULT_UI_LANGUAGE)
    if url and not url.startswith(("http://", "https://")):
        errors[CONF_BASE_URL] = "invalid_url"
    if language not in UI_LANGUAGES:
        errors[CONF_UI_LANGUAGE] = "invalid_language"
    data[CONF_BASE_URL] = url.rstrip("/")
    data[CONF_UI_LANGUAGE] = language
    return data, errors

