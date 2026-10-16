"""HTTP endpoint for floor-plan images (underlays) used for tracing."""

from __future__ import annotations

import re
from pathlib import Path

from aiohttp import web

from homeassistant.components.http import KEY_HASS, HomeAssistantView

from .const import MAX_UNDERLAY_BYTES, UNDERLAY_DIR

LEVEL_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
JPEG, PNG = b"\xff\xd8\xff", b"\x89PNG"


class UnderlayView(HomeAssistantView):
    """GET/POST /api/hometwin/underlay/<level_id> (authenticated)."""

    url = "/api/hometwin/underlay/{level_id}"
    name = "api:hometwin:underlay"
    requires_auth = True

    def _path(self, request: web.Request, level_id: str) -> Path:
        if not LEVEL_ID.match(level_id):
            raise web.HTTPBadRequest(text="invalid level id")
        return Path(request.app[KEY_HASS].config.path(UNDERLAY_DIR, f"{level_id}.img"))

    async def get(self, request: web.Request, level_id: str) -> web.StreamResponse:
        path = self._path(request, level_id)
        hass = request.app[KEY_HASS]
        data = await hass.async_add_executor_job(_read, path)
        if data is None:
            return web.Response(status=404)
        ctype = "image/png" if data.startswith(PNG) else "image/jpeg"
        return web.Response(body=data, content_type=ctype, headers={"Cache-Control": "no-cache"})

    async def post(self, request: web.Request, level_id: str) -> web.Response:
        user = request.get("hass_user")
        if user is None or not user.is_admin:
            return web.Response(status=403, text="admin required")
        path = self._path(request, level_id)
        data = await request.read()
        if not data or len(data) > MAX_UNDERLAY_BYTES:
            return web.Response(status=413, text="image too large")
        if not (data.startswith(JPEG) or data.startswith(PNG)):
            return web.Response(status=415, text="only JPEG or PNG")
        await request.app[KEY_HASS].async_add_executor_job(_write, path, data)
        return web.json_response({"ok": True, "bytes": len(data)})


def _read(path: Path) -> bytes | None:
    return path.read_bytes() if path.is_file() else None


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def read_underlay(config_path: str, level_id: str) -> bytes | None:
    """Used by the agent to attach the image."""
    if not LEVEL_ID.match(level_id or ""):
        return None
    return _read(Path(config_path) / UNDERLAY_DIR / f"{level_id}.img")
