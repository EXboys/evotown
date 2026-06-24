"""Centrally hosted Coding Agent agents and runs."""
from __future__ import annotations

import asyncio
import json
import os

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse

from core.auth import check_prompt_injection, require_console_read, validate_soul_content
from domain.models import ClaudeAgentRunCreate, WorkspaceCreate, WorkspaceProfileUpdate, WorkspaceUpdate
from infra import claude_agent_runs, workspace_files, workspace_profile, workspace_uploads, agents
from services import claude_code_runner

router = APIRouter(prefix="/api/v1", tags=["agent"])

def _is_admin(identity: dict | None) -> bool:
    if not identity:
        return False
    scopes = identity.get("scopes") or []
    return "*" in scopes or "console.write" in scopes


def _account_id(identity: dict | None) -> str:
    return str((identity or {}).get("account_id") or "")


def _require_identity(identity: dict | None) -> dict:
    if identity is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="console authentication required")
    return identity


def _require_scope(identity: dict, *allowed: str) -> None:
    scopes = identity.get("scopes") or []
    if "*" in scopes:
        return
    if any(scope in scopes for scope in allowed):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"missing required scope: {' or '.join(allowed)}")


def _load_agent_for_identity(agent_id: str, identity: dict) -> dict:
    agent = agents.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    if not agents.can_access_agent(agent, identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="agent access denied")
    return agent


def _normalize_attachment_paths(agent: dict, paths: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in paths:
        rel = str(raw or "").strip().replace("\\", "/").lstrip("/")
        if not rel or rel in seen:
            continue
        if not rel.startswith("uploads/"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid attachment path: {rel}")
        try:
            target = agents.resolve_agent_path(agent, rel)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        if not target.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"attachment not found: {rel}")
        seen.add(rel)
        normalized.append(rel)
    return normalized


@router.get("/agent/options")
async def get_agent_options(
    agent_id: str = "",
    identity: dict | None = Depends(require_console_read),
):
    """User-readable catalog of models, skills and MCP plugins for the workbench."""
    identity = _require_identity(identity)
    _require_scope(identity, "agent.read", "agent.write", "console.read", "console.write")

    # Determine model policy from workspace; default to 'all' if no agent specified
    policy = "all"
    if agent_id:
        ws = agents.get_agent(agent_id)
        if ws:
            policy = str(ws.get("model_policy") or "all")
    models = claude_code_runner.list_available_models(policy=policy)

    skills: list[dict] = []
    try:
        from infra import account_skills, skill_market

        account_id = _account_id(identity)
        assigned = account_skills.list_for_account(account_id) if account_id else []
        for sid in assigned:
            skill = skill_market.get_market_skill(sid)
            if skill:
                skills.append({
                    "id": skill.get("skill_id") or skill.get("id") or skill.get("name", ""),
                    "name": skill.get("name") or skill.get("skill_id", ""),
                    "version": skill.get("version", ""),
                    "summary": skill.get("summary") or skill.get("description", ""),
                })
    except Exception:
        skills = []

    databases: list[dict] = []  # MCP is now auto-injected from agent policy, no manual selection

    return {
        "models": models,
        "default_model": claude_code_runner.default_model_id(policy=policy),
        "runtime_engines": [
            {"id": "claude", "label": "Claude Agent SDK"},
            {"id": "codex", "label": "Codex SDK"},
        ],
        "default_runtime_engine": "claude",
        "skills": skills,
        "mcp": databases,
    }


@router.get("/agents")
async def list_agents(
    include_all: bool = False,
    status_filter: str | None = "active",
    category: str | None = None,
    limit: int = 100,
    identity: dict | None = Depends(require_console_read),
):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.read", "agent.write", "console.read", "console.write")
    owner = None if include_all and _is_admin(identity) else _account_id(identity)
    if not owner and not _is_admin(identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account-bound session required")
    return {
        "agents": agents.list_agents(owner_account_id=owner, status=status_filter, category=category, limit=limit),
        "viewer": {"is_admin": _is_admin(identity), "account_id": _account_id(identity)},
    }


@router.post("/agents")
async def create_agent(body: WorkspaceCreate, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.write", "console.write")
    owner = body.owner_account_id.strip() if _is_admin(identity) and body.owner_account_id.strip() else _account_id(identity)
    if not owner:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="owner_account_id is required when using admin token",
        )
    try:
        # Resolve model_policy: system_config default overrides Pydantic default
        from infra import system_config as sys_cfg
        effective_policy = str(body.model_policy or sys_cfg.get_value("agent_default_model_policy", "routes_only"))
        if effective_policy not in ("all", "routes_only"):
            effective_policy = "routes_only"

        # Validate: routes_only requires at least one enabled route alias
        if effective_policy == "routes_only" and claude_code_runner.count_route_aliases() == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="无法创建：选择了「仅路由别名」模式，但当前没有任何已启用的路由别名。请先在网关配置中添加路由别名，或选择「全部模型」模式。",
            )

        agent = agents.create_agent(
            owner_account_id=owner,
            name=body.name,
            tenant_id=body.tenant_id or str(identity.get("org_id") or ""),
            team_id=body.team_id or str(identity.get("team_id") or ""),
            model_policy=effective_policy,
            category=body.category,
            template_id=body.template_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"agent": agent}


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.read", "agent.write", "console.read", "console.write")
    agent = _load_agent_for_identity(agent_id, identity)
    result = claude_agent_runs.list_runs(
        agent_id=agent_id,
        account_id=None if _is_admin(identity) else _account_id(identity),
        limit=20,
    )
    return {
        "agent": {**agent, "usage_bytes": agents.agent_usage_bytes(agent)},
        "runs": result["runs"],
        "viewer": {"is_admin": _is_admin(identity), "account_id": _account_id(identity)},
    }


@router.patch("/agents/{agent_id}")
async def update_agent(agent_id: str, body: WorkspaceUpdate, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.write", "console.write")
    agent = _load_agent_for_identity(agent_id, identity)
    if not _is_admin(identity) and agent.get("owner_account_id") != _account_id(identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="only the owner can update agent")
    if body.owner_account_id is not None and not _is_admin(identity):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="only an admin can reassign the agent owner",
        )
    # Validate: switching to routes_only requires at least one enabled route alias
    if body.model_policy == "routes_only" and claude_code_runner.count_route_aliases() == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="无法切换：当前没有任何已启用的路由别名。请先在网关配置中添加路由别名。",
        )
    try:
        updated = agents.update_agent(
            agent_id,
            name=body.name,
            status=body.status,
            owner_account_id=body.owner_account_id,
            storage_quota_mb=body.storage_quota_mb,
            model_policy=body.model_policy,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"agent": updated}


def _validate_profile_text_fields(body: WorkspaceProfileUpdate) -> None:
    validate_soul_content(body.soul)
    for label, text in (("paradigm", body.paradigm), ("standards", body.standards)):
        if len(text) > workspace_profile.PROFILE_TEXT_MAX:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{label} exceeds {workspace_profile.PROFILE_TEXT_MAX} character limit.",
            )
        hit = check_prompt_injection(text)
        if hit:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{label} contains disallowed prompt-injection pattern: '{hit}'.",
            )


@router.get("/agents/{agent_id}/profile")
async def get_workspace_profile(agent_id: str, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.read", "agent.write", "console.read", "console.write")
    agent = _load_agent_for_identity(agent_id, identity)
    return {"profile": workspace_profile.get_profile(workspace)}


@router.put("/agents/{agent_id}/profile")
async def update_workspace_profile(
    agent_id: str,
    body: WorkspaceProfileUpdate,
    identity: dict | None = Depends(require_console_read),
):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.write", "console.write")
    agent = _load_agent_for_identity(agent_id, identity)
    if not _is_admin(identity) and agent.get("owner_account_id") != _account_id(identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="only the owner can update agent profile")
    # Lock: template-bound agent profiles can only be modified by admin
    if agent.get("template_id") and not _is_admin(identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="该智能体使用模板初始化，身份信息不可在工作区修改。请联系管理员在后台管理修改。")
    _validate_profile_text_fields(body)
    try:
        profile = workspace_profile.save_profile(workspace, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"profile": profile}


@router.get("/agents/{agent_id}/serve/{file_path:path}")
async def serve_workspace_file(agent_id: str, file_path: str, identity: dict | None = Depends(require_console_read)):
    """Serve a static file from the agent directory (HTML, images, etc.)."""
    identity = _require_identity(identity)
    _load_agent_for_identity(agent_id, identity)

    agent = agents.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")

    root = agents.resolve_agent_path(agent)
    target = (root / file_path).resolve()
    workspace_root_resolved = root.resolve()
    source = root / file_path

    # Prevent path traversal but allow symlinked directory within workspace
    if not str(target).startswith(str(workspace_root_resolved)):
        # Check if any parent is a symlink
        has_sym = False
        p = source
        while p != workspace_root_resolved and p.parent != p:
            p = p.parent
            if p.is_symlink():
                has_sym = True
                break
        if not has_sym:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="access denied")

    if not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="file not found")

    # Determine MIME type
    suffix = target.suffix.lower()
    mime_map = {
        ".html": "text/html",
        ".htm": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".md": "text/markdown",
    }
    content_type = mime_map.get(suffix, "application/octet-stream")

    return FileResponse(target, media_type=content_type)


@router.get("/agents/{agent_id}/files")
async def read_workspace_file(
    agent_id: str,
    path: str,
    identity: dict | None = Depends(require_console_read),
):
    """Read a single text file inside a agent (path-guarded), for context preview."""
    identity = _require_identity(identity)
    _require_scope(identity, "agent.read", "agent.write", "console.read", "console.write")
    agent = _load_agent_for_identity(agent_id, identity)
    try:
        target = agents.resolve_agent_path(agent, path)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="file not found")
    max_bytes = 256 * 1024
    size = target.stat().st_size
    raw = target.read_bytes()[:max_bytes]
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="binary file preview not supported")
    return {
        "path": path,
        "size": size,
        "truncated": size > max_bytes,
        "content": content,
    }


@router.get("/agents/{agent_id}/file-index")
async def list_workspace_file_index(
    agent_id: str,
    include_dot: bool = False,
    limit: int = 400,
    subdir: str = "",
    prefix: str = "",
    identity: dict | None = Depends(require_console_read),
):
    """List agent files by relative path (no absolute server paths exposed)."""
    identity = _require_identity(identity)
    _require_scope(identity, "agent.read", "agent.write", "console.read", "console.write")
    agent = _load_agent_for_identity(agent_id, identity)
    try:
        payload = workspace_files.list_workspace_files(
            agent,
            include_dot=include_dot,
            limit=limit,
            subdir=subdir,
            prefix=prefix,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return payload


@router.post("/agents/{agent_id}/uploads")
async def upload_workspace_files(
    agent_id: str,
    files: list[UploadFile] = File(...),
    identity: dict | None = Depends(require_console_read),
):
    """Upload images/files into the agent uploads/ directory for agent runs."""
    identity = _require_identity(identity)
    _require_scope(identity, "agent.write", "console.write", "agent.run")
    agent = _load_agent_for_identity(agent_id, identity)
    if not agents.can_run_agent(agent, identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="upload is not allowed for this agent")
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no files provided")

    payload: list[tuple[str, bytes]] = []
    for item in files:
        name = (item.filename or "file").strip()
        content = await item.read()
        payload.append((name, content))

    try:
        saved = workspace_uploads.save_uploads(workspace, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return {"uploads": saved}


@router.post("/agents/{agent_id}/runs")
async def create_agent_run(agent_id: str, body: ClaudeAgentRunCreate, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "console.write")
    agent = _load_agent_for_identity(agent_id, identity)
    if not agents.can_run_agent(agent, identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="agent run is not allowed for this agent")

    account_id = _account_id(identity) or agent["owner_account_id"]
    max_active = int(os.environ.get("EVOTOWN_CLAUDE_MAX_ACTIVE_RUNS_PER_ACCOUNT", "2") or "2")
    if max_active > 0 and claude_agent_runs.active_run_count(account_id) >= max_active:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too many active hosted agent runs")

    attachment_paths = _normalize_attachment_paths(agent, list(body.attachments or []))

    profile = workspace_profile.get_profile(agent)
    run_skills = list(body.skills or []) or list(profile.get("default_skills") or [])
    run_model = claude_code_runner.resolve_run_model(body.model or profile.get("default_model") or "")
    runtime_engine = str(profile.get("runtime_engine") or "claude").strip().lower()

    run = claude_agent_runs.create_run(
        agent_id=agent_id,
        account_id=account_id,
        prompt=body.prompt,
        tenant_id=agent.get("tenant_id", ""),
        team_id=agent.get("team_id", ""),
        model=run_model,
        signals={
            "workspace_name": agent.get("name", ""),
            "selected_skills": run_skills,
            "previous_run_id": body.previous_run_id,
            "attachments": attachment_paths,
            "runtime_engine": runtime_engine,
        },
    )
    claude_code_runner.schedule_run(run["run_id"])
    return {"run": run}


@router.get("/agent-runs")
async def list_agent_runs(
    agent_id: str | None = None,
    status_filter: str | None = None,
    limit: int = 100,
    offset: int = 0,
    before: str | None = None,
    identity: dict | None = Depends(require_console_read),
):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "agent.read", "console.read", "console.write")
    if agent_id:
        _load_agent_for_identity(agent_id, identity)
    result = claude_agent_runs.list_runs(
        agent_id=agent_id,
        account_id=None if _is_admin(identity) else _account_id(identity),
        status=status_filter,
        limit=limit,
        offset=offset,
        before=before,
    )
    return result


@router.get("/agents/{agent_id}/sessions")
async def list_agent_sessions(agent_id: str, identity: dict | None = Depends(require_console_read)):
    """Return all conversation sessions for this agent (not paginated).

    Each session is a group of runs linked by ``previous_run_id``.
    """
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "agent.read", "console.read", "console.write")
    _load_agent_for_identity(agent_id, identity)

    # Fetch all runs to build accurate session groups (max 500 to cap cost)
    result = claude_agent_runs.list_runs(
        agent_id=agent_id,
        account_id=None if _is_admin(identity) else _account_id(identity),
        limit=500,
    )
    runs = result["runs"]
    groups = claude_agent_runs.build_session_groups(runs)

    sessions = []
    for root_id, run_ids in groups.items():
        chain = [r for r in runs if r["run_id"] in run_ids]
        chain.sort(key=lambda r: r["created_at"])
        first = chain[0]
        last = chain[-1]
        sessions.append({
            "id": root_id,
            "prompt": first.get("prompt", ""),
            "count": len(chain),
            "lastAt": last.get("created_at", ""),
            "lastStatus": last.get("status", ""),
        })
    sessions.sort(key=lambda s: s["lastAt"], reverse=True)
    return {"sessions": sessions}


@router.get("/agents/{agent_id}/sessions/{session_id}/runs")
async def list_session_runs(
    agent_id: str,
    session_id: str,
    limit: int = 10,
    asc: bool = False,
    before: str | None = None,
    after: str | None = None,
    identity: dict | None = Depends(require_console_read),
):
    """Return runs in a conversation session, paginated.

    Default: ``asc=false`` → newest first, ``before`` cursor pagination.
    ``asc=true`` → oldest first (starts from root), ``after`` cursor pagination.
    """
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "agent.read", "console.read", "console.write")
    _load_agent_for_identity(agent_id, identity)

    result = claude_agent_runs.list_runs(
        agent_id=agent_id,
        account_id=None if _is_admin(identity) else _account_id(identity),
        limit=500,
    )
    all_runs = result["runs"]
    run_ids_set = set(claude_agent_runs.session_run_ids(all_runs, session_id))
    if not run_ids_set:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")

    chain = [r for r in all_runs if r["run_id"] in run_ids_set]
    effective_limit = max(1, min(limit, 100))

    if asc:
        chain.sort(key=lambda r: r["created_at"])  # oldest first
        if after:
            chain = [r for r in chain if r["created_at"] > after]
    else:
        chain.sort(key=lambda r: r["created_at"], reverse=True)  # newest first
        if before:
            chain = [r for r in chain if r["created_at"] < before]

    has_more = len(chain) > effective_limit
    page = chain[:effective_limit]
    return {"runs": page, "has_more": has_more}


@router.get("/agent-runs/{run_id}")
async def get_agent_run(run_id: str, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "agent.read", "console.read", "console.write")
    run = claude_agent_runs.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    _load_agent_for_identity(run["agent_id"], identity)
    return {"run": run}


@router.get("/agent-runs/{run_id}/events")
async def list_agent_run_events(run_id: str, limit: int = 500, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "agent.read", "console.read", "console.write")
    run = claude_agent_runs.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    _load_agent_for_identity(run["agent_id"], identity)
    return {"events": claude_agent_runs.list_events(run_id, limit=limit)}


@router.get("/agent-runs/{run_id}/stream")
async def stream_agent_run_events(run_id: str, identity: dict | None = Depends(require_console_read)):
    """SSE stream of events for a run. Emits new events as they are persisted.

    When the run reaches a terminal status, a ``done`` event is sent and the
    stream closes.  EventSource clients reconnect automatically after short
    disconnections.
    """
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "agent.read", "console.read", "console.write")
    run = claude_agent_runs.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    _load_agent_for_identity(run["agent_id"], identity)

    async def event_generator():
        last_seq = 0
        while True:
            events = claude_agent_runs.list_events(run_id)
            for ev in events:
                if ev.get("seq", 0) > last_seq:
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                    last_seq = ev["seq"]

            current = claude_agent_runs.get_run(run_id)
            if current and current.get("status") in claude_agent_runs.TERMINAL_STATUSES:
                yield f"event: done\ndata: {json.dumps({'status': current['status']}, ensure_ascii=False)}\n\n"
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


@router.post("/agent-runs/{run_id}/cancel")
async def cancel_agent_run(run_id: str, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "console.write")
    run = claude_agent_runs.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    _load_agent_for_identity(run["agent_id"], identity)
    if not _is_admin(identity) and run.get("account_id") != _account_id(identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not allowed to cancel this run")
    updated = await claude_code_runner.cancel_run(run_id)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    return {"run": updated}


@router.delete("/agents/{agent_id}/sessions/{session_id}")
async def delete_workspace_session(
    agent_id: str,
    session_id: str,
    identity: dict | None = Depends(require_console_read),
):
    identity = _require_identity(identity)
    _require_scope(identity, "console.write", "agent.write")
    agent = _load_agent_for_identity(agent_id, identity)
    if not _is_admin(identity) and agent.get("owner_account_id") != _account_id(identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="only the agent owner can delete sessions")

    result = claude_agent_runs.list_runs(agent_id=agent_id, limit=500)
    runs = result["runs"]
    run_ids = claude_agent_runs.session_run_ids(runs, session_id)
    if not run_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")

    runs_by_id = {run["run_id"]: run for run in runs}
    for run_id in run_ids:
        run = runs_by_id.get(run_id)
        if run and run.get("status") in claude_agent_runs.RUNNING_STATUSES:
            await claude_code_runner.cancel_run(run_id)

    deleted = claude_agent_runs.delete_runs(run_ids)
    root = claude_agent_runs.resolve_session_root(runs, session_id) or session_id
    return {"session_id": root, "deleted_run_ids": deleted, "deleted_count": len(deleted)}
