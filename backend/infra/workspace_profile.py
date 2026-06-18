"""Persistent agent profile for hosted coding workspaces."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from infra import workspaces
from services.runtime_engine import DEFAULT_RUNTIME_ENGINE, normalize_runtime_engine

PROFILE_RELATIVE = ".evotown/profile.json"
PROFILE_MD_RELATIVE = ".evotown/AGENT_PROFILE.md"

PROFILE_TEXT_MAX = 8_000
AGENT_TYPE_MAX = 64

DEFAULT_PROFILE: dict[str, Any] = {
    "agent_type": "",
    "runtime_engine": DEFAULT_RUNTIME_ENGINE,
    "soul": "",
    "paradigm": "",
    "standards": "",
    "default_model": "",
    "default_skills": [],
    "default_mcp": [],
}


def _profile_path(workspace: dict[str, Any]):
    return workspaces.resolve_workspace_path(workspace, PROFILE_RELATIVE)


def get_profile(workspace: dict[str, Any]) -> dict[str, Any]:
    path = _profile_path(workspace)
    if not path.is_file():
        return {**DEFAULT_PROFILE, "updated_at": None}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {**DEFAULT_PROFILE, "updated_at": None}
    if not isinstance(raw, dict):
        return {**DEFAULT_PROFILE, "updated_at": None}
    merged = {**DEFAULT_PROFILE, **raw}
    merged["runtime_engine"] = normalize_runtime_engine(merged.get("runtime_engine"))
    merged["default_skills"] = _normalize_id_list(merged.get("default_skills"))
    merged["default_mcp"] = _normalize_id_list(merged.get("default_mcp"))
    return merged


def _normalize_id_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


def _validate_text_field(name: str, value: str, *, max_chars: int) -> str:
    text = str(value or "").strip()
    if len(text) > max_chars:
        raise ValueError(f"{name} exceeds {max_chars} character limit (got {len(text)})")
    return text


def save_profile(workspace: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    current = get_profile(workspace)
    profile = {
        "agent_type": _validate_text_field(
            "agent_type",
            payload.get("agent_type", current.get("agent_type", "")),
            max_chars=AGENT_TYPE_MAX,
        ),
        "runtime_engine": normalize_runtime_engine(
            payload.get("runtime_engine", current.get("runtime_engine", DEFAULT_RUNTIME_ENGINE)),
        ),
        "soul": _validate_text_field(
            "soul",
            payload.get("soul", current.get("soul", "")),
            max_chars=PROFILE_TEXT_MAX,
        ),
        "paradigm": _validate_text_field(
            "paradigm",
            payload.get("paradigm", current.get("paradigm", "")),
            max_chars=PROFILE_TEXT_MAX,
        ),
        "standards": _validate_text_field(
            "standards",
            payload.get("standards", current.get("standards", "")),
            max_chars=PROFILE_TEXT_MAX,
        ),
        "default_model": _validate_text_field(
            "default_model",
            payload.get("default_model", current.get("default_model", "")),
            max_chars=128,
        ),
        "default_skills": _normalize_id_list(payload.get("default_skills", current.get("default_skills"))),
        "default_mcp": _normalize_id_list(payload.get("default_mcp", current.get("default_mcp"))),
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }

    path = _profile_path(workspace)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _write_profile_md(workspace, profile)
    return profile


def _write_profile_md(workspace: dict[str, Any], profile: dict[str, Any]) -> None:
    lines = ["# Agent Profile", ""]
    if profile.get("agent_type"):
        lines.extend([f"**Type:** `{profile['agent_type']}`", ""])
    runtime_engine = str(profile.get("runtime_engine") or "").strip()
    if runtime_engine:
        lines.extend([f"**Runtime:** `{runtime_engine}`", ""])
    if profile.get("soul"):
        lines.extend(["## Identity (SOUL)", "", str(profile["soul"]), ""])
    if profile.get("paradigm"):
        lines.extend(["## Work Paradigm", "", str(profile["paradigm"]), ""])
    if profile.get("standards"):
        lines.extend(["## Standards", "", str(profile["standards"]), ""])
    defaults: list[str] = []
    if runtime_engine:
        defaults.append(f"- Runtime engine: `{runtime_engine}`")
    if profile.get("default_model"):
        defaults.append(f"- Default model: `{profile['default_model']}`")
    if profile.get("default_skills"):
        defaults.append(f"- Default skills: {', '.join(f'`{s}`' for s in profile['default_skills'])}")
    if profile.get("default_mcp"):
        defaults.append(f"- Default MCP: {', '.join(f'`{m}`' for m in profile['default_mcp'])}")
    if defaults:
        lines.extend(["## Run Defaults", "", *defaults, ""])
    content = "\n".join(lines).strip() + "\n"
    md_path = workspaces.resolve_workspace_path(workspace, PROFILE_MD_RELATIVE)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(content, encoding="utf-8")


def profile_context_sections(profile: dict[str, Any]) -> list[str]:
    """Markdown sections to append to AGENT_CONTEXT.md."""
    sections: list[str] = []
    agent_type = str(profile.get("agent_type") or "").strip()
    runtime_engine = str(profile.get("runtime_engine") or "").strip()
    soul = str(profile.get("soul") or "").strip()
    paradigm = str(profile.get("paradigm") or "").strip()
    standards = str(profile.get("standards") or "").strip()
    if not any([agent_type, runtime_engine, soul, paradigm, standards]):
        return sections

    sections.extend(["## Agent Profile", ""])
    if agent_type:
        sections.append(f"- **Type:** `{agent_type}`")
    if runtime_engine:
        sections.append(f"- **Runtime engine:** `{runtime_engine}`")
    if soul or paradigm or standards:
        sections.append("- Persistent profile from console settings (`.evotown/profile.json`)")
    sections.append("")
    if soul:
        sections.extend(["### Identity (SOUL)", "", soul, ""])
    if paradigm:
        sections.extend(["### Work Paradigm", "", paradigm, ""])
    if standards:
        sections.extend(["### Standards", "", standards, ""])
    return sections
