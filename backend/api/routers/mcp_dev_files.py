"""Shared MCP development directory file listing."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from core.auth import require_console_read

router = APIRouter(prefix="/api/v1/mcp-dev", tags=["mcp-dev"])

MCP_DEV_DIR = Path(os.environ.get("EVOTOWN_MCP_DEV_DIR", "/app/data/mcp-dev"))


def _scan(dir_path: str, depth: int = 1) -> list[dict[str, Any]]:
    """Scan a directory, returning one-level file listing."""
    path = MCP_DEV_DIR / dir_path
    if not path.is_dir():
        return []
    entries: list[dict[str, Any]] = []
    for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        entries.append({
            "path": f"{dir_path.rstrip('/')}/{child.name}" + ("/" if child.is_dir() else "") if dir_path else child.name + ("/" if child.is_dir() else ""),
            "name": child.name,
            "size": child.stat().st_size if child.is_file() else 0,
        })
    return entries


@router.get("/files", dependencies=[Depends(require_console_read)])
async def list_mcp_dev_files(
    path: str = Query("", description="相对路径，空=根目录"),
):
    path = path.strip("/").replace("..", "")
    if not MCP_DEV_DIR.is_dir():
        return {"entries": []}
    return {"entries": _scan(path)}


@router.get("/files/read", dependencies=[Depends(require_console_read)])
async def read_mcp_dev_file(path: str = Query(..., description="文件相对路径")):
    file_path = MCP_DEV_DIR / path.replace("..", "").lstrip("/")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    try:
        content = file_path.read_text(encoding="utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="cannot read file")
    return {"path": path, "content": content, "size": file_path.stat().st_size, "truncated": False}
