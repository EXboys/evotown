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


def _should_include(name: str, *, include_dot: bool) -> bool:
    if include_dot:
        return True
    if name.startswith(".") or name == ".evotown":
        return False
    return True


def list_workspace_files(
    workspace: dict[str, Any],
    *,
    prefix: str = "",
    subdir: str = "",
    include_dot: bool = False,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """Return files and directories at a single level under workspace root (or subdir).

    Set subdir to a relative path to list contents of a subdirectory.
    Directories are included as entries with is_dir=True.
    """
    root = workspaces.resolve_workspace_path(workspace)
    scan_dir = root
    if prefix:
        scan_dir = workspaces.resolve_workspace_path(workspace, prefix)
    if subdir:
        sub = subdir.lstrip("/")
        # Guard against path traversal
        candidate = (scan_dir / sub).resolve()
        try:
            candidate.relative_to(scan_dir)
        except ValueError:
            raise ValueError("subdir escapes workspace root")
        scan_dir = candidate

    if not scan_dir.is_dir():
        raise ValueError("directory not found")

    cap = max(1, min(limit, DEFAULT_LIMIT))
    entries: list[dict[str, Any]] = []
    truncated = False

    try:
        items = sorted(scan_dir.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except OSError:
        items = []

    for path in items:
        name = path.name
        if not _should_include(name, include_dot=include_dot):
            continue

        if path.is_symlink():
            try:
                target = path.resolve()
                is_dir = target.is_dir()
            except OSError:
                continue
        else:
            is_dir = path.is_dir()

        try:
            rel = path.relative_to(scan_dir).as_posix()
        except ValueError:
            continue

        try:
            size = path.stat().st_size if not is_dir else 0
        except OSError:
            size = 0

        entries.append({
            "path": rel,
            "name": name,
            "size": size,
            "is_dir": is_dir,
            "modified_at": _iso_mtime(path),
        })

        if len(entries) >= cap:
            truncated = True
            break

    return {"entries": entries, "truncated": truncated, "count": len(entries)}
