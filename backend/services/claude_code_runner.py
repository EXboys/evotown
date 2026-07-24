"""Centrally hosted Claude Code runner orchestration.

The runner keeps the control-plane contract stable even when the actual Claude
Code SDK/CLI command is supplied later by deployment config.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import zipfile
from pathlib import Path
from typing import Any

from infra import claude_agent_runs, knowledge, skill_market, agents

from services.agent_runner_base import AgentRunContext

DEFAULT_MODEL = "claude-sonnet-4"
DEFAULT_ENGINE_ID = "claude-code-hosted"
DEFAULT_RUN_TIMEOUT_SEC = 600
DEFAULT_MAX_TURNS = 100

# DEFAULT_RUN_TIMEOUT_SEC is synced from system.db → env on startup.
# For module-level access, read os.environ (no inline fallback).

FALLBACK_MODELS: list[dict[str, str]] = [
    {"id": "claude-sonnet-4", "label": "Claude Sonnet 4", "provider": "Anthropic"},
    {"id": "claude-opus-4", "label": "Claude Opus 4", "provider": "Anthropic"},
    {"id": "claude-haiku-4", "label": "Claude Haiku 4", "provider": "Anthropic"},
]


def list_available_models(*, policy: str = "all") -> list[dict[str, Any]]:
    """Gateway route aliases + upstream models, same catalog as Coding Agent workbench.

    policy='routes_only' returns only gateway route aliases; 'all' returns both.
    """
    models: list[dict[str, Any]] = []
    seen: set[str] = set()
    try:
        from infra import gateway_models, gateway_routes

        for route in gateway_routes.list_routes(enabled_only=True):
            alias = str(route.get("alias") or "").strip()
            if alias and alias not in seen:
                seen.add(alias)
                models.append(
                    {
                        "id": alias,
                        "label": alias,
                        "provider": "Evotown Route",
                        "target": route.get("target_model", ""),
                    }
                )
        if policy != "routes_only":
            for entry in gateway_models.list_models(enabled_only=True):
                name = str(entry.get("model_name") or "").strip()
                if name and name not in seen:
                    seen.add(name)
                    models.append(
                        {
                            "id": name,
                            "label": name,
                            "provider": entry.get("provider_label") or "Upstream",
                            "target": entry.get("litellm_model", ""),
                        }
                    )
    except Exception:
        models = []
    if not models:
        models = [dict(item) for item in FALLBACK_MODELS]
    return models


def default_model_id(*, policy: str = "all") -> str:
    """Default hosted-agent model: Gateway catalog first, then env, then hardcoded fallback."""
    models = list_available_models(policy=policy)
    if models:
        first = str(models[0].get("id") or "").strip()
        if first:
            return first
    env_model = os.environ.get("EVOTOWN_CLAUDE_MODEL", "").strip()
    if env_model:
        return env_model
    return DEFAULT_MODEL


def count_route_aliases() -> int:
    """Return the number of enabled gateway route aliases."""
    try:
        from infra import gateway_routes
        return sum(1 for _ in gateway_routes.list_routes(enabled_only=True))
    except Exception:
        return 0


def resolve_run_model(explicit: str | None = None) -> str:
    chosen = (explicit or "").strip()
    if chosen:
        return chosen
    return default_model_id()

_RUN_TASKS: dict[str, asyncio.Task] = {}


def run_timeout_sec() -> int:
    raw = os.environ.get("EVOTOWN_CLAUDE_RUN_TIMEOUT_SEC", str(DEFAULT_RUN_TIMEOUT_SEC)).strip()
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_RUN_TIMEOUT_SEC
    return max(0, value)


def max_turns() -> int:
    raw = os.environ.get("EVOTOWN_CLAUDE_MAX_TURNS", str(DEFAULT_MAX_TURNS)).strip()
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_MAX_TURNS
    return max(1, value)


def get_run_task(run_id: str) -> asyncio.Task | None:
    return _RUN_TASKS.get(run_id)


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def _arena_skills_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "arena_skills"


def _skill_manifest(agent_id: str = "") -> dict[str, Any]:
    """Build a skill manifest for one agent based on assigned skills."""
    from infra import agent_skills as agt_skills

    if agent_id.strip():
        assigned = agt_skills.list_for_agent_with_deps(agent_id.strip())
        skills: list[dict[str, Any]] = []
        for sid in assigned:
            entry = skill_market.get_market_skill(sid)
            if entry:
                skills.append(entry)
        return {
            "bundle_id": f"agent-{agent_id[:8]}",
            "version": "1.0.0",
            "channel": "assigned",
            "runtime_targets": ["custom"],
            "skills": skills,
            "selection_mode": "assigned",
            "signature": "",
            "published_at": "",
        }

    # Fallback: empty manifest when no account context
    return {
        "bundle_id": "default-agent-skills",
        "version": "0.0.0",
        "channel": "stable",
        "runtime_targets": ["custom"],
        "skills": [],
        "signature": "",
        "published_at": "",
    }


def _filter_skill_manifest(manifest: dict[str, Any], selected_skills: list[str]) -> dict[str, Any]:
    if not selected_skills:
        return {**manifest, "selection_mode": "bundle_all"}
    wanted = {item.strip() for item in selected_skills if item.strip()}
    skills = [
        entry
        for entry in manifest.get("skills", [])
        if isinstance(entry, dict) and str(entry.get("skill_id") or "") in wanted
    ]
    return {
        **manifest,
        "selection_mode": "explicit",
        "selected_skill_ids": sorted(wanted),
        "skills": skills,
    }


def _knowledge_hits(prompt: str, *, team_id: str = "", limit: int = 5) -> list[dict[str, Any]]:
    query = " ".join(prompt.split())[:240]
    if not query:
        return []
    try:
        return knowledge.search_documents(query=query, team_id=team_id or None, limit=limit)
    except Exception:
        return []


def _runner_identity(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "account_id": str(run.get("account_id") or ""),
        "team_id": str(run.get("team_id") or ""),
        "tenant_id": str(run.get("tenant_id") or ""),
    }


def _resolve_mcp_context(agent_id: str, *, run_id: str = "") -> dict[str, Any]:
    """Resolve MCP connections and tools from workspace policies (auto-inject).

    Returns both legacy database connections AND generic MCP tools for all
    service types.  Database connections still use the legacy format for
    backward compatibility; non-database MCP services are exposed as Tool Use
    definitions in AGENT_CONTEXT.md so the Agent knows how to call them.
    """
    from infra import mcp_registry

    policies = mcp_registry.list_policies_for_agent(agent_id)
    if not policies:
        return {"selection_mode": "none", "connections": [], "tools": [], "tool_skill": "database-query"}

    connections: list[dict[str, Any]] = []
    tools: list[dict[str, Any]] = []
    seen_tool_ids: set[str] = set()

    for policy in policies:
        sid = policy["service_id"]
        svc = mcp_registry.get_service(sid) or {}

        # Connection info (legacy format kept for backward compat)
        svc_type = str(svc.get("service_type") or "")
        usage_hint = (
            f'POST /api/v1/mcp/{sid} with args (see Available MCP Tools below)'
            if svc_type in ("api", "system", "")
            else (
                "Query via Evotown `database-query` skill: "
                f'{{"action":"query","connection_id":"{sid}","sql":"SELECT ..."}}'
            )
        )
        connections.append(
            {
                "connection_id": sid,
                "name": policy.get("name", sid),
                "mcp_server_url": policy.get("endpoint_url", ""),
                "permission": "read",
                "usage": usage_hint,
            }
        )

        # Generic MCP tool for ALL services
        if sid not in seen_tool_ids:
            seen_tool_ids.add(sid)
            tool_name = sid.replace("-", "_")

            # Use structured input_schema from mcp_services, else generic fallback
            try:
                input_schema = json.loads(str(svc.get("input_schema") or "{}"))
            except (json.JSONDecodeError, TypeError):
                input_schema = {}
            if not input_schema:
                input_schema = {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "description": "Action to perform"},
                        "args": {"type": "object", "description": f"Action-specific arguments for {sid}"},
                    },
                }

            call_url = f"/api/v1/mcp/{sid}"
            if run_id:
                call_url += f"?run_id={run_id}"
            tools.append({
                "name": tool_name,
                "description": svc.get("description") or svc.get("name", sid),
                "call_endpoint": call_url,
                "input_schema": input_schema,
            })

    proxy_url = os.environ.get("EVOTOWN_DB_MCP_URL", "").strip()
    return {
        "selection_mode": "auto",
        "connections": connections,
        "tools": tools,
        "tool_skill": "database-query",
        "mcp_proxy_url": proxy_url,
        "http_api": {
            "catalog": "/catalog",
            "query": "/query",
            "auth": "Bearer evk_… employee API key",
        },
    }


def _materialize_skill(workspace: dict[str, Any], skill_id: str) -> str | None:
    skill_id = skill_id.strip()
    if not skill_id:
        return None
    dest = agents.resolve_agent_path(workspace, f".evotown/skills/{skill_id}")
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    arena_src = _arena_skills_dir() / skill_id
    if arena_src.is_dir() and (arena_src / "SKILL.md").is_file():
        shutil.copytree(arena_src, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        return f".evotown/skills/{skill_id}"

    package = skill_market.resolve_download_package(skill_id)
    if package is not None:
        zip_path, _filename = package
        dest.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest)
        return f".evotown/skills/{skill_id}"
    return None


def _materialize_skills(workspace: dict[str, Any], skill_ids: list[str]) -> list[str]:
    paths: list[str] = []
    for skill_id in skill_ids:
        local = _materialize_skill(workspace, skill_id)
        if local:
            paths.append(local)
    return paths


def _get_conversation_history(previous_run_id: str, *, max_rounds: int = 20) -> list[dict[str, Any]]:
    """Walk the previous_run_id chain backwards to collect full conversation history."""
    history: list[dict[str, Any]] = []
    current_id = previous_run_id.strip()
    seen: set[str] = set()
    while current_id and len(history) < max_rounds:
        if current_id in seen:
            break
        seen.add(current_id)
        prev = claude_agent_runs.get_run(current_id)
        if prev is None or prev.get("status") != "succeeded":
            break
        history.append(prev)
        signals = prev.get("signals") or {}
        current_id = str(signals.get("previous_run_id") or "").strip()
    history.reverse()
    return history


def _build_conversation_prompt(current_prompt: str, history: list[dict[str, Any]]) -> str:
    """Build a prompt that includes full conversation history."""
    if not history:
        return current_prompt
    lines = ["[以下是之前的对话历史，请基于此上下文回复用户的新消息]"]
    for i, h in enumerate(history, 1):
        lines.append(f"第{i}轮:")
        lines.append(f"  用户: {h.get('prompt', '')}")
        attachment_note = _attachment_prompt_suffix(h.get("signals") or {})
        if attachment_note:
            lines.append(f"  {attachment_note}")
        result = str(h.get("result_summary") or h.get("log_excerpt") or "")
        lines.append(f"  助手: {result}")
    lines.append(f"---")
    lines.append(f"用户的新消息: {current_prompt}")
    return "\n".join(lines)


def _attachment_prompt_suffix(signals: dict[str, Any]) -> str:
    paths = [str(p).strip() for p in (signals.get("attachments") or []) if str(p).strip()]
    parts: list[str] = []
    if paths:
        parts.append(f"用户附件: {', '.join(f'`{path}`' for path in paths)}")
    vision = str(signals.get("vision_analysis") or "").strip()
    if vision:
        excerpt = vision if len(vision) <= 400 else vision[:400] + "…"
        parts.append(f"视觉分析: {excerpt}")
    return " · ".join(parts)


def _append_attachments_to_prompt(prompt: str, workspace: dict[str, Any], attachment_paths: list[str]) -> str:
    if not attachment_paths:
        return prompt
    lines = [
        prompt,
        "",
        "[用户在本轮消息中上传了以下文件，已保存在 workspace 中，请按需读取并使用相对路径访问]",
    ]
    for rel in attachment_paths:
        try:
            target = agents.resolve_agent_path(workspace, rel)
            size = target.stat().st_size if target.is_file() else 0
        except (OSError, ValueError):
            size = 0
        lines.append(f"- `{rel}` ({size} bytes)")
    return "\n".join(lines)


def _append_vision_to_prompt(prompt: str, vision_text: str, image_paths: list[str]) -> str:
    if not vision_text.strip():
        return prompt
    paths = ", ".join(f"`{path}`" for path in image_paths)
    return "\n".join(
        [
            prompt,
            "",
            f"[系统视觉分析 — 已通过视觉模型理解图片附件 {paths}]",
            vision_text.strip(),
            "",
            "请基于以上视觉分析回答用户；不要声称你看不到图片。若需进一步操作文件，仍可使用 workspace 相对路径。",
        ]
    )


def _result_summary_from_output(output: str, *, vision_text: str = "") -> str:
    text = output.strip()
    vision = vision_text.strip()
    if vision and len(text) < 120:
        return vision[:8000]
    if not text:
        return vision or "Claude Code runner completed."
    blocks = [block.strip() for block in text.split("\n\n") if block.strip()]
    if len(blocks) >= 2 and len(blocks[-1]) < 100 and ("?" in blocks[-1] or "？" in blocks[-1]):
        body = "\n\n".join(blocks[:-1])
        if len(body) > 200:
            return body[:8000]
    return text[:8000]


def _write_conversation_context(
    workspace: dict[str, Any],
    previous_run_id: str,
) -> dict[str, Any] | None:
    """Fetch previous run's prompt+result and write conversation context to workspace."""
    if not previous_run_id.strip():
        return None
    prev = claude_agent_runs.get_run(previous_run_id.strip())
    if prev is None:
        return None
    prev_prompt = str(prev.get("prompt") or "")
    prev_result = str(prev.get("result_summary") or prev.get("log_excerpt") or "")
    if not prev_prompt and not prev_result:
        return None

    lines = [
        "# Conversation Continuation",
        "",
        "You are continuing a conversation. Use the context below to maintain continuity.",
        "",
        f"## Previous message (run `{prev['run_id']}`)",
        "",
        prev_prompt,
    ]
    if prev_result.strip():
        lines.extend(["", "## Your previous response", "", prev_result])
    content = "\n".join(lines)

    root = agents.resolve_agent_path(workspace)
    evotown_dir = root / ".evotown"
    evotown_dir.mkdir(parents=True, exist_ok=True)
    path = evotown_dir / "conversation_context.md"
    path.write_text(content, encoding="utf-8")
    return prev


def _render_agent_context_md(
    *,
    workspace: dict[str, Any],
    run: dict[str, Any],
    shared_context: dict[str, Any],
    materialized_skills: list[str],
    workspace_root: str = "",
    profile: dict[str, Any] | None = None,
) -> str:
    skills_block = shared_context.get("skills", {})
    mcp_block = shared_context.get("mcp", {})
    root_path = workspace_root or str(agents.resolve_agent_path(workspace))
    from infra import workspace_profile

    profile_sections = workspace_profile.profile_context_sections(profile or {})
    lines: list[str] = []

    # Identity FIRST — strongest position to override Claude Code defaults
    if profile and profile.get("soul"):
        lines.extend([
            "## ⚠️ YOUR IDENTITY — READ THIS FIRST",
            "",
            f"You are NOT a generic Claude Code assistant. You are: {profile.get('agent_type', '')}",
            "",
            profile["soul"],
            "",
        ])
    if profile_sections:
        lines.extend(profile_sections)

    # Technical context
    lines.extend([
        "# Evotown Hosted Claude Context",
        "",
        f"Run ID: `{run['run_id']}`",
        f"Workspace ID: `{workspace['agent_id']}`",
        f"Model: `{run.get('model') or DEFAULT_MODEL}`",
        "",
        f"Workspace Root: `{root_path}`",
        "ALL file read/write/edit/bash operations MUST use paths relative to",
        "the workspace root above. Never use absolute paths like /data/workspace/.",
        "",
    ])
    if materialized_skills:
        from infra import skill_market as _sm
        lines.extend([
            "## WARNING: MANDATORY SKILLS",
            "",
            "You MUST use the following skills for this task. Read each skill's",
            "SKILL.md under the listed path, then execute them in order.",
            "Do NOT skip any required skill.",
            "",
        ])
        skill_entries = skills_block.get("skills") or []
        for i, entry in enumerate(skill_entries[:30], 1):
            if isinstance(entry, dict):
                sid = entry.get("skill_id", "")
                name = entry.get("name", sid)
                summary = entry.get("summary") or entry.get("description") or ""
                lines.append(f"REQUIRED ({i}/{len(skill_entries)}): {name} ({sid})")
                lines.append(f"  Path: .evotown/skills/{sid}/")
                if summary:
                    lines.append(f"  Description: {summary[:300]}")
                deps = entry.get("dependencies") or []
                if deps:
                    lines.append(f"  Depends on skills: {', '.join(deps)}")
                ver = _sm.get_latest_skill_version(sid)
                if ver:
                    mcp_deps = ver.get("requires_mcp") or []
                    if isinstance(mcp_deps, list) and mcp_deps:
                        lines.append(f"  Requires MCP tools: {', '.join(mcp_deps)}")
                    skill_deps = ver.get("requires_skills") or []
                    if isinstance(skill_deps, list) and skill_deps:
                        lines.append(f"  Requires skills (use together): {', '.join(skill_deps)}")
                lines.append("")
    else:
        lines.extend([
            "## Available Skills",
            "",
        ])
        skill_entries = skills_block.get("skills") or []
        if skill_entries:
            for entry in skill_entries[:30]:
                if isinstance(entry, dict):
                    sid = entry.get("skill_id", "")
                    name = entry.get("name", sid)
                    summary = entry.get("summary") or entry.get("description") or ""
                    lines.append(f"- **{sid}** — {name}")
                    if summary:
                        lines.append(f"  {summary}")
        else:
            lines.append("- (no skills assigned)")
        lines.append("")

    lines.extend(
        [
            "",
            "## Knowledge",
            "",
            "Citations and search hits: `.evotown/knowledge_context.json`",
            "Tool endpoint: `/api/v1/knowledge/search?q=<query>`",
            "",
        ]
    )
    conversation_hint = (
        "This is a **continuation** of a previous conversation. "
        "Read `.evotown/conversation_context.md` for the prior exchange."
    )
    prev_run_id = str((run.get("signals") or {}).get("previous_run_id") or "").strip()
    if prev_run_id:
        lines.extend(
            [
                "## Conversation History",
                "",
                conversation_hint,
                "",
            ]
        )
    attachment_paths = [str(p).strip() for p in (run.get("signals") or {}).get("attachments") or [] if str(p).strip()]
    if attachment_paths:
        lines.extend(["## User Uploads", "", "The user attached these files for this run:", ""])
        for rel in attachment_paths:
            lines.append(f"- `{rel}`")
        lines.append("")
    # Check if bridge (.mcp.json) is configured
    _mcp_json = Path(root_path) / ".mcp.json"
    _has_bridge = False
    if _mcp_json.is_file():
        try:
            _mcp_cfg = json.loads(_mcp_json.read_text(encoding="utf-8"))
            _has_bridge = bool(_mcp_cfg.get("mcpServers"))
        except Exception:
            pass

    if _has_bridge:
        bridge_url = ""
        try:
            _mcp2 = json.loads((Path(root_path) / ".mcp.json").read_text(encoding="utf-8"))
            bridge_url = _mcp2.get("mcpServers", {}).get("mcp", {}).get("url", "")
        except Exception:
            pass
        lines.extend([
            "## MCP Tools",
            "",
            "- 你的 MCP 工具已通过 .mcp.json 注入，优先使用 tool_use 原生调用",
            f"- 若 tool_use 不可用，curl POST bridge URL 的 JSON-RPC：`tools/list` 或 `tools/call`",
            "- 鉴权已内置于 URL 中，无需额外携带 token",
            "- 不要 ls/read mcp-dev/ 或 mcp-services/ 目录 —— 权限由 bridge 控制",
        ])
        if bridge_url:
            # Show URL without token for safety (token already in URL, but hide from log)
            safe_url = bridge_url.split("&token=")[0] if "&token=" in bridge_url else bridge_url
            lines.append(f"- Bridge: `{safe_url}&token=...`")
        lines.append("")
    else:
        lines.extend(
            [
                "## MCP / Databases",
                "",
                f"- Selection: `{mcp_block.get('selection_mode', 'none')}`",
                "- Details: `.evotown/mcp_context.json`",
            ]
        )
        for conn in mcp_block.get("connections") or []:
            if not isinstance(conn, dict):
                continue
            lines.append(
                f"- `{conn.get('connection_id')}` ({conn.get('db_type')}) - "
                f"{conn.get('name')} . permission={conn.get('permission')}"
            )
            if conn.get("mcp_server_url"):
                lines.append(f"  - MCP proxy: {conn['mcp_server_url']}")
            lines.append(f"  - {conn.get('usage', '')}")
        tool_specs = mcp_block.get("tools") or []
        if mcp_block.get("mcp_proxy_url") and not tool_specs:
            lines.append(f"- Default MCP proxy base URL: `{mcp_block['mcp_proxy_url']}`")
        lines.append("")

        if tool_specs:
            lines.extend([
                "## Available MCP Tools",
                "",
                "The following MCP services are available to you as tools.",
                "Use your native tool_use mechanism to call them.",
                "The `input_schema` shows the required JSON body format.",
                "",
            ])
            for t in tool_specs:
                safe_name = t['name']
                lines.append(f"### {safe_name}")
                lines.append(f"- Description: {t['description']}")
                lines.append(f"- Endpoint: POST {t['call_endpoint']}")
                # Render input_schema as JSON
                input_schema = t.get('input_schema', {})
                if input_schema:
                    import json as _json_inline
                    schema_str = _json_inline.dumps(input_schema, ensure_ascii=False)
                    if len(schema_str) <= 500:
                        lines.append(f"- Input Schema: `{schema_str}`")
                    else:
                        lines.append(f"- Input Schema: `{schema_str[:500]}...`")
                lines.append("")
    lines.append("")

    return "\n".join(lines)


def build_shared_context(
    *,
    prompt: str,
    team_id: str = "",
    selected_skills: list[str] | None = None,
    agent_id: str = "",
    account_id: str = "",
    run_id: str = "",
) -> dict[str, Any]:
    hits = _knowledge_hits(prompt, team_id=team_id)
    skills = _filter_skill_manifest(_skill_manifest(agent_id), list(selected_skills or []))
    mcp = _resolve_mcp_context(agent_id, run_id=run_id)
    return {
        "skills": skills,
        "mcp": mcp,
        "knowledge": {
            "query": " ".join(prompt.split())[:240],
            "results": hits,
            "tool": {
                "name": "knowledge_search",
                "description": "Search Evotown public knowledge and cite returned chunks.",
                "endpoint": "/api/v1/knowledge/search?q=<query>",
            },
        },
    }


def _write_context_files(
    workspace: dict[str, Any],
    run: dict[str, Any],
    shared_context: dict[str, Any],
    *,
    materialized_skills: list[str],
) -> list[dict[str, Any]]:
    from infra import workspace_profile

    root = agents.resolve_agent_path(workspace)
    evotown_dir = root / ".evotown"
    evotown_dir.mkdir(parents=True, exist_ok=True)

    agent_md = _render_agent_context_md(
        workspace=workspace,
        run=run,
        shared_context=shared_context,
        materialized_skills=materialized_skills,
        workspace_root=str(root),
        profile=shared_context.get("workspace_profile"),
    )
    agent_id_val = str(workspace.get("agent_id") or "")
    _has_mcp = False
    if agent_id_val:
        try:
            from infra import mcp_registry as _mcp_reg
            _has_mcp = bool(_mcp_reg.list_policies_for_agent(agent_id_val))
        except Exception:
            pass

    mcp_context = shared_context.get("mcp", {})
    if _has_mcp:
        mcp_context = {"selection_mode": "bridge", "note": "MCP tools registered via .mcp.json, use tool_use or curl bridge"}
    files: list[tuple[str, str]] = [
        ("skills_manifest.json", _json_dumps(shared_context.get("skills", {}))),
        ("knowledge_context.json", _json_dumps(shared_context.get("knowledge", {}))),
        ("mcp_context.json", _json_dumps(mcp_context)),
        ("AGENT_CONTEXT.md", agent_md),
    ]

    manifest: list[dict[str, Any]] = []
    # Write CLAUDE.md only on first run — let SDK auto-memory manage it after that.
    # Overwriting it every run destroys any memory the SDK persisted.
    ccm_lines = [l for l in agent_md.split("\n") if "Run ID:" not in l and "Workspace ID:" not in l and "Model:" not in l and "TASK ID:" not in l]
    claude_md_path = root / "CLAUDE.md"
    if not claude_md_path.exists():
        claude_md_path.write_text("\n".join(ccm_lines), encoding="utf-8")

    for relative, content in files:
        path = agents.resolve_agent_path(workspace, f".evotown/{relative}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        manifest.append({"path": f".evotown/{relative}", "sha256": digest, "bytes": len(content.encode("utf-8"))})

    profile_md = agents.resolve_agent_path(workspace, workspace_profile.PROFILE_MD_RELATIVE)
    if profile_md.is_file():
        profile_bytes = profile_md.read_bytes()
        manifest.append(
            {
                "path": workspace_profile.PROFILE_MD_RELATIVE,
                "sha256": hashlib.sha256(profile_bytes).hexdigest(),
                "bytes": len(profile_bytes),
            }
        )

    # ── Generate .mcp.json (bridge for policy-bound agents, or explicit run connections) ──
    mcp_servers: dict[str, Any] = {}
    if _has_mcp:
        key = agents.get_agent_key(agent_id_val)
        run_id_val = str(run.get("run_id") or "")
        bridge_url = "http://localhost:8765/api/v1/mcp/bridge?agent_id=" + agent_id_val + "&token=" + key
        if run_id_val:
            bridge_url += "&run_id=" + run_id_val
        mcp_servers["mcp"] = {"type": "http", "url": bridge_url}
    else:
        for conn in (shared_context.get("mcp") or {}).get("connections") or []:
            if not isinstance(conn, dict):
                continue
            url = str(conn.get("mcp_server_url") or "").strip()
            if not url:
                continue
            key = str(conn.get("connection_id") or conn.get("name") or "database")
            mcp_servers[key] = {"type": "http", "url": url}
    if mcp_servers:
        mcp_content = _json_dumps({"mcpServers": mcp_servers})
        mcp_path = root / ".mcp.json"
        mcp_path.write_text(mcp_content, encoding="utf-8")
        digest = hashlib.sha256(mcp_content.encode("utf-8")).hexdigest()
        manifest.append({"path": ".mcp.json", "sha256": digest, "bytes": len(mcp_content.encode("utf-8"))})
    return manifest





async def _run_agent(
    *,
    workspace_root: Path,
    prompt: str,
    run: dict[str, Any],
    model: str,
    runtime_engine: str = "claude",
    context: AgentRunContext,
    on_message: Any = None,
) -> tuple[int, str, str, str]:
    from services.runtime_engine import normalize_runtime_engine

    engine = normalize_runtime_engine(runtime_engine)

    # ── Registry 路径（Claude SDK/CLI 已注册，codex / hermes 待注册） ──
    from services import agent_runner_registry as reg
    runner = reg.get(engine)
    if runner is not None and runner.is_available():
        backend = runner.resolve_backend()
        if backend != "dry-run":
            result = await runner.run(
                workspace_root=workspace_root,
                prompt=prompt,
                model=model,
                context=context,
                on_message=on_message,
            )
            # session_id 存入 run["signals"]，后续 update_run_status 时持久化
            if result.raw_output:
                signals = run.setdefault("signals", {})
                signals["claude_session_id"] = result.raw_output
            return result.exit_code, result.output, "", backend

    # ── 回退路径（仅 codex — 尚未实现 AgentRunner Protocol，待迁移到 registry） ──
    if engine == "codex":
        from services import codex_agent_sdk_runner
        backend = codex_agent_sdk_runner.execution_backend()
        if backend == "sdk":
            exit_code, output = await codex_agent_sdk_runner.run_agent_sdk(
                workspace_root=workspace_root,
                prompt=prompt,
                model=model,
                run=run,
            )
            return exit_code, output, "", backend
        summary = (
            "Dry-run completed (Codex). Install openai-codex (pip install openai-codex) and set "
            "OPENAI_API_KEY, or enable EVOTOWN_CODEX_USE_GATEWAY with EVOTOWN_CODEX_GATEWAY_API_KEY. "
            "Workspace context files were written under .evotown/."
        )
        return 0, summary, "", "dry-run"

    # ── 最终降级：engine 未注册（hermes / 未知） ──
    summary = "Dry-run completed. No agent runner available for this engine. Workspace context files were written under .evotown/."
    return 0, summary, "", "dry-run"


# ── run_claude_agent ──────────────────────────────────────────────


async def run_claude_agent(run_id: str) -> dict[str, Any]:
    run = claude_agent_runs.get_run(run_id)
    if run is None:
        raise ValueError("run not found")
    workspace = agents.get_agent(run["agent_id"])
    if workspace is None:
        raise ValueError("workspace not found")

    root = agents.resolve_agent_path(workspace)
    model = resolve_run_model(str(run.get("model") or ""))
    signals = run.get("signals") or {}
    from infra import workspace_profile as _wp
    from services.runtime_engine import engine_id_for_runtime, normalize_runtime_engine

    ws_profile = _wp.get_profile(workspace)
    runtime_engine = normalize_runtime_engine(
        signals.get("runtime_engine") or ws_profile.get("runtime_engine"),
    )
    engine_id = engine_id_for_runtime(runtime_engine)

    claude_agent_runs.update_run_status(run_id, status="running")
    claude_agent_runs.append_event(
        run_id,
        "context.prepare",
        {"workspace_root": str(root), "model": model, "runtime_engine": runtime_engine},
    )

    selected_skills = list(signals.get("selected_skills") or [])
    previous_run_id = str(signals.get("previous_run_id") or "").strip()
    attachment_paths = [str(p).strip() for p in (signals.get("attachments") or []) if str(p).strip()]
    _write_conversation_context(workspace, previous_run_id)
    history = _get_conversation_history(previous_run_id)
    prompt = _build_conversation_prompt(run["prompt"], history)
    prompt = _append_attachments_to_prompt(prompt, workspace, attachment_paths)

    # Prepend identity profile to prompt so model sees it before runner default identity
    if ws_profile and ws_profile.get("soul"):
        parts = [f"[SYSTEM IDENTITY - 你的身份设定]\n{ws_profile['soul']}"]
        if ws_profile.get("paradigm"):
            parts.append(ws_profile["paradigm"])
        if ws_profile.get("standards"):
            parts.append(ws_profile["standards"])
        identity = "\n\n".join(parts) + "\n\n-------------------\n\n"
        prompt = identity + prompt

    # Prepend mandatory skill instructions to prompt so model prioritizes them
    if selected_skills:
        from infra import skill_market as _sm2
        skill_lines = []
        for sid in selected_skills:
            entry = _sm2.get_market_skill(sid)
            name = entry.get("name", sid) if entry else sid
            skill_lines.append(f"  - {name} ({sid})")
        mandatory_block = (
            "[SYSTEM SKILL ENFORCEMENT]\n"
            "You MUST read and use each skill below for this task:\n"
            + "\n".join(skill_lines) +
            "\n\nDo NOT skip any skill. If a skill is unusable, explain why.\n"
            "\n-------------------\n\n"
        )
        prompt = mandatory_block + prompt

    vision_text = ""
    from services import workspace_vision

    image_paths = workspace_vision.filter_image_paths(attachment_paths)
    if image_paths:
        if workspace_vision.vision_enabled():
            try:
                vision_text = await workspace_vision.describe_workspace_images(
                    workspace,
                    image_paths,
                    user_prompt=str(run.get("prompt") or ""),
                )
                claude_agent_runs.append_event(
                    run_id,
                    "vision.ready",
                    {
                        "model": workspace_vision.vision_model_name(),
                        "images": len(image_paths),
                        "chars": len(vision_text),
                    },
                )
            except ValueError as exc:
                claude_agent_runs.append_event(run_id, "vision.error", {"error": str(exc)})
                vision_text = f"[视觉分析不可用: {exc}]"
        else:
            claude_agent_runs.append_event(
                run_id,
                "vision.skipped",
                {"reason": "EVOTOWN_CLAUDE_VISION_MODEL 未配置"},
            )
        prompt = _append_vision_to_prompt(prompt, vision_text, image_paths)

    identity = _runner_identity(run)
    skill_account_id = agents.get_agent_owner(workspace["agent_id"]) or str(identity.get("account_id") or "")

    shared_context = build_shared_context(
        prompt=run["prompt"],
        team_id=run.get("team_id", ""),
        selected_skills=selected_skills,
        agent_id=workspace["agent_id"],
        account_id=skill_account_id,
        run_id=run_id,
    )
    shared_context["workspace_profile"] = ws_profile
    materialized_skills = _materialize_skills(workspace, selected_skills) if selected_skills else []
    artifacts = _write_context_files(
        workspace,
        run,
        shared_context,
        materialized_skills=materialized_skills,
    )

    # Snapshot workspace before agent run to detect new files
    _before_files = set()
    for p in root.rglob("*"):
        if p.is_file() and not any(part.startswith(".") for part in p.relative_to(root).parts):
            _before_files.add(str(p.relative_to(root)))
    claude_agent_runs.append_event(
        run_id,
        "context.ready",
        {
            "skills": len(shared_context.get("skills", {}).get("skills", [])),
            "materialized_skills": len(materialized_skills),
            "mcp_connections": len(shared_context.get("mcp", {}).get("connections", [])),
            "mcp_tools": len(shared_context.get("mcp", {}).get("tools", [])),
            "knowledge_results": len(shared_context.get("knowledge", {}).get("results", [])),
        },
    )

    execution_backend = "dry-run"
    timeout_sec = run_timeout_sec()

    # ── 构造 AgentRunContext（resume + gateway 配置） ──
    from services import claude_agent_sdk_runner as _casr

    gateway_env = _casr.gateway_sdk_env(agent_id=str(run.get("agent_id") or ""))
    resume_session_id = ""
    prev_rid = str(signals.get("previous_run_id") or "").strip()
    if prev_rid:
        prev_run = claude_agent_runs.get_run(prev_rid)
        if prev_run:
            prev_signals = prev_run.get("signals") or {}
            resume_session_id = str(prev_signals.get("claude_session_id") or "").strip()
    if not resume_session_id:
        agent_id = str(run.get("agent_id") or "")
        if agent_id:
            recent = claude_agent_runs.list_runs(agent_id=agent_id, limit=2)
            if isinstance(recent, dict):
                latest_runs = recent.get("runs") or []
                for candidate in latest_runs:
                    if candidate.get("run_id") != run.get("run_id"):
                        sid = candidate.get("signals") or {}
                        resume_session_id = str(sid.get("claude_session_id") or "").strip()
                        break

    ctx = AgentRunContext(
        run_id=run["run_id"],
        agent_id=str(run.get("agent_id") or ""),
        prompt=run.get("prompt", ""),
        model=model,
        account_id=str(run.get("account_id") or ""),
        team_id=str(run.get("team_id") or ""),
        tenant_id=str(run.get("tenant_id") or ""),
        gateway_base_url=gateway_env.get("ANTHROPIC_BASE_URL", ""),
        gateway_api_key=gateway_env.get("ANTHROPIC_API_KEY", ""),
        resume_session_id=resume_session_id,
    )

    def on_msg(text: str) -> None:
        claude_agent_runs.append_event(run_id, "assistant_message", {"text": text})
        claude_agent_runs.append_log_excerpt(run_id, text)

    try:
        agent_coro = _run_agent(
            workspace_root=root,
            prompt=prompt,
            run=run,
            model=model,
            runtime_engine=runtime_engine,
            context=ctx,
            on_message=on_msg,
        )
        if timeout_sec > 0:
            exit_code, output, raw_output, execution_backend = await asyncio.wait_for(agent_coro, timeout=timeout_sec)
        else:
            exit_code, output, raw_output, execution_backend = await agent_coro
    except asyncio.TimeoutError:
        msg = f"Run timed out after {timeout_sec}s"
        claude_agent_runs.append_event(run_id, "run.error", {"error": msg, "timeout_sec": timeout_sec})
        updated = claude_agent_runs.update_run_status(
            run_id,
            status="failed",
            log_excerpt=msg,
            result_summary=msg,
            error=msg,
            artifact_manifest=artifacts,
            signals={
                **(run.get("signals") or {}),
                "engine_id": engine_id,
                "runtime_engine": runtime_engine,
                "agent_id": workspace["agent_id"],
                "execution_backend": execution_backend,
                "sdk_command_configured": execution_backend != "dry-run",
            },
        )
        return updated or run
    except asyncio.CancelledError:
        current = claude_agent_runs.get_run(run_id) or run
        if current.get("status") in claude_agent_runs.TERMINAL_STATUSES:
            return current
        msg = "Run cancelled"
        claude_agent_runs.append_event(run_id, "run.error", {"error": msg, "cancelled": True})
        updated = claude_agent_runs.update_run_status(
            run_id,
            status="cancelled",
            log_excerpt=msg,
            result_summary=msg,
            error=msg,
            artifact_manifest=artifacts,
            signals={
                **(run.get("signals") or {}),
                "engine_id": engine_id,
                "runtime_engine": runtime_engine,
                "agent_id": workspace["agent_id"],
                "execution_backend": execution_backend,
            },
        )
        raise
    except Exception as exc:
        error = str(exc)
        claude_agent_runs.append_event(run_id, "run.error", {"error": error})
        updated = claude_agent_runs.update_run_status(
            run_id,
            status="failed",
            log_excerpt=error,
            result_summary="Claude Code runner failed before completion.",
            error=error,
            artifact_manifest=artifacts,
            signals={
                **(run.get("signals") or {}),
                "engine_id": engine_id,
                "runtime_engine": runtime_engine,
                "agent_id": workspace["agent_id"],
                "execution_backend": execution_backend,
                "sdk_command_configured": execution_backend != "dry-run",
            },
        )
        return updated or run

    status = "succeeded" if exit_code == 0 else "failed"
    summary = _result_summary_from_output(output, vision_text=vision_text)

    # Scan workspace for new files created by the Agent
    new_artifact_paths: set[str] = set()
    try:
        for p in root.rglob("*"):
            if p.is_file() and not any(part.startswith(".") for part in p.relative_to(root).parts):
                rel = str(p.relative_to(root))
                if rel not in _before_files:
                    new_artifact_paths.add(rel)
                    artifacts.append({
                        "path": rel,
                        "bytes": p.stat().st_size,
                        "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                    })
    except Exception:
        pass

    from infra import artifact_sort

    artifacts, moved, sort_warning = artifact_sort.sort_artifacts(
        root,
        artifacts,
        new_paths=new_artifact_paths,
        run_id=run_id,
    )
    if moved:
        claude_agent_runs.append_event(run_id, "artifact.sort", {"moved": moved})
    if sort_warning:
        claude_agent_runs.append_event(
            run_id,
            "artifact.sort",
            {"warning": "invalid EVOTOWN_ARTIFACT_SORT_RULES; using defaults", "detail": sort_warning},
        )

    claude_agent_runs.append_event(
        run_id,
        "assistant_message" if status == "succeeded" else "run.error",
        {"exit_code": exit_code, "summary": summary, "text": summary},
    )
    updated = claude_agent_runs.update_run_status(
        run_id,
        status=status,
        log_excerpt=raw_output or output,
        result_summary=summary,
        error="" if status == "succeeded" else summary,
        artifact_manifest=artifacts,
        signals={
            **(run.get("signals") or {}),
            "engine_id": engine_id,
            "runtime_engine": runtime_engine,
            "agent_id": workspace["agent_id"],
            "execution_backend": execution_backend,
            "sdk_command_configured": execution_backend != "dry-run",
            "skill_count": len(shared_context.get("skills", {}).get("skills", [])),
            "materialized_skill_count": len(materialized_skills),
            "mcp_connection_count": len(shared_context.get("mcp", {}).get("connections", [])),
            "knowledge_result_count": len(shared_context.get("knowledge", {}).get("results", [])),
            "vision_model": workspace_vision.vision_model_name() if vision_text else "",
            **({"vision_analysis": vision_text[:8000]} if vision_text and not vision_text.startswith("[视觉分析不可用") else {}),
        },
    )
    return updated or run


async def cancel_run(run_id: str) -> dict[str, Any] | None:
    run = claude_agent_runs.get_run(run_id)
    if run is None:
        return None
    if run.get("status") in claude_agent_runs.TERMINAL_STATUSES:
        return run
    task = _RUN_TASKS.get(run_id)
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    run = claude_agent_runs.get_run(run_id)
    if run is not None and run.get("status") in claude_agent_runs.RUNNING_STATUSES:
        msg = "Run cancelled by user"
        claude_agent_runs.append_event(run_id, "run.error", {"error": msg, "cancelled": True})
        return claude_agent_runs.update_run_status(
            run_id,
            status="cancelled",
            log_excerpt=msg,
            result_summary=msg,
            error=msg,
        )
    return run


async def stale_run_watchdog_loop() -> None:
    """Mark queued/running runs as failed when they exceed DEFAULT_RUN_TIMEOUT_SEC."""
    while True:
        try:
            await asyncio.sleep(30)
            timeout_sec = run_timeout_sec()
            if timeout_sec <= 0:
                continue
            for stale in claude_agent_runs.list_stale_active_runs(timeout_sec=timeout_sec):
                run_id = stale["run_id"]
                task = _RUN_TASKS.get(run_id)
                if task is not None and not task.done():
                    task.cancel()
                msg = f"Run timed out after {timeout_sec}s (watchdog)"
                claude_agent_runs.append_event(run_id, "run.error", {"error": msg, "timeout_sec": timeout_sec})
                claude_agent_runs.update_run_status(
                    run_id,
                    status="failed",
                    log_excerpt=msg,
                    result_summary=msg,
                    error=msg,
                )
        except asyncio.CancelledError:
            break
        except Exception:
            continue


def schedule_run(run_id: str) -> None:
    async def _runner() -> None:
        try:
            await run_claude_agent(run_id)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            from infra import claude_agent_runs as _car
            _car.update_run_status(run_id, status="failed", error=str(exc), log_excerpt=str(exc)[:500])

    task = asyncio.create_task(_runner())
    _RUN_TASKS[run_id] = task

    def _clear(_task: asyncio.Task) -> None:
        _RUN_TASKS.pop(run_id, None)
        # 即时触发排队任务 drain（fire-and-forget）
        asyncio.ensure_future(_drain_queued())

    task.add_done_callback(_clear)


async def _drain_queued() -> None:
    try:
        from infra.task_nodes import try_drain_one
        await try_drain_one()
    except Exception:
        pass
