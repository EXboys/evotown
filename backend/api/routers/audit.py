"""Audit APIs — cross-store agent activity aggregation (#204)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin
from infra import agent_activity, mcp_registry

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])


@router.get("/agent-activity", dependencies=[Depends(require_admin)])
async def get_agent_activity_summary(
    from_ts: str | None = None,
    to_ts: str | None = None,
    org_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    return agent_activity.aggregate_by_account(
        from_ts=from_ts,
        to_ts=to_ts,
        org_id=org_id,
        limit=limit,
        offset=offset,
    )


@router.get("/agent-activity/runs", dependencies=[Depends(require_admin)])
async def get_agent_activity_runs(
    account_id: str,
    from_ts: str | None = None,
    to_ts: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    if not account_id.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="account_id required")
    return agent_activity.list_account_runs(
        account_id.strip(),
        from_ts=from_ts,
        to_ts=to_ts,
        limit=limit,
        offset=offset,
    )


@router.get("/agent-activity/timeline", dependencies=[Depends(require_admin)])
async def get_agent_activity_timeline(
    account_id: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    return agent_activity.build_timeline(
        account_id=account_id.strip() if account_id else None,
        from_ts=from_ts,
        to_ts=to_ts,
        limit=limit,
        offset=offset,
    )


@router.get("/agent-activity/mcp", dependencies=[Depends(require_admin)])
async def get_agent_activity_mcp_calls(run_id: str, limit: int = 100):
    if not run_id.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="run_id required")
    return {"run_id": run_id.strip(), "calls": mcp_registry.list_mcp_calls_for_run(run_id.strip(), limit=limit)}
