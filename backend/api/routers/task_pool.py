"""Task pool API router — CRUD + atomic claim.

Auth:
  - Create (portal)    : open (employee submits)
  - Create (MCP)       : via MCP bridge (internal call)
  - List/Get/Update    : admin only
  - Claim              : X-Task-Pool-Key header (shared secret for Hermes)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel, Field

from infra import task_pool
from core.auth import require_admin, get_optional_admin_identity

router = APIRouter(prefix="/api/v1/tasks", tags=["task-pool"])


# ── Pydantic models ─────────────────────────────────────────────────

class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    description: str = ""
    submitter_type: str = "employee"
    submitter_id: str = ""
    source: str = task_pool.SOURCE_PORTAL
    target_agent_id: str | None = None
    priority: int = 0


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: int | None = None
    tags: list[str] | None = None
    requirement: str | None = None
    plan: str | None = None
    result: str | None = None
    target_agent_id: str | None = None


class ClaimRequest(BaseModel):
    claimer_type: str = Field(min_length=1, max_length=32)
    claimer_id: str = ""
    claim_mode: str = task_pool.CLAIM_MODE_EXECUTE


# ── Public: create task ─────────────────────────────────────────────


@router.post("")
async def create_task(
    body: TaskCreate,
    identity: dict | None = Depends(get_optional_admin_identity),
):
    """Submit a new task to the pool. Open to all, but captures authenticated submitter when available."""
    submitter_type = body.submitter_type
    submitter_id = body.submitter_id

    # When authenticated user creates task and frontend didn't explicitly set submitter,
    # use the authenticated identity as submitter
    if identity and not body.submitter_id:
        submitter_type = identity["submitter_type"]
        submitter_id = identity["submitter_id"]

    try:
        t = task_pool.create_task(
            title=body.title,
            description=body.description,
            submitter_type=submitter_type,
            submitter_id=submitter_id,
            source=body.source,
            target_agent_id=body.target_agent_id,
            priority=body.priority,
        )
        return {"ok": True, "task": t}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Admin: list / get / update ──────────────────────────────────────


@router.get("", dependencies=[Depends(require_admin)])
async def list_tasks(
    status: str | None = Query(None),
    submitter_type: str | None = Query(None),
    source: str | None = Query(None),
    assignee_type: str | None = Query(None),
    target_agent_id: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    total = task_pool.count_tasks(
        status=status,
        submitter_type=submitter_type,
        source=source,
        assignee_type=assignee_type,
        target_agent_id=target_agent_id,
    )
    tasks = task_pool.list_tasks(
        status=status,
        submitter_type=submitter_type,
        source=source,
        assignee_type=assignee_type,
        target_agent_id=target_agent_id,
        limit=limit,
        offset=offset,
    )
    return {"tasks": tasks, "total": total}


@router.get("/{task_id}", dependencies=[Depends(require_admin)])
async def get_task(task_id: str):
    t = task_pool.get_task(task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    return t


@router.patch("/{task_id}", dependencies=[Depends(require_admin)])
async def update_task(task_id: str, body: TaskUpdate):
    """Admin: update task fields (tags, priority, requirement, status, etc.)."""
    try:
        t = task_pool.update_task(
            task_id,
            title=body.title,
            description=body.description,
            status=body.status,
            priority=body.priority,
            tags=body.tags,
            requirement=body.requirement,
            plan=body.plan,
            result=body.result,
            target_agent_id=body.target_agent_id,
        )
        if not t:
            raise HTTPException(404, "Task not found")
        return {"ok": True, "task": t}
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Claim endpoint (Hermes / Agent) ─────────────────────────────────


def _verify_claim_auth(x_task_pool_key: str | None = Header(None)) -> None:
    """Verify shared secret for claim endpoint."""
    import os
    expected = os.environ.get("EVOTOWN_TASK_POOL_KEY", "").strip()
    if not expected:
        raise HTTPException(500, "EVOTOWN_TASK_POOL_KEY not configured on server")
    if not x_task_pool_key or x_task_pool_key != expected:
        raise HTTPException(401, "Invalid task pool key")


@router.post("/claim")
async def claim_task(
    body: ClaimRequest,
    x_task_pool_key: str | None = Header(None, alias="X-Task-Pool-Key"),
):
    """Atomically claim a task.

    claim_mode='execute': claim approved → in_progress (Hermes global mutex applies).
    claim_mode='pre_review': claim pending → pre_review (no mutex, agents pre-review in parallel).
    """
    _verify_claim_auth(x_task_pool_key)

    if body.claimer_type not in (task_pool.CLAIMER_HERMES, task_pool.CLAIMER_EVOTOWN_AGENT):
        raise HTTPException(400, f"Invalid claimer_type: {body.claimer_type}")

    if body.claim_mode not in (task_pool.CLAIM_MODE_EXECUTE, task_pool.CLAIM_MODE_PRE_REVIEW):
        raise HTTPException(400, f"Invalid claim_mode: {body.claim_mode}")

    # Hermes uses fixed id 'sysadmin'
    claimer_id = body.claimer_id if body.claimer_type == task_pool.CLAIMER_EVOTOWN_AGENT else "sysadmin"

    t = task_pool.claim_task(body.claimer_type, claimer_id, body.claim_mode)
    if not t:
        return {"ok": True, "task": None, "message": "No available task"}
    return {"ok": True, "task": t}


@router.post("/{task_id}/complete")
async def complete_task(
    task_id: str,
    result: str = "",
    x_task_pool_key: str | None = Header(None, alias="X-Task-Pool-Key"),
):
    """Mark a task as completed. Requires task pool key auth."""
    _verify_claim_auth(x_task_pool_key)
    t = task_pool.complete_task(task_id, result)
    if not t:
        raise HTTPException(404, "Task not found")
    return {"ok": True, "task": t}


@router.post("/{task_id}/fail")
async def fail_task(
    task_id: str,
    result: str = "",
    x_task_pool_key: str | None = Header(None, alias="X-Task-Pool-Key"),
):
    """Mark a task as failed (agent execution failed). Requires task pool key auth."""
    _verify_claim_auth(x_task_pool_key)
    t = task_pool.fail_task(task_id, result)
    if not t:
        raise HTTPException(404, "Task not found")
    return {"ok": True, "task": t}


@router.post("/{task_id}/release")
async def release_task(
    task_id: str,
    x_task_pool_key: str | None = Header(None, alias="X-Task-Pool-Key"),
):
    """Release a task back to approved (e.g., on error)."""
    _verify_claim_auth(x_task_pool_key)
    t = task_pool.release_task(task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    return {"ok": True, "task": t}


class PlanUpdate(BaseModel):
    plan: str = ""


@router.patch("/{task_id}/plan")
async def update_plan(
    task_id: str,
    body: PlanUpdate,
    x_task_pool_key: str | None = Header(None, alias="X-Task-Pool-Key"),
):
    """Agent writes pre-review plan (request body, no URL length limit). Task pool key auth."""
    _verify_claim_auth(x_task_pool_key)
    t = task_pool.update_task(task_id, plan=body.plan, status=task_pool.STATUS_PRE_REVIEW)
    if not t:
        raise HTTPException(404, "Task not found")
    return {"ok": True, "task": t}
