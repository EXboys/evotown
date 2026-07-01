"""Post-run artifact sorting into workspace subdirectories."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any

_SORTED_PREFIXES = ("dashboard/", "downloads/", "output/")
_PROTECTED_PREFIXES = ("skills/",)

_DEFAULT_RULES: list[dict[str, Any]] = [
    {"match": {"ext": ["html", "htm"]}, "dest": "dashboard"},
    {
        "match": {
            "ext": [
                "pdf",
                "zip",
                "png",
                "jpg",
                "jpeg",
                "gif",
                "webp",
                "xlsx",
                "docx",
            ],
        },
        "dest": "downloads",
    },
    {"match": {"ext": ["md", "txt", "json", "csv"]}, "dest": "output"},
]


def _load_rules() -> tuple[list[dict[str, Any]], str | None]:
    raw = os.environ.get("EVOTOWN_ARTIFACT_SORT_RULES", "").strip()
    if not raw:
        return [dict(rule) for rule in _DEFAULT_RULES], None
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            raise ValueError("rules must be a JSON array")
        return parsed, None
    except (json.JSONDecodeError, ValueError) as exc:
        return [dict(rule) for rule in _DEFAULT_RULES], str(exc)


def _normalize_rel(raw: str) -> str:
    return str(raw or "").strip().replace("\\", "/").lstrip("/")


def _should_skip(rel: str) -> bool:
    normalized = _normalize_rel(rel)
    if not normalized:
        return True
    parts = normalized.split("/")
    if any(part.startswith(".") for part in parts):
        return True
    if ".." in parts:
        return True
    normalized_slash = normalized.rstrip("/") + "/"
    if any(normalized_slash.startswith(prefix) for prefix in _SORTED_PREFIXES):
        return True
    return any(normalized_slash.startswith(prefix) for prefix in _PROTECTED_PREFIXES)


def _ext_of(rel: str) -> str:
    return Path(rel).suffix.lower().lstrip(".")


def _dest_for(rel: str, rules: list[dict[str, Any]]) -> str | None:
    ext = _ext_of(rel)
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        match = rule.get("match")
        if not isinstance(match, dict):
            continue
        exts = match.get("ext")
        if not isinstance(exts, list):
            continue
        normalized_exts = {str(item).lower().lstrip(".") for item in exts}
        if ext in normalized_exts:
            dest = str(rule.get("dest") or "").strip().strip("/")
            if dest:
                return dest
    return None


def _unique_dest(root: Path, dest_dir: str, filename: str, run_id: str) -> Path:
    target = root / dest_dir / filename
    if not target.exists():
        return target
    stem = Path(filename).stem
    suffix = Path(filename).suffix
    short = (run_id or "")[:8] or "run"
    candidate = root / dest_dir / f"{stem}_{short}{suffix}"
    if not candidate.exists():
        return candidate
    idx = 2
    while True:
        candidate = root / dest_dir / f"{stem}_{short}_{idx}{suffix}"
        if not candidate.exists():
            return candidate
        idx += 1


def sort_artifacts(
    root: Path,
    artifacts: list[dict[str, Any]],
    *,
    new_paths: set[str],
    run_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, str]], str | None]:
    """Move new artifacts per rules; return updated manifest, move log, parse warning."""
    rules, parse_warning = _load_rules()
    moved: list[dict[str, str]] = []
    path_map: dict[str, str] = {}

    for rel in sorted(new_paths):
        normalized = _normalize_rel(rel)
        if _should_skip(normalized):
            continue
        dest_dir = _dest_for(normalized, rules)
        if not dest_dir:
            continue
        src = (root / normalized).resolve()
        try:
            src.relative_to(root.resolve())
        except ValueError:
            continue
        if not src.is_file():
            continue
        filename = Path(normalized).name
        dst = _unique_dest(root, dest_dir, filename, run_id)
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
        except OSError:
            continue
        new_rel = dst.relative_to(root).as_posix()
        path_map[normalized] = new_rel
        moved.append({"from": normalized, "to": new_rel})

    if not path_map:
        return artifacts, moved, parse_warning

    updated: list[dict[str, Any]] = []
    for item in artifacts:
        if not isinstance(item, dict):
            updated.append(item)
            continue
        path = _normalize_rel(str(item.get("path") or ""))
        if path not in path_map:
            updated.append(item)
            continue
        dst = root / path_map[path]
        new_item = dict(item)
        new_item["path"] = path_map[path]
        new_item["original_path"] = path
        try:
            data = dst.read_bytes()
            new_item["bytes"] = len(data)
            new_item["sha256"] = hashlib.sha256(data).hexdigest()
        except OSError:
            pass
        updated.append(new_item)
    return updated, moved, parse_warning
