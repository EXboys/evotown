"""List files inside a hosted coding workspace (path-guarded)."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from infra import workspaces

DEFAULT_LIMIT = 400


def _iso_mtime(path: Path) -> str | None:
    try:
        ts = path.stat().st_mtime
    except OSError:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).replace(microsecond=0).isoformat()


def _should_include(rel_posix: str, *, include_dot: bool) -> bool:
    if include_dot:
        return True
    parts = rel_posix.split("/")
    if parts[0].startswith("."):
        return False
    if ".evotown" in parts:
        return False
    return True


def list_workspace_files(
    workspace: dict[str, Any],
    *,
    prefix: str = "",
    include_dot: bool = False,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """Return a flat, sorted list of files under the workspace root (relative paths only)."""
    root = workspaces.resolve_workspace_path(workspace)
    scan_root = workspaces.resolve_workspace_path(workspace, prefix) if prefix else root
    if not scan_root.is_dir():
        raise ValueError("directory not found")

    cap = max(1, min(limit, DEFAULT_LIMIT))
    entries: list[dict[str, Any]] = []
    truncated = False

    for path in sorted(scan_root.rglob("*"), key=lambda p: p.as_posix()):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:
            continue
        if not _should_include(rel, include_dot=include_dot):
            continue
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        entries.append(
            {
                "path": rel,
                "name": path.name,
                "size": size,
                "modified_at": _iso_mtime(path),
            }
        )
        if len(entries) >= cap:
            truncated = True
            break

    entries.sort(key=lambda item: item["path"])
    return {"entries": entries, "truncated": truncated, "count": len(entries)}
