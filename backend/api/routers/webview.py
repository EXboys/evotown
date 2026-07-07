"""Webview static file serving — Agent-produced HTML/frontend artifacts.

Mounts /app/data/webview/ and serves files via /api/v1/webview/{path}.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/v1/webview", tags=["webview"])

WEBVIEW_ROOT = Path("/app/data/webview")


@router.get("/{file_path:path}")
async def serve_webview_file(file_path: str):
    """Serve a static file from the webview directory.

    URL: /api/v1/webview/{agent_id}/{filename}
    Example: /api/v1/webview/agt_xxx/report.html
    """
    full_path = (WEBVIEW_ROOT / file_path).resolve()

    # Security: ensure the resolved path is inside WEBVIEW_ROOT
    if not str(full_path).startswith(str(WEBVIEW_ROOT.resolve())):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="access denied")

    if not full_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="file not found")

    return FileResponse(
        full_path,
        media_type=_guess_media_type(str(full_path)),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


def _guess_media_type(path: str) -> str:
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return {
        "html": "text/html; charset=utf-8",
        "htm": "text/html; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "js": "application/javascript; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "ico": "image/x-icon",
        "pdf": "application/pdf",
        "txt": "text/plain; charset=utf-8",
        "md": "text/markdown; charset=utf-8",
    }.get(ext, "application/octet-stream")
