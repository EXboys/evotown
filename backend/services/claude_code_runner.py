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
from pathlib import Path
from typing import Any

from infra import claude_agent_runs, knowledge, skill_market, workspaces

DEFAULT_MODEL = "claude-sonnet-4"
DEFAULT_ENGINE_ID = "claude-code-hosted"


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


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


def _knowledge_hits(prompt: str, *, team_id: str = "", limit: int = 5) -> list[dict[str, Any]]:
    query = " ".join(prompt.split())[:240]
    if not query:
        return []
    try:
        return knowledge.search_documents(query=query, team_id=team_id or None, limit=limit)
    except Exception:
        return []


def build_shared_context(*, prompt: str, team_id: str = "") -> dict[str, Any]:
    hits = _knowledge_hits(prompt, team_id=team_id)
    return {
        "skills": _skill_manifest(),
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


def _write_context_files(workspace: dict[str, Any], run: dict[str, Any], shared_context: dict[str, Any]) -> list[dict[str, Any]]:
    root = workspaces.resolve_workspace_path(workspace)
    evotown_dir = root / ".evotown"
    evotown_dir.mkdir(parents=True, exist_ok=True)

    files: list[tuple[str, str]] = [
        ("skills_manifest.json", _json_dumps(shared_context.get("skills", {}))),
        ("knowledge_context.json", _json_dumps(shared_context.get("knowledge", {}))),
        (
            "AGENT_CONTEXT.md",
            "\n".join(
                [
                    "# Evotown Hosted Claude Context",
                    "",
                    f"Run ID: `{run['run_id']}`",
                    f"Workspace ID: `{workspace['workspace_id']}`",
                    "",
                    "Use files in this workspace as the only writable project state.",
                    "Public skills are described in `.evotown/skills_manifest.json`.",
                    "Knowledge citations are available in `.evotown/knowledge_context.json`.",
                    "",
                ]
            ),
        ),
    ]

    manifest: list[dict[str, Any]] = []
    for relative, content in files:
        path = workspaces.resolve_workspace_path(workspace, f".evotown/{relative}")
        path.write_text(content, encoding="utf-8")
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        manifest.append({"path": f".evotown/{relative}", "sha256": digest, "bytes": len(content.encode("utf-8"))})
    return manifest


def _command_template() -> str:
    return os.environ.get("EVOTOWN_CLAUDE_CODE_COMMAND", "").strip()


async def _run_configured_command(*, workspace_root: Path, prompt: str, run: dict[str, Any], model: str) -> tuple[int, str]:
    template = _command_template()
    if not template:
        summary = (
            "Dry-run completed. Configure EVOTOWN_CLAUDE_CODE_COMMAND to invoke the Claude Code SDK/CLI. "
            "Workspace context files were written under .evotown/."
        )
        return 0, summary

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
        env={
            **os.environ,
            "EVOTOWN_AGENT_RUN_ID": run["run_id"],
            "EVOTOWN_WORKSPACE_ROOT": str(workspace_root),
            "EVOTOWN_CLAUDE_MODEL": model,
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

    shared_context = build_shared_context(prompt=run["prompt"], team_id=run.get("team_id", ""))
    artifacts = _write_context_files(workspace, run, shared_context)
    claude_agent_runs.append_event(
        run_id,
        "context.ready",
        {
            "skills": len(shared_context.get("skills", {}).get("skills", [])),
            "knowledge_results": len(shared_context.get("knowledge", {}).get("results", [])),
        },
    )

    try:
        exit_code, output = await _run_configured_command(
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
                "sdk_command_configured": bool(_command_template()),
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
            "sdk_command_configured": bool(_command_template()),
            "skill_count": len(shared_context.get("skills", {}).get("skills", [])),
            "knowledge_result_count": len(shared_context.get("knowledge", {}).get("results", [])),
        },
    )
    return updated or run


def schedule_run(run_id: str) -> None:
    asyncio.create_task(run_claude_agent(run_id))
