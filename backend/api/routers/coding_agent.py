"""Centrally hosted Claude Coding Agent workspaces and runs."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from core.auth import require_console_read
from domain.models import ClaudeAgentRunCreate, WorkspaceCreate, WorkspaceUpdate
from infra import claude_agent_runs, workspaces
from services import claude_code_runner

router = APIRouter(prefix="/api/v1", tags=["coding-agent"])

_FALLBACK_MODELS = [
    {"id": "claude-sonnet-4", "label": "Claude Sonnet 4", "provider": "Anthropic"},
    {"id": "claude-opus-4", "label": "Claude Opus 4", "provider": "Anthropic"},
    {"id": "claude-haiku-4", "label": "Claude Haiku 4", "provider": "Anthropic"},
]


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


def _load_workspace_for_identity(workspace_id: str, identity: dict) -> dict:
    workspace = workspaces.get_workspace(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workspace not found")
    if not workspaces.can_access_workspace(workspace, identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="workspace access denied")
    return workspace


@router.get("/coding-agent/options")
async def get_coding_agent_options(identity: dict | None = Depends(require_console_read)):
    """User-readable catalog of models, skills and MCP plugins for the workbench."""
    identity = _require_identity(identity)
    _require_scope(identity, "workspace.read", "workspace.write", "console.read", "console.write")

    models: list[dict] = []
    seen: set[str] = set()
    try:
        from infra import gateway_routes, gateway_models

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
        for model in gateway_models.list_models(enabled_only=True):
            name = str(model.get("model_name") or "").strip()
            if name and name not in seen:
                seen.add(name)
                models.append(
                    {
                        "id": name,
                        "label": name,
                        "provider": model.get("provider_label") or "Upstream",
                        "target": model.get("litellm_model", ""),
                    }
                )
    except Exception:
        models = []
    if not models:
        models = list(_FALLBACK_MODELS)

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

    databases: list[dict] = []
    try:
        from infra import database_registry

        if _is_admin(identity):
            conns = database_registry.list_connections(status="active")
        else:
            conns = database_registry.list_accessible_connections(identity)
        for conn in conns:
            databases.append(
                {
                    "id": conn.get("connection_id", ""),
                    "name": conn.get("name", ""),
                    "db_type": conn.get("db_type", ""),
                    "access_mode": conn.get("access_mode", ""),
                }
            )
    except Exception:
        databases = []

    return {
        "models": models,
        "default_model": models[0]["id"] if models else claude_code_runner.DEFAULT_MODEL,
        "skills": skills,
        "mcp": databases,
    }


@router.get("/workspaces")
async def list_workspaces(
    include_all: bool = False,
    status_filter: str | None = "active",
    limit: int = 100,
    identity: dict | None = Depends(require_console_read),
):
    identity = _require_identity(identity)
    _require_scope(identity, "workspace.read", "workspace.write", "console.read", "console.write")
    owner = None if include_all and _is_admin(identity) else _account_id(identity)
    if not owner and not _is_admin(identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account-bound session required")
    return {
        "workspaces": workspaces.list_workspaces(owner_account_id=owner, status=status_filter, limit=limit),
        "viewer": {"is_admin": _is_admin(identity), "account_id": _account_id(identity)},
    }


@router.post("/workspaces")
async def create_workspace(body: WorkspaceCreate, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "workspace.write", "console.write")
    owner = body.owner_account_id.strip() if _is_admin(identity) and body.owner_account_id.strip() else _account_id(identity)
    if not owner:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="owner_account_id is required when using admin token",
        )
    try:
        workspace = workspaces.create_workspace(
            owner_account_id=owner,
            name=body.name,
            tenant_id=body.tenant_id or str(identity.get("org_id") or ""),
            team_id=body.team_id or str(identity.get("team_id") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"workspace": workspace}


@router.get("/workspaces/{workspace_id}")
async def get_workspace(workspace_id: str, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "workspace.read", "workspace.write", "console.read", "console.write")
    workspace = _load_workspace_for_identity(workspace_id, identity)
    runs = claude_agent_runs.list_runs(
        workspace_id=workspace_id,
        account_id=None if _is_admin(identity) else _account_id(identity),
        limit=20,
    )
    return {
        "workspace": {**workspace, "usage_bytes": workspaces.workspace_usage_bytes(workspace)},
        "runs": runs,
        "viewer": {"is_admin": _is_admin(identity), "account_id": _account_id(identity)},
    }


@router.patch("/workspaces/{workspace_id}")
async def update_workspace(workspace_id: str, body: WorkspaceUpdate, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "workspace.write", "console.write")
    workspace = _load_workspace_for_identity(workspace_id, identity)
    if not _is_admin(identity) and workspace.get("owner_account_id") != _account_id(identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="only the owner can update workspace")
    if body.owner_account_id is not None and not _is_admin(identity):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="only an admin can reassign the workspace owner",
        )
    try:
        updated = workspaces.update_workspace(
            workspace_id,
            name=body.name,
            status=body.status,
            owner_account_id=body.owner_account_id,
            storage_quota_mb=body.storage_quota_mb,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"workspace": updated}


@router.get("/workspaces/{workspace_id}/serve/{file_path:path}")
async def serve_workspace_file(workspace_id: str, file_path: str, identity: dict | None = Depends(require_console_read)):
    """Serve a static file from the workspace directory (HTML, images, etc.)."""
    identity = _require_identity(identity)
    _load_workspace_for_identity(workspace_id, identity)

    workspace = workspaces.get_workspace(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="workspace not found")

    root = workspaces.resolve_workspace_path(workspace)
    target = (root / file_path).resolve()

    # Prevent path traversal
    if not str(target).startswith(str(root.resolve())):
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


@router.get("/workspaces/{workspace_id}/files")
async def read_workspace_file(
    workspace_id: str,
    path: str,
    identity: dict | None = Depends(require_console_read),
):
    """Read a single text file inside a workspace (path-guarded), for context preview."""
    identity = _require_identity(identity)
    _require_scope(identity, "workspace.read", "workspace.write", "console.read", "console.write")
    workspace = _load_workspace_for_identity(workspace_id, identity)
    try:
        target = workspaces.resolve_workspace_path(workspace, path)
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


@router.post("/workspaces/{workspace_id}/runs")
async def create_agent_run(workspace_id: str, body: ClaudeAgentRunCreate, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "console.write")
    workspace = _load_workspace_for_identity(workspace_id, identity)
    if not workspaces.can_run_workspace(workspace, identity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="agent run is not allowed for this workspace")

    account_id = _account_id(identity) or workspace["owner_account_id"]
    max_active = int(os.environ.get("EVOTOWN_CLAUDE_MAX_ACTIVE_RUNS_PER_ACCOUNT", "2") or "2")
    if max_active > 0 and claude_agent_runs.active_run_count(account_id) >= max_active:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too many active hosted agent runs")

    run = claude_agent_runs.create_run(
        workspace_id=workspace_id,
        account_id=account_id,
        prompt=body.prompt,
        tenant_id=workspace.get("tenant_id", ""),
        team_id=workspace.get("team_id", ""),
        model=body.model or os.environ.get("EVOTOWN_CLAUDE_MODEL", claude_code_runner.DEFAULT_MODEL),
        signals={
            "workspace_name": workspace.get("name", ""),
            "selected_skills": list(body.skills or []),
            "selected_mcp": list(body.mcp or []),
            "previous_run_id": body.previous_run_id,
        },
    )
    claude_code_runner.schedule_run(run["run_id"])
    return {"run": run}


@router.get("/agent-runs")
async def list_agent_runs(
    workspace_id: str | None = None,
    status_filter: str | None = None,
    limit: int = 100,
    identity: dict | None = Depends(require_console_read),
):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "workspace.read", "console.read", "console.write")
    if workspace_id:
        _load_workspace_for_identity(workspace_id, identity)
    return {
        "runs": claude_agent_runs.list_runs(
            workspace_id=workspace_id,
            account_id=None if _is_admin(identity) else _account_id(identity),
            status=status_filter,
            limit=limit,
        )
    }


@router.get("/agent-runs/{run_id}")
async def get_agent_run(run_id: str, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "workspace.read", "console.read", "console.write")
    run = claude_agent_runs.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    _load_workspace_for_identity(run["workspace_id"], identity)
    return {"run": run}


@router.get("/agent-runs/{run_id}/events")
async def list_agent_run_events(run_id: str, limit: int = 500, identity: dict | None = Depends(require_console_read)):
    identity = _require_identity(identity)
    _require_scope(identity, "agent.run", "workspace.read", "console.read", "console.write")
    run = claude_agent_runs.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    _load_workspace_for_identity(run["workspace_id"], identity)
    return {"events": claude_agent_runs.list_events(run_id, limit=limit)}
