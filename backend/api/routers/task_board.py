"""Task board API — Kanban view over unified task_nodes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_console_read
from infra import agents, task_nodes

router = APIRouter(prefix="/api/v1", tags=["task-board"])


def _require_identity(identity: dict | None) -> dict:
    if identity is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="console authentication required")
    return identity


def _is_admin(identity: dict) -> bool:
    scopes = identity.get("scopes") or []
    return "*" in scopes or "console.write" in scopes


@router.get("/task-board")
async def get_task_board(
    agent_id: str = "",
    limit: int = 200,
    identity: dict | None = Depends(require_console_read),
):
    """Return task nodes grouped by board status (queued / running / done / failed)."""
    identity = _require_identity(identity)
    effective_agent_id = agent_id.strip()

    if effective_agent_id:
        agent = agents.get_agent(effective_agent_id)
        if agent is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
        if not agents.can_access_agent(agent, identity):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="agent access denied")

    columns = task_nodes.list_board(agent_id=effective_agent_id or None, limit=limit)
    total = sum(len(items) for items in columns.values())
    return {
        "agent_id": effective_agent_id,
        "columns": columns,
        "total": total,
        "board_statuses": list(task_nodes.BOARD_STATUSES),
    }
