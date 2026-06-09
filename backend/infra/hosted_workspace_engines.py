"""Fleet engine records for centrally hosted Coding Agent workspaces."""
from __future__ import annotations

from typing import Any

from domain.models import EngineRegister
from infra import engine_ingest, workspaces

HOSTED_ENGINE_PREFIX = "hosted-ws-"
HOSTED_ENGINE_VERSION = "evotown-hosted-1"


def engine_id_for_workspace(workspace_id: str) -> str:
    return f"{HOSTED_ENGINE_PREFIX}{workspace_id}"


def workspace_id_from_engine(engine_id: str) -> str | None:
    if not engine_id.startswith(HOSTED_ENGINE_PREFIX):
        return None
    workspace_id = engine_id[len(HOSTED_ENGINE_PREFIX):]
    return workspace_id or None


def is_hosted_engine(engine_id: str) -> bool:
    return bool(engine_id) and engine_id.startswith(HOSTED_ENGINE_PREFIX)


def register_workspace_engine(workspace: dict[str, Any]) -> dict[str, Any]:
    """Upsert a fleet engine row for a coding workspace (no ingest token issued)."""
    workspace_id = str(workspace.get("workspace_id") or "")
    if not workspace_id:
        raise ValueError("workspace_id is required")
    engine_id = engine_id_for_workspace(workspace_id)
    body = EngineRegister(
        engine_id=engine_id,
        engine_version=HOSTED_ENGINE_VERSION,
        engine_type="hosted_coding",
        display_name=str(workspace.get("name") or engine_id),
        owner_team=str(workspace.get("team_id") or ""),
        deployment_kind="container",
        capabilities={
            "hosted": True,
            "workspace_id": workspace_id,
            "owner_account_id": str(workspace.get("owner_account_id") or ""),
            "workspace_status": str(workspace.get("status") or workspaces.WORKSPACE_STATUS_ACTIVE),
        },
    )
    engine, _ = engine_ingest.upsert_engine(body, issue_token=False)
    return engine_ingest.get_engine(engine_id) or engine


def sync_workspace_engine(workspace: dict[str, Any] | None) -> dict[str, Any] | None:
    if workspace is None:
        return None
    return register_workspace_engine(workspace)


def sync_all_active_workspaces(limit: int = 5000) -> int:
    """Register fleet engines for all active workspaces (startup / migration)."""
    count = 0
    for workspace in workspaces.list_workspaces(status=workspaces.WORKSPACE_STATUS_ACTIVE, limit=limit):
        register_workspace_engine(workspace)
        count += 1
    return count


def hosted_workspace_available(engine_id: str) -> bool:
    workspace_id = workspace_id_from_engine(engine_id)
    if not workspace_id:
        return False
    workspace = workspaces.get_workspace(workspace_id)
    return workspace is not None and workspace.get("status") == workspaces.WORKSPACE_STATUS_ACTIVE
