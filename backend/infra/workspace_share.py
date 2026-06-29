"""Copy workspace files between hosted coding agents."""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from infra import agents

_DENY_PREFIXES = (".evotown/", ".git/")


class ShareError(ValueError):
    """Base error for share validation failures."""


class ShareConflictError(ShareError):
    """Target path already exists and overwrite is disabled."""


class ShareSizeLimitError(ShareError):
    """Total bytes exceed configured share limit."""


def _max_share_bytes() -> int:
    raw = os.environ.get("EVOTOWN_SHARE_MAX_BYTES", str(20 * 1024 * 1024)).strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 20 * 1024 * 1024


def _normalize_rel_path(raw: str) -> str:
    rel = str(raw or "").strip().replace("\\", "/").lstrip("/")
    if not rel or rel == ".":
        raise ShareError("empty path")
    if ".." in rel.split("/"):
        raise ShareError(f"path traversal not allowed: {rel}")
    return rel


def _is_denied(rel: str) -> bool:
    normalized = rel.rstrip("/") + "/"
    return any(normalized.startswith(prefix) for prefix in _DENY_PREFIXES)


def normalize_dest_prefix(prefix: str, *, source_agent_id: str) -> str:
    raw = str(prefix or "").strip().replace("\\", "/").lstrip("/")
    if not raw:
        raw = f"shared/{source_agent_id}/"
    if not raw.endswith("/"):
        raw = raw + "/"
    if ".." in raw.split("/"):
        raise ShareError("dest_prefix must not contain ..")
    return raw


def _collect_source_files(source_agent: dict[str, Any], rel_path: str) -> list[tuple[str, Path]]:
    """Return (relative path from workspace root, absolute path) pairs."""
    if _is_denied(rel_path):
        raise ShareError(f"path not allowed: {rel_path}")

    source = agents.resolve_agent_path(source_agent, rel_path)
    if source.is_symlink():
        raise ShareError(f"symlinks cannot be shared: {rel_path}")

    collected: list[tuple[str, Path]] = []
    if source.is_dir():
        root = agents.resolve_agent_path(source_agent)
        for path in sorted(source.rglob("*")):
            if not path.is_file() or path.is_symlink():
                continue
            try:
                rel = path.relative_to(root).as_posix()
            except ValueError:
                continue
            if _is_denied(rel):
                continue
            collected.append((rel, path))
        if not collected:
            raise ShareError(f"directory is empty or has no shareable files: {rel_path}")
        return collected

    if not source.is_file():
        raise ShareError(f"path not found: {rel_path}")
    return [(rel_path, source)]


def share_files(
    source_agent: dict[str, Any],
    target_agent: dict[str, Any],
    *,
    paths: list[str],
    dest_prefix: str = "",
    overwrite: bool = False,
) -> dict[str, Any]:
    if not paths:
        raise ShareError("paths must not be empty")

    source_agent_id = str(source_agent.get("agent_id") or "")
    target_agent_id = str(target_agent.get("agent_id") or "")
    prefix = normalize_dest_prefix(dest_prefix, source_agent_id=source_agent_id)

    seen_sources: set[str] = set()
    file_pairs: list[tuple[str, Path]] = []
    for raw in paths:
        rel = _normalize_rel_path(raw)
        if rel in seen_sources:
            continue
        seen_sources.add(rel)
        file_pairs.extend(_collect_source_files(source_agent, rel))

    total_bytes = 0
    for rel, src in file_pairs:
        try:
            total_bytes += src.stat().st_size
        except OSError as exc:
            raise ShareError(f"cannot stat source file: {rel}") from exc
    max_bytes = _max_share_bytes()
    if total_bytes > max_bytes:
        raise ShareSizeLimitError(f"share exceeds limit of {max_bytes} bytes (got {total_bytes})")

    copied: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    serve_urls: list[str] = []

    for rel, src in file_pairs:
        dest_rel = f"{prefix}{rel}".replace("//", "/")
        dest = agents.resolve_agent_path(target_agent, dest_rel)
        if dest.exists() and not overwrite:
            raise ShareConflictError(f"target already exists: {dest_rel}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        size = dest.stat().st_size
        copied.append({"from": rel, "to": dest_rel, "bytes": size})
        if dest_rel.lower().endswith((".html", ".htm")):
            serve_urls.append(f"/api/v1/agents/{target_agent_id}/serve/{dest_rel}")

    return {
        "source_agent_id": source_agent_id,
        "target_agent_id": target_agent_id,
        "dest_prefix": prefix,
        "copied": copied,
        "skipped": skipped,
        "serve_urls": serve_urls,
        "total_bytes": total_bytes,
    }
