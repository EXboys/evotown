"""System MCP: internal_skill_deploy — submit skill for review.

Agent calls:
    mcp_call("system-internal_skill_deploy", {"action": "submit", "skill_id": "sk_xxx"})
    mcp_call("system-internal_skill_deploy", {"action": "status", "skill_id": "sk_xxx"})

Flow (submit):
    1. Check skill exists
    2. Check no pending version (mutual exclusion)
    3. Read workspace SKILL.md → parse frontmatter
    4. Validate required fields
    5. INSERT skill_versions (status=pending)
    6. Record usage log

Flow (status):
    1. Query latest skill_version → return status + review_comment
"""

from __future__ import annotations

import json
import re
from typing import Any


def _parse_frontmatter(text: str) -> dict[str, Any]:
    """Parse YAML-like frontmatter between --- delimiters."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}

    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return {}

    result: dict[str, Any] = {}
    for line in lines[1:end]:
        m = re.match(r"^(\w[\w_]*)\s*:\s*(.*)", line)
        if not m:
            continue
        key = m.group(1)
        val = m.group(2).strip()

        # Try JSON for arrays/objects
        if val.startswith("[") or val.startswith("{"):
            try:
                result[key] = json.loads(val)
                continue
            except json.JSONDecodeError:
                pass
        # Strip quotes
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            val = val[1:-1]
        result[key] = val

    return result


MAX_DEPTH = 10


def _check_circular_deps(
    skill_id: str,
    requires_skills: list,
    get_skill_fn,
    *,
    _depth: int = 0,
    _visited: set | None = None,
) -> str:
    """Check for circular skill dependencies. Returns error string or empty string."""
    if _visited is None:
        _visited = set()
    if _depth > MAX_DEPTH:
        return f"依赖链深度超过 {MAX_DEPTH} 层，可能存在循环"
    for dep_id in requires_skills:
        dep_id = (dep_id or "").strip()
        if not dep_id:
            continue
        if dep_id == skill_id:
            return f"检测到自依赖: {skill_id} → {skill_id}"
        if dep_id in _visited:
            return f"检测到循环依赖: {' → '.join(sorted(_visited))} → {dep_id}"
        dep_skill = get_skill_fn(dep_id)
        if dep_skill is None:
            continue  # skip unknown skills (never submitted)
        dep_reqs_raw = dep_skill.get("requires_skills", "[]")
        if isinstance(dep_reqs_raw, str):
            try:
                dep_reqs = json.loads(dep_reqs_raw)
            except json.JSONDecodeError:
                dep_reqs = []
        else:
            dep_reqs = dep_reqs_raw
        if isinstance(dep_reqs, list) and dep_reqs:
            sub_visited = _visited | {dep_id}
            err = _check_circular_deps(
                skill_id, dep_reqs, get_skill_fn,
                _depth=_depth + 1, _visited=sub_visited,
            )
            if err:
                return err
    return ""


def process(args: dict, permissions: dict) -> dict[str, Any]:
    """Handle internal_skill_deploy request.

    args: {"action": "submit"|"status", "skill_id": str}
    permissions: agent/account context injected by gateway
    """
    action = (args.get("action", "") or "").strip()
    skill_id = (args.get("skill_id", "") or "").strip()

    if not skill_id:
        return {"ok": False, "data": None, "error": "skill_id 不能为空"}

    # ── Lazy imports ────────────────────────────────────────────────
    from infra.skill_market import (
        create_draft_skill,
        get_skill,
        get_latest_skill_version,
        record_skill_usage,
        submit_skill_version,
    )
    from infra.agents import get_agent, resolve_agent_path

    agent_id = permissions.get("agent_id", "")
    account = permissions.get("account", "")

    if action == "status":
        ver = get_latest_skill_version(skill_id)
        if ver is None:
            return {"ok": True, "data": {"status": "draft", "version": "", "review_comment": ""}}
        return {
            "ok": True,
            "data": {
                "status": ver.get("status", ""),
                "version": ver.get("version", ""),
                "review_comment": ver.get("review_comment", ""),
            },
        }

    if action != "submit":
        return {"ok": False, "data": None, "error": f"unknown action: {action}"}

    # ── submit ──────────────────────────────────────────────────────

    # Check skill exists
    skill = get_skill(skill_id)
    if skill is None:
        return {"ok": False, "data": None, "error": f"技能不存在: {skill_id}"}

    # Mutual exclusion: check for pending version
    latest = get_latest_skill_version(skill_id)
    if latest and latest.get("status") == "pending":
        return {
            "ok": False,
            "data": None,
            "error": f"版本 {latest.get('version', '?')} 正在审核中，请等待审核完成后再提交",
        }

    # Read SKILL.md from workspace
    agent = get_agent(agent_id)
    if agent is None:
        return {"ok": False, "data": None, "error": f"agent 不存在: {agent_id}"}
    ws_root = resolve_agent_path(agent)
    skill_md_path = ws_root / "skills" / skill_id / "SKILL.md"

    if not skill_md_path.is_file():
        return {"ok": False, "data": None, "error": f"SKILL.md 不存在: {skill_md_path}"}

    raw = skill_md_path.read_text(encoding="utf-8")
    fm = _parse_frontmatter(raw)

    # ── Validate ────────────────────────────────────────────────────
    errors: list[str] = []
    name = (fm.get("name") or "").strip()
    description = (fm.get("description") or "").strip()
    version = (fm.get("version") or "0.1.0").strip()

    if not name:
        errors.append("name 不能为空")
    if not description:
        errors.append("description 不能为空")

    requires_mcp = fm.get("requires_mcp")
    if requires_mcp is not None and not isinstance(requires_mcp, list):
        errors.append("requires_mcp 必须是数组")

    requires_skills = fm.get("requires_skills")
    if requires_skills is not None and not isinstance(requires_skills, list):
        errors.append("requires_skills 必须是数组")

    requires_knowledge = fm.get("requires_knowledge")
    if requires_knowledge is not None and not isinstance(requires_knowledge, list):
        errors.append("requires_knowledge 必须是数组")

    if errors:
        return {"ok": False, "data": None, "error": "; ".join(errors)}

    # ── Circular dependency check ────────────────────────────────────
    if requires_skills:
        from infra.skill_market import get_latest_skill_version as _get_version
        dep_errors = _check_circular_deps(skill_id, requires_skills, _get_version)
        if dep_errors:
            return {"ok": False, "data": None, "error": dep_errors}

    # ── Submit version ──────────────────────────────────────────────
    ver_record = submit_skill_version(
        skill_id=skill_id,
        version=version,
        description=description,
        requires_skills=json.dumps(requires_skills or [], ensure_ascii=False),
        submitted_by_agent_id=agent_id,
        submitted_by_account=account,
    )

    # ── Record usage log ────────────────────────────────────────────
    record_skill_usage(
        skill_id=skill_id,
        agent_id=agent_id,
        account=account,
        event="submit",
        details={"version": version, "name": name},
    )

    return {
        "ok": True,
        "data": {
            "skill_id": skill_id,
            "version": version,
            "name": name,
            "message": f"技能 '{name}' 版本 {version} 已提交审核",
        },
    }
