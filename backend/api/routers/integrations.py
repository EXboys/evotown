"""Third-party runtime integrations (OpenClaw plugin bundle)."""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

router = APIRouter(prefix="/api/v1/integrations", tags=["integrations"])

_PLUGIN_ROOT = Path(__file__).resolve().parents[3] / "integrations" / "openclaw" / "evotown"


def _public_url() -> str:
    return os.environ.get("EVOTOWN_PUBLIC_URL", "").strip().rstrip("/")


@router.get("/openclaw/manifest")
async def openclaw_plugin_manifest():
    manifest_path = _PLUGIN_ROOT / "openclaw.plugin.json"
    if not manifest_path.is_file():
        return JSONResponse(status_code=404, content={"detail": "plugin manifest not found"})
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    public = _public_url()
    if public:
        data = {
            **data,
            "evotown_public_url": public,
            "install_hint": {
                "openclaw_plugins_install": f"openclaw plugins install {public}/api/v1/integrations/openclaw/archive.tgz",
                "local_path": str(_PLUGIN_ROOT),
            },
        }
    return {"plugin": data}


@router.get("/openclaw/install")
async def openclaw_install_guide():
    public = _public_url() or "https://evotown.example.com"
    return {
        "runtime": "openclaw",
        "plugin_id": "evotown",
        "steps": [
            f"Set EVOTOWN_URL={public} and issue an API key with gateway.chat + console.read scopes.",
            "Install plugin: openclaw plugins install ./integrations/openclaw/evotown (from repo) "
            f"or fetch manifest from {public}/api/v1/integrations/openclaw/manifest",
            "Run onboarding: openclaw configure --section providers and select Evotown Gateway.",
            "Source docs/templates/evotown.agent.env on employee laptops (see ENTERPRISE_QUICKSTART.md).",
        ],
        "manifest_url": f"{public}/api/v1/integrations/openclaw/manifest",
        "archive_url": f"{public}/api/v1/integrations/openclaw/archive.tgz",
    }


@router.get("/openclaw/openclaw.plugin.json")
async def openclaw_plugin_descriptor():
    path = _PLUGIN_ROOT / "openclaw.plugin.json"
    if not path.is_file():
        return JSONResponse(status_code=404, content={"detail": "not found"})
    return FileResponse(path, media_type="application/json", filename="openclaw.plugin.json")


@router.get("/openclaw/archive.tgz")
async def openclaw_plugin_archive():
    archive = _PLUGIN_ROOT / "evotown-openclaw-plugin.tgz"
    if archive.is_file():
        return FileResponse(archive, media_type="application/gzip", filename="evotown-openclaw-plugin.tgz")
    return JSONResponse(
        status_code=404,
        content={
            "detail": "Run scripts/package-openclaw-plugin.sh to build archive, or install from repo path.",
            "local_path": str(_PLUGIN_ROOT),
        },
    )
