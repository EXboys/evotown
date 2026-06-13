"""User file uploads into private coding-agent workspaces."""
from __future__ import annotations

import hashlib
import os
import re
import uuid
from pathlib import Path
from typing import Any

from infra import workspaces

_UPLOAD_DIR = "uploads"

_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"}
_ALLOWED_SUFFIXES = _IMAGE_SUFFIXES | {
    ".pdf",
    ".txt",
    ".md",
    ".json",
    ".csv",
    ".tsv",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".htm",
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".css",
    ".zip",
    ".tar",
    ".gz",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
}


def _max_file_bytes() -> int:
    raw = os.environ.get("EVOTOWN_WORKSPACE_UPLOAD_MAX_BYTES", "10485760").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 10 * 1024 * 1024


def _max_files_per_request() -> int:
    raw = os.environ.get("EVOTOWN_WORKSPACE_UPLOAD_MAX_FILES", "10").strip()
    try:
        return max(1, min(int(raw), 20))
    except ValueError:
        return 10


def _safe_filename(name: str) -> str:
    base = Path(name or "file").name
    base = re.sub(r"[^a-zA-Z0-9._-]+", "-", base).strip(".-")
    return (base[:120] or "file")


def _ensure_quota(workspace: dict[str, Any], extra_bytes: int) -> None:
    quota_mb = int(workspace.get("storage_quota_mb") or 0)
    if quota_mb <= 0:
        return
    used = workspaces.workspace_usage_bytes(workspace)
    if used + extra_bytes > quota_mb * 1024 * 1024:
        raise ValueError("workspace storage quota exceeded")


def save_upload(
    workspace: dict[str, Any],
    *,
    filename: str,
    content: bytes,
) -> dict[str, Any]:
    if not content:
        raise ValueError("empty file")
    max_bytes = _max_file_bytes()
    if len(content) > max_bytes:
        raise ValueError(f"file exceeds limit of {max_bytes} bytes")

    safe = _safe_filename(filename)
    suffix = Path(safe).suffix.lower()
    if suffix not in _ALLOWED_SUFFIXES:
        raise ValueError(f"file type not allowed: {suffix or '(no extension)'}")

    _ensure_quota(workspace, len(content))

    upload_id = uuid.uuid4().hex[:12]
    relative = f"{_UPLOAD_DIR}/{upload_id}_{safe}"
    target = workspaces.resolve_workspace_path(workspace, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)

    digest = hashlib.sha256(content).hexdigest()
    return {
        "path": relative.replace("\\", "/"),
        "filename": safe,
        "bytes": len(content),
        "sha256": digest,
        "kind": "image" if suffix in _IMAGE_SUFFIXES else "file",
        "content_type": _content_type_for_suffix(suffix),
    }


def save_uploads(
    workspace: dict[str, Any],
    files: list[tuple[str, bytes]],
) -> list[dict[str, Any]]:
    if not files:
        raise ValueError("no files provided")
    if len(files) > _max_files_per_request():
        raise ValueError(f"too many files (max {_max_files_per_request()})")

    saved: list[dict[str, Any]] = []
    for filename, content in files:
        saved.append(save_upload(workspace, filename=filename, content=content))
    return saved


def _content_type_for_suffix(suffix: str) -> str:
    mapping = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".bmp": "image/bmp",
        ".ico": "image/x-icon",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".json": "application/json",
        ".csv": "text/csv",
        ".html": "text/html",
        ".htm": "text/html",
        ".zip": "application/zip",
    }
    return mapping.get(suffix, "application/octet-stream")
