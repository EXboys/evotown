"""Centrally hosted Claude Code runner orchestration.

The runner keeps the control-plane contract stable even when the actual Claude
Code SDK/CLI command is supplied later by deployment config.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shlex
import shutil
import zipfile
from pathlib import Path
from typing import Any

from infra import claude_agent_runs, database_registry, knowledge, skill_market, workspaces

DEFAULT_MODEL = "claude-sonnet-4"
DEFAULT_ENGINE_ID = "claude-code-hosted"
DEFAULT_RUN_TIMEOUT_SEC = 600

_RUN_TASKS: dict[str, asyncio.Task] = {}


def run_timeout_sec() -> int:
    raw = os.environ.get("EVOTOWN_CLAUDE_RUN_TIMEOUT_SEC", str(DEFAULT_RUN_TIMEOUT_SEC)).strip()
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_RUN_TIMEOUT_SEC
    return max(0, value)


def get_run_task(run_id: str) -> asyncio.Task | None:
    return _RUN_TASKS.get(run_id)


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def _arena_skills_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "arena_skills"


def _skill_manifest(account_id: str = "") -> dict[str, Any]:
    """Build a skill manifest for one account based on assigned skills."""
    from infra import account_skills as acct_skills

    if account_id.strip():
        assigned = acct_skills.list_for_account(account_id.strip())
        # Build manifest from assigned skills (may be empty)
        skills: list[dict[str, Any]] = []
        for sid in assigned:
            entry = skill_market.get_market_skill(sid)
            if entry:
                skills.append(entry)
        return {
            "bundle_id": f"account-{account_id[:8]}",
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


def _resolve_mcp_context(selected_mcp: list[str], identity: dict[str, Any]) -> dict[str, Any]:
    if not selected_mcp:
        return {"selection_mode": "none", "connections": [], "tool_skill": "database-query"}
    accessible = {
        item["connection_id"]: item for item in database_registry.list_accessible_connections(identity)
    }
    connections: list[dict[str, Any]] = []
    for raw_id in selected_mcp:
        connection_id = raw_id.strip()
        if not connection_id:
            continue
        conn = database_registry.get_connection(connection_id)
        if conn is None or conn.get("status") != "active":
            continue
        grant = accessible.get(connection_id)
        if grant is None and not identity.get("account_id"):
            # Admin/service context without account binding — allow active connections.
            grant = {"permission": "admin"}
        if grant is None:
            continue
        connections.append(
            {
                "connection_id": conn["connection_id"],
                "name": conn["name"],
                "db_type": conn["db_type"],
                "mcp_server_url": conn.get("mcp_server_url", ""),
                "access_mode": conn.get("access_mode", ""),
                "permission": grant.get("permission", "read"),
                "description": conn.get("description", ""),
                "usage": (
                    "Query via Evotown `database-query` skill: "
                    f'{{"action":"query","connection_id":"{conn["connection_id"]}","sql":"SELECT ..."}}'
                ),
            }
        )
    proxy_url = os.environ.get("EVOTOWN_DB_MCP_URL", "").strip()
    return {
        "selection_mode": "explicit",
        "connections": connections,
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
    dest = workspaces.resolve_workspace_path(workspace, f".evotown/skills/{skill_id}")
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
        result = str(h.get("result_summary") or h.get("log_excerpt") or "")
        lines.append(f"  助手: {result}")
    lines.append(f"---")
    lines.append(f"用户的新消息: {current_prompt}")
    return "\n".join(lines)


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

    root = workspaces.resolve_workspace_path(workspace)
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
) -> str:
    skills_block = shared_context.get("skills", {})
    mcp_block = shared_context.get("mcp", {})
    root_path = workspace_root or str(workspaces.resolve_workspace_path(workspace))
    lines = [
        "# Evotown Hosted Claude Context",
        "",
        f"Run ID: `{run['run_id']}`",
        f"Workspace ID: `{workspace['workspace_id']}`",
        f"Model: `{run.get('model') or DEFAULT_MODEL}`",
        "",
        f"Workspace Root: `{root_path}`",
        "ALL file read/write/edit/bash operations MUST use paths relative to",
        "the workspace root above. Never use absolute paths like /data/workspace/.",
        "",
        "## Available Skills",
        "",
    ]
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
    if materialized_skills:
        lines.append("- Materialized under `.evotown/skills/`")
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
            f"- `{conn.get('connection_id')}` ({conn.get('db_type')}) — "
            f"{conn.get('name')} · permission={conn.get('permission')}"
        )
        if conn.get("mcp_server_url"):
            lines.append(f"  - MCP proxy: {conn['mcp_server_url']}")
        lines.append(f"  - {conn.get('usage', '')}")
    if mcp_block.get("mcp_proxy_url"):
        lines.append(f"- Default MCP proxy base URL: `{mcp_block['mcp_proxy_url']}`")
    lines.append("")
    return "\n".join(lines)


def build_shared_context(
    *,
    prompt: str,
    team_id: str = "",
    selected_skills: list[str] | None = None,
    selected_mcp: list[str] | None = None,
    account_id: str = "",
    identity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    hits = _knowledge_hits(prompt, team_id=team_id)
    skills = _filter_skill_manifest(_skill_manifest(account_id), list(selected_skills or []))
    mcp = _resolve_mcp_context(list(selected_mcp or []), identity or {})
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
    root = workspaces.resolve_workspace_path(workspace)
    evotown_dir = root / ".evotown"
    evotown_dir.mkdir(parents=True, exist_ok=True)

    agent_md = _render_agent_context_md(
        workspace=workspace,
        run=run,
        shared_context=shared_context,
        materialized_skills=materialized_skills,
        workspace_root=str(root),
    )
    files: list[tuple[str, str]] = [
        ("skills_manifest.json", _json_dumps(shared_context.get("skills", {}))),
        ("knowledge_context.json", _json_dumps(shared_context.get("knowledge", {}))),
        ("mcp_context.json", _json_dumps(shared_context.get("mcp", {}))),
        ("AGENT_CONTEXT.md", agent_md),
    ]

    manifest: list[dict[str, Any]] = []
    for relative, content in files:
        path = workspaces.resolve_workspace_path(workspace, f".evotown/{relative}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        manifest.append({"path": f".evotown/{relative}", "sha256": digest, "bytes": len(content.encode("utf-8"))})

    mcp_servers: dict[str, Any] = {}
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


def _default_claude_command() -> str:
    script = Path(__file__).resolve().parent.parent / "scripts" / "run_claude_code.sh"
    if script.is_file() and shutil.which("claude"):
        return f"bash {shlex.quote(str(script))} {{prompt}} {{model}} {{workspace}} {{run_id}}"
    if shutil.which("claude"):
        return (
            'claude -p {prompt} --model {model} '
            '--allowedTools "Read,Edit,Bash,Glob,Grep,Write" '
            "--append-system-prompt-file .evotown/AGENT_CONTEXT.md"
        )
    # Fallback: use bundled Claude CLI from the SDK package
    bundled = Path("/usr/local/lib/python3.11/site-packages/claude_agent_sdk/_bundled/claude")
    if bundled.is_file():
        return (
            f"{shlex.quote(str(bundled))} -p {{prompt}} --model {{model}} "
            '--permission-mode acceptEdits '
            '--allowedTools "Read,Edit,Bash,Glob,Grep,Write" '
            "--max-turns 25 "
            "--output-format stream-json --verbose --bare "
            "--append-system-prompt-file .evotown/AGENT_CONTEXT.md"
        )
    return ""


def _command_template(*, explicit_only: bool = False) -> str:
    explicit = os.environ.get("EVOTOWN_CLAUDE_CODE_COMMAND", "").strip()
    if explicit:
        return explicit
    if explicit_only:
        return ""
    return _default_claude_command()


def _sdk_ready() -> bool:
    from services import claude_agent_sdk_runner

    direct_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    gateway_key = os.environ.get("EVOTOWN_CLAUDE_GATEWAY_API_KEY", "").strip()
    gateway_enabled = os.environ.get("EVOTOWN_CLAUDE_USE_GATEWAY", "").strip().lower() in {"1", "true", "yes", "on"}
    return bool(claude_agent_sdk_runner.sdk_available() and (direct_key or (gateway_enabled and gateway_key)))


def _execution_backend() -> str:
    """Resolve run backend: embedded SDK (default), external CLI, or dry-run."""
    from services import claude_agent_sdk_runner

    mode = os.environ.get("EVOTOWN_CLAUDE_EXECUTION_MODE", "auto").strip().lower()
    if mode == "dry-run":
        return "dry-run"
    if mode == "sdk":
        return "sdk" if claude_agent_sdk_runner.sdk_available() else "dry-run"
    if mode == "cli":
        return "cli" if _command_template(explicit_only=False) else "dry-run"
    if os.environ.get("EVOTOWN_CLAUDE_CODE_COMMAND", "").strip():
        return "cli"
    if _sdk_ready():
        return "sdk"
    if _default_claude_command():
        return "cli"
    return "dry-run"


async def _run_agent(*, workspace_root: Path, prompt: str, run: dict[str, Any], model: str) -> tuple[int, str, str]:
    backend = _execution_backend()
    if backend == "sdk":
        from services import claude_agent_sdk_runner

        exit_code, output = await claude_agent_sdk_runner.run_agent_sdk(
            workspace_root=workspace_root,
            prompt=prompt,
            model=model,
            run=run,
        )
        return exit_code, output, backend
    if backend == "cli":
        exit_code, output = await _run_configured_command(
            workspace_root=workspace_root,
            prompt=prompt,
            run=run,
            model=model,
        )
        return exit_code, output, backend
    summary = (
        "Dry-run completed. Install claude-agent-sdk (pip install claude-agent-sdk) and set "
        "ANTHROPIC_API_KEY, enable EVOTOWN_CLAUDE_USE_GATEWAY with EVOTOWN_CLAUDE_GATEWAY_API_KEY, "
        "or configure EVOTOWN_CLAUDE_CODE_COMMAND for CLI execution. "
        "Workspace context files were written under .evotown/."
    )
    return 0, summary, "dry-run"


def _parse_cli_output(raw_output: str) -> tuple[str, str]:
    """Parse stream-json CLI output into human-readable text.

    Returns (text_output, result_summary) where text_output is the
    full extracted text and result_summary is the final answer.
    """
    lines = raw_output.splitlines()
    assistant_texts: list[str] = []
    result_text = ""
    exit_code_text = ""

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            # Non-JSON line — keep as-is
            assistant_texts.append(line)
            continue

        obj_type = obj.get("type", "")
        if obj_type == "assistant":
            message = obj.get("message", {})
            for block in message.get("content", []):
                text = block.get("text", "")
                if text:
                    assistant_texts.append(text)
        elif obj_type == "result":
            result_text = obj.get("result", "") or ""
            if obj.get("is_error") and not result_text:
                result_text = obj.get("subtype", "error")
            exit_code_text = result_text
        elif obj_type == "system":
            subtype = obj.get("subtype", "")
            if subtype == "init":
                assistant_texts.append(f"[Claude Agent started — model: {obj.get('model','?')}]")
        elif obj_type == "user":
            # tool_result content — skip for display
            pass

    if not assistant_texts:
        return result_text or exit_code_text or "[no output]", result_text or exit_code_text or ""

    full_text = "\n\n".join(assistant_texts)
    summary = result_text or assistant_texts[-1]
    return full_text, summary


def _cli_subprocess_env(*, workspace_root: Path, run: dict[str, Any], model: str) -> dict[str, str]:
    from services import claude_agent_sdk_runner

    signals = run.get("signals") or {}
    gateway_env = claude_agent_sdk_runner.gateway_sdk_env()
    api_key = gateway_env.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "").strip()
    env: dict[str, str] = {
        **{k: str(v) for k, v in os.environ.items()},
        "NODE_TLS_REJECT_UNAUTHORIZED": "0",
        "CLAUDE_CODE_SIMPLE": "1",
        "ANTHROPIC_API_KEY": api_key,
        "EVOTOWN_AGENT_RUN_ID": run["run_id"],
        "EVOTOWN_AGENT_PROMPT": run.get("prompt", ""),
        "EVOTOWN_WORKSPACE_ROOT": str(workspace_root),
        "EVOTOWN_CLAUDE_MODEL": model,
        "EVOTOWN_SELECTED_SKILLS": json.dumps(signals.get("selected_skills") or []),
        "EVOTOWN_SELECTED_MCP": json.dumps(signals.get("selected_mcp") or []),
        "EVOTOWN_SKILLS_MANIFEST": str(workspace_root / ".evotown" / "skills_manifest.json"),
        "EVOTOWN_MCP_CONTEXT": str(workspace_root / ".evotown" / "mcp_context.json"),
    }
    if gateway_env.get("ANTHROPIC_BASE_URL"):
        env["ANTHROPIC_BASE_URL"] = gateway_env["ANTHROPIC_BASE_URL"]
    elif api_key:
        env.setdefault("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
    env.update({k: str(v) for k, v in gateway_env.items() if k not in env})
    return env


async def _run_configured_command(*, workspace_root: Path, prompt: str, run: dict[str, Any], model: str) -> tuple[int, str]:
    template = _command_template()
    if not template:
        raise RuntimeError("CLI backend selected but no command template is configured")

    command = template.format(
        prompt=shlex.quote(prompt),
        run_id=shlex.quote(run["run_id"]),
        model=shlex.quote(model),
        workspace=shlex.quote(str(workspace_root)),
    )
    proc = await asyncio.create_subprocess_shell(
        command,
        cwd=str(workspace_root),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=_cli_subprocess_env(workspace_root=workspace_root, run=run, model=model),
    )
    stdout, _ = await proc.communicate()
    raw_output = stdout.decode("utf-8", errors="replace") if stdout else ""
    clean_output, _ = _parse_cli_output(raw_output)
    return int(proc.returncode or 0), clean_output[-65536:]


async def run_claude_agent(run_id: str) -> dict[str, Any]:
    run = claude_agent_runs.get_run(run_id)
    if run is None:
        raise ValueError("run not found")
    workspace = workspaces.get_workspace(run["workspace_id"])
    if workspace is None:
        raise ValueError("workspace not found")

    root = workspaces.resolve_workspace_path(workspace)
    model = run.get("model") or os.environ.get("EVOTOWN_CLAUDE_MODEL", DEFAULT_MODEL)
    claude_agent_runs.update_run_status(run_id, status="running")
    claude_agent_runs.append_event(run_id, "context.prepare", {"workspace_root": str(root), "model": model})

    signals = run.get("signals") or {}
    selected_skills = list(signals.get("selected_skills") or [])
    selected_mcp = list(signals.get("selected_mcp") or [])
    previous_run_id = str(signals.get("previous_run_id") or "").strip()
    _write_conversation_context(workspace, previous_run_id)
    history = _get_conversation_history(previous_run_id)
    prompt = _build_conversation_prompt(run["prompt"], history)
    identity = _runner_identity(run)
    shared_context = build_shared_context(
        prompt=run["prompt"],
        team_id=run.get("team_id", ""),
        selected_skills=selected_skills,
        selected_mcp=selected_mcp,
        identity=identity,
    )
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
            "knowledge_results": len(shared_context.get("knowledge", {}).get("results", [])),
        },
    )

    execution_backend = "dry-run"
    timeout_sec = run_timeout_sec()
    try:
        agent_coro = _run_agent(
            workspace_root=root,
            prompt=prompt,
            run=run,
            model=model,
        )
        if timeout_sec > 0:
            exit_code, output, execution_backend = await asyncio.wait_for(agent_coro, timeout=timeout_sec)
        else:
            exit_code, output, execution_backend = await agent_coro
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
                "engine_id": DEFAULT_ENGINE_ID,
                "workspace_id": workspace["workspace_id"],
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
                "engine_id": DEFAULT_ENGINE_ID,
                "workspace_id": workspace["workspace_id"],
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
                "engine_id": DEFAULT_ENGINE_ID,
                "workspace_id": workspace["workspace_id"],
                "execution_backend": execution_backend,
                "sdk_command_configured": execution_backend != "dry-run",
            },
        )
        return updated or run

    status = "succeeded" if exit_code == 0 else "failed"
    summary = output.strip().splitlines()[-1] if output.strip() else "Claude Code runner completed."

    # Scan workspace for new files created by the Agent
    try:
        for p in root.rglob("*"):
            if p.is_file() and not any(part.startswith(".") for part in p.relative_to(root).parts):
                rel = str(p.relative_to(root))
                if rel not in _before_files:
                    artifacts.append({
                        "path": rel,
                        "bytes": p.stat().st_size,
                        "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                    })
    except Exception:
        pass

    claude_agent_runs.append_event(
        run_id,
        "assistant_message" if status == "succeeded" else "run.error",
        {"exit_code": exit_code, "summary": summary[:1000]},
    )
    updated = claude_agent_runs.update_run_status(
        run_id,
        status=status,
        log_excerpt=output,
        result_summary=summary,
        error="" if status == "succeeded" else summary,
        artifact_manifest=artifacts,
        signals={
            **(run.get("signals") or {}),
            "engine_id": DEFAULT_ENGINE_ID,
            "workspace_id": workspace["workspace_id"],
            "execution_backend": execution_backend,
            "sdk_command_configured": execution_backend != "dry-run",
            "skill_count": len(shared_context.get("skills", {}).get("skills", [])),
            "materialized_skill_count": len(materialized_skills),
            "mcp_connection_count": len(shared_context.get("mcp", {}).get("connections", [])),
            "knowledge_result_count": len(shared_context.get("knowledge", {}).get("results", [])),
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
    """Mark queued/running runs as failed when they exceed EVOTOWN_CLAUDE_RUN_TIMEOUT_SEC."""
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

    task = asyncio.create_task(_runner())
    _RUN_TASKS[run_id] = task

    def _clear(_task: asyncio.Task) -> None:
        _RUN_TASKS.pop(run_id, None)

    task.add_done_callback(_clear)
