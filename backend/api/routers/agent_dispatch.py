"""Agent dispatch — center-to-engine tasks and engine-to-engine handoffs."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from core.auth import (
    EngineIngestAuth,
    assert_engine_ingest_scope,
    get_engine_ingest_auth,
    require_admin,
)
from domain.models import DispatchJobAck, DispatchJobComplete, DispatchJobCreate, EngineHeartbeat
from infra import agent_dispatch, engine_ingest

router = APIRouter(prefix="/api/v1", tags=["agent-dispatch"])


def _public_api_base(request: Request) -> str:
    explicit = os.environ.get("EVOTOWN_PUBLIC_URL", "").strip().rstrip("/")
    if explicit:
        return f"{explicit}/api/v1"
    return str(request.base_url).rstrip("/") + "/api/v1"


@router.post("/engines/{engine_id}/heartbeat")
async def engine_heartbeat(
    engine_id: str,
    body: EngineHeartbeat,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    assert_engine_ingest_scope(auth, engine_id)
    engine = agent_dispatch.record_heartbeat(engine_id, body)
    if engine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="engine not registered")
    return {"ok": True, "engine": engine}


@router.get("/engines/fleet", dependencies=[Depends(require_admin)])
async def fleet_engines(limit: int = 200):
    return {"engines": agent_dispatch.list_engines_fleet(limit=limit)}


@router.post("/jobs", dependencies=[Depends(require_admin)])
async def create_job_admin(body: DispatchJobCreate):
    try:
        job = agent_dispatch.create_job(body, source_type="control_plane")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"job": job}


@router.post("/jobs/from-engine")
async def create_job_from_engine(
    body: DispatchJobCreate,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    if not body.source_engine_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="source_engine_id is required for engine-originated jobs",
        )
    assert_engine_ingest_scope(auth, body.source_engine_id)
    if engine_ingest.get_engine(body.source_engine_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"source engine '{body.source_engine_id}' is not registered",
        )
    try:
        job = agent_dispatch.create_job(
            body,
            source_type="engine",
            source_engine_id=body.source_engine_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {"job": job}


@router.get("/jobs", dependencies=[Depends(require_admin)])
async def list_jobs(
    status_filter: str | None = None,
    target_engine_id: str | None = None,
    limit: int = 100,
):
    return {
        "jobs": agent_dispatch.list_jobs(
            status=status_filter,
            target_engine_id=target_engine_id,
            limit=limit,
        )
    }


@router.get("/jobs/lease")
async def lease_job_endpoint(
    request: Request,
    engine_id: str,
    timeout: int = 0,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    assert_engine_ingest_scope(auth, engine_id)
    if engine_ingest.get_engine(engine_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="engine not registered")
    leased = agent_dispatch.lease_job_wait(engine_id, timeout_sec=timeout)
    if leased is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    leased["callback_base"] = _public_api_base(request)
    return leased


@router.get("/runs/lease")
async def lease_run_compat(
    request: Request,
    engine_id: str,
    timeout: int = 0,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    return await lease_job_endpoint(request, engine_id, timeout, auth)


@router.get("/jobs/{job_id}", dependencies=[Depends(require_admin)])
async def get_job(job_id: str):
    job = agent_dispatch.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    return {"job": job}


@router.post("/jobs/{job_id}/cancel", dependencies=[Depends(require_admin)])
async def cancel_job(job_id: str, reason: str = ""):
    job = agent_dispatch.cancel_job(job_id, reason=reason)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    return {"job": job}


@router.post("/jobs/{job_id}/ack")
async def ack_job(
    job_id: str,
    body: DispatchJobAck,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    assert_engine_ingest_scope(auth, body.engine_id)
    if engine_ingest.get_engine(body.engine_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="engine not registered")
    job = agent_dispatch.ack_job(job_id, body)
    if job is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="cannot ack job")
    return {"job": job}


@router.post("/jobs/{job_id}/complete")
async def complete_job(
    job_id: str,
    body: DispatchJobComplete,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    assert_engine_ingest_scope(auth, body.engine_id)
    if engine_ingest.get_engine(body.engine_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="engine not registered")
    job, follow_up = agent_dispatch.complete_job(job_id, body)
    if job is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="cannot complete job")
    out: dict = {"job": job}
    if follow_up:
        out["follow_up_job"] = follow_up
    return out
