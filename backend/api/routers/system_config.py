"""System config API router — admin CRUD + public read + logo upload + restart."""

import subprocess
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from infra import system_config

router = APIRouter(prefix="/api/v1/system-config", tags=["system-config"])

# ── Admin endpoints ──


@router.get("/admin")
async def get_admin_config():
    """Get all config rows (admin only — auth checked by caller)."""
    return {"configs": system_config.get_all()}


@router.patch("/admin")
async def update_admin_config(body: dict):
    """Update config values. Body: {"<key>": "<new_value>", ...}

    Returns restart_needed array listing keys that require a backend restart.
    """
    # body could be { "updates": {...} } or flat { "key": "value", ... }
    raw_updates = body.get("updates") if isinstance(body, dict) and isinstance(body.get("updates"), dict) else body
    # Filter to only known keys
    clean: dict[str, str] = {}
    for k, v in raw_updates.items():
        if isinstance(v, str):
            clean[k] = v
    if not clean:
        raise HTTPException(400, "No valid config keys provided")
    restart_needed = system_config.update_config(clean)
    return {"ok": True, "restart_needed": restart_needed}


@router.post("/restart")
async def restart_backend():
    """Attempt to restart the backend container.

    Tries docker restart of the evotown-backend-1 container.
    Returns ok=true if the restart command was issued (the response
    may not arrive before the container goes down).
    """
    try:
        subprocess.Popen(
            ["docker", "restart", "evotown-backend-1"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return {"ok": True}
    except FileNotFoundError:
        return {"ok": False, "error": "docker not available — please restart manually"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── Public endpoint (no auth needed) ──


@router.get("/public")
async def get_public_config():
    """Public key→value map for frontend rendering (brand, hero text, etc.)."""
    return system_config.get_public()


# ── Logo upload ──


@router.post("/logo")
async def upload_logo(file: UploadFile = File(...)):
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files allowed")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:  # 5 MB
        raise HTTPException(400, "File too large (max 5 MB)")
    filename = system_config.save_logo(data)
    return {"ok": True, "filename": filename}
