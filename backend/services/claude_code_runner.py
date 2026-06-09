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


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def _arena_skills_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "arena_skills"


def _skill_manifest() -> dict[str, Any]:
    manifest = skill_market.get_bundle_manifest(
        os.environ.get("EVOTOWN_CLAUDE_SKILL_BUNDLE", "default-agent-skills"),
        channel=os.environ.get("EVOTOWN_CLAUDE_SKILL_CHANNEL", "stable"),
        runtime_target=os.environ.get("EVOTOWN_CLAUDE_SKILL_RUNTIME", "custom"),
    )
    if manifest is not None:
        return manifest
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


def _render_agent_context_md(
    *,
    workspace: dict[str, Any],
    run: dict[str, Any],
    shared_context: dict[str, Any],
    materialized_skills: list[str],
) -> str:
    skills_block = shared_context.get("skills", {})
    mcp_block = shared_context.get("mcp", {})
    lines = [
        "# Evotown Hosted Claude Context",
        "",
        f"Run ID: `{run['run_id']}`",
        f"Workspace ID: `{workspace['workspace_id']}`",
        f"Model: `{run.get('model') or DEFAULT_MODEL}`",
        "",
        "Use files in this workspace as the only writable project state.",
        "",
        "## Skills",
        "",
        f"- Selection: `{skills_block.get('selection_mode', 'bundle_all')}`",
        f"- Manifest: `.evotown/skills_manifest.json`",
    ]
    if materialized_skills:
        lines.append("- Materialized skill directories (read `SKILL.md` in each):")
        for path in materialized_skills:
            lines.append(f"  - `{path}/SKILL.md`")
    else:
        skill_entries = skills_block.get("skills") or []
        if skill_entries:
            lines.append("- Referenced skills (manifest only; mount directories under `.evotown/skills/` when available):")
            for entry in skill_entries[:20]:
                if isinstance(entry, dict):
                    lines.append(f"  - `{entry.get('skill_id', '')}` — {entry.get('name', '')}")

    lines.extend(
        [
            "",
            "## Knowledge",
            "",
            "Citations and search hits: `.evotown/knowledge_context.json`",
            "Tool endpoint: `/api/v1/knowledge/search?q=<query>`",
            "",
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
    identity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    hits = _knowledge_hits(prompt, team_id=team_id)
    skills = _filter_skill_manifest(_skill_manifest(), list(selected_skills or []))
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

    return bool(claude_agent_sdk_runner.sdk_available() and os.environ.get("ANTHROPIC_API_KEY", "").strip())


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
        "ANTHROPIC_API_KEY, or configure EVOTOWN_CLAUDE_CODE_COMMAND for CLI execution. "
        "Workspace context files were written under .evotown/."
    )
    return 0, summary, "dry-run"


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
    signals = run.get("signals") or {}
    proc = await asyncio.create_subprocess_shell(
        command,
        cwd=str(workspace_root),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env={
            **os.environ,
            "EVOTOWN_AGENT_RUN_ID": run["run_id"],
            "EVOTOWN_AGENT_PROMPT": run.get("prompt", ""),
            "EVOTOWN_WORKSPACE_ROOT": str(workspace_root),
            "EVOTOWN_CLAUDE_MODEL": model,
            "EVOTOWN_SELECTED_SKILLS": json.dumps(signals.get("selected_skills") or []),
            "EVOTOWN_SELECTED_MCP": json.dumps(signals.get("selected_mcp") or []),
            "EVOTOWN_SKILLS_MANIFEST": str(workspace_root / ".evotown" / "skills_manifest.json"),
            "EVOTOWN_MCP_CONTEXT": str(workspace_root / ".evotown" / "mcp_context.json"),
        },
    )
    stdout, _ = await proc.communicate()
    output = stdout.decode("utf-8", errors="replace") if stdout else ""
    return int(proc.returncode or 0), output[-65536:]


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
    try:
        exit_code, output, execution_backend = await _run_agent(
            workspace_root=root,
            prompt=run["prompt"],
            run=run,
            model=model,
        )
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


def schedule_run(run_id: str) -> None:
    asyncio.create_task(run_claude_agent(run_id))
