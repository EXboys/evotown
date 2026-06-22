"""System MCP: skill_creator — create a new skill in the workspace.

Agent calls:
    mcp_call("system-skill_creator", {"category": "shop", "name": "订单查询"})

Flow:
    1. Generate skill_id = sk_{uuid12}
    2. INSERT skills (status=draft)
    3. Create workspace skeleton: skills/sk_xxx/{SKILL.md, scripts/, references/}
    4. Record usage log
    5. Return skill_id + path
"""

from __future__ import annotations

import uuid
from typing import Any

SKILL_MD_TEMPLATE = """---
skill_id: {skill_id}
name: ""
description: ""
category: {category}
version: 0.1.0
requires_mcp: []
requires_skills: []
requires_knowledge: []
---
"""


def process(args: dict, permissions: dict) -> dict[str, Any]:
    """Handle skill_creator request.

    args: {"category": str, "name": str}
    permissions: agent/account context injected by gateway
    """
    category = (args.get("category", "") or "").strip()
    name = (args.get("name", "") or "").strip()

    if not name:
        return {"ok": False, "data": None, "error": "name 不能为空"}

    # ── Generate unique skill_id ────────────────────────────────────
    skill_id = f"sk_{uuid.uuid4().hex[:12]}"

    # ── Lazy imports to avoid startup circularity ──────────────────
    from infra.skill_market import create_draft_skill, record_skill_usage
    from infra.agents import get_agent, resolve_agent_path

    agent_id = permissions.get("agent_id", "")
    account = permissions.get("account", "")

    # ── Insert skill record ────────────────────────────────────────
    create_draft_skill(
        skill_id=skill_id,
        name=name,
        category=category,
        agent_id=agent_id,
        created_by=account,
    )

    # ── Create workspace skeleton ──────────────────────────────────
    agent = get_agent(agent_id)
    if agent is None:
        return {"ok": False, "data": None, "error": f"agent 不存在: {agent_id}"}
    ws_root = resolve_agent_path(agent)
    skill_dir = ws_root / "skills" / skill_id
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "scripts").mkdir(parents=True, exist_ok=True)
    (skill_dir / "references").mkdir(parents=True, exist_ok=True)

    # Write SKILL.md template
    (skill_dir / "SKILL.md").write_text(
        SKILL_MD_TEMPLATE.format(skill_id=skill_id, category=category),
        encoding="utf-8",
    )
    # Placeholder files
    (skill_dir / "scripts" / ".gitkeep").write_text("", encoding="utf-8")
    (skill_dir / "references" / ".gitkeep").write_text("", encoding="utf-8")

    # ── Record usage log ───────────────────────────────────────────
    record_skill_usage(
        skill_id=skill_id,
        agent_id=agent_id,
        account=account,
        event="create",
        details={"name": name, "category": category},
    )

    return {
        "ok": True,
        "data": {
            "skill_id": skill_id,
            "name": name,
            "category": category or "",
            "path": f"skills/{skill_id}/",
            "message": f"技能 '{name}' 已创建",
        },
    }
