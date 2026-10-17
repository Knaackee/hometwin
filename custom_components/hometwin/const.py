"""Constants for HomeTwin."""

from __future__ import annotations

DOMAIN = "hometwin"
VERSION = "0.6.0b1"

PANEL_URL_PATH = "hometwin"
PANEL_COMPONENT = "hometwin-panel"
PANEL_ICON = "mdi:home-modern"
STATIC_URL = "/hometwin_static"

STORAGE_KEY = "hometwin.plan"
STORAGE_VERSION = 1
UNDERLAY_DIR = "hometwin"
# Data of the former name (Raumwerk), taken over automatically on first start.
LEGACY_DOMAIN = "raumwerk"
LEGACY_STORAGE_KEY = "raumwerk.plan"
LEGACY_UNDERLAY_DIR = "raumwerk"
SIGNAL_PLAN_UPDATED = "hometwin_plan_updated"

CONF_TITLE = "title"
CONF_BASE_URL = "base_url"
CONF_API_KEY = "api_key"
CONF_MODEL = "model"
CONF_UI_LANGUAGE = "ui_language"
CONF_REASONING = "reasoning_effort"
CONF_MAX_STEPS = "max_steps"
CONF_SYSTEM_PROMPT = "system_prompt"
CONF_DEMO = "demo_when_empty"

DEFAULT_TITLE = "HomeTwin"
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = ""
DEFAULT_UI_LANGUAGE = "en"
DEFAULT_REASONING = "none"
DEFAULT_MAX_STEPS = 12
REASONING_LEVELS = ["none", "low", "medium", "high"]
UI_LANGUAGES = ["en", "de"]

MAX_PLAN_BYTES = 5 * 1024 * 1024
MAX_UNDERLAY_BYTES = 15 * 1024 * 1024

RELEVANT_DOMAINS = (
    "light", "cover", "climate", "sensor", "binary_sensor", "media_player", "vacuum",
    "lawn_mower", "camera", "fan", "valve", "switch",
)

# Extra instructions from the options. The core prompt (agent.CORE_PROMPT) is always used.
DEFAULT_SYSTEM_PROMPT = ""
LEGACY_PROMPT_PREFIX = "Du bist der Raumwerk-Assistent"
