"""External engine ingest API."""
from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import (
    EngineIngestAuth,
    assert_engine_ingest_scope,
    get_engine_ingest_auth,
    require_admin,
    require_engine_ingest_global,
    require_engine_register,
)
from domain.models import EngineRegister, PolicyViolationIngest, RunComplete, RunEventIngest
from infra import engine_ingest

router = APIRouter(prefix="/api/v1", tags=["engine-ingest"])


@router.post("/engines/register", dependencies=[Depends(require_engine_register)])
async def register_engine(body: EngineRegister):
    engine, issued = engine_ingest.register_engine(body)
    out: dict = {"registered": True, "engine": engine}
    if issued:
        out["ingest_token"] = issued
        out["ingest_token_warning"] = "Store ingest_token as EVOTOWN_ENGINE_INGEST_TOKEN on this machine; shown once."
    return out


@router.post("/engines/{engine_id}/rotate-ingest-token", dependencies=[Depends(require_admin)])
async def rotate_engine_ingest_token(engine_id: str):
    if engine_ingest.get_engine(engine_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="engine not found")
    token = engine_ingest.issue_ingest_token(engine_id)
    return {
        "engine_id": engine_id,
        "ingest_token": token,
        "ingest_token_warning": "Shown once. Update the employee machine EVOTOWN_ENGINE_INGEST_TOKEN.",
    }


@router.get("/engines", dependencies=[Depends(require_admin)])
async def list_engines(limit: int = 100):
    return {"engines": engine_ingest.list_engines(limit=limit)}


@router.post("/runs/{run_id}/complete")
async def complete_run(
    run_id: str,
    body: RunComplete,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    assert_engine_ingest_scope(auth, body.engine_id)
    engine = engine_ingest.get_engine(body.engine_id)
    if engine is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"engine_id '{body.engine_id}' is not registered",
        )
    run, created = engine_ingest.complete_run(run_id, body)
    if not created:
        return {"accepted": True, "idempotent": True, "run_id": run_id, "run": run}
    return {"accepted": True, "idempotent": False, "run_id": run_id, "run": run}


@router.get("/runs", dependencies=[Depends(require_admin)])
async def list_runs(engine_id: str | None = None, limit: int = 100):
    return {"runs": engine_ingest.list_runs(engine_id=engine_id, limit=limit)}


@router.get("/runs/{run_id}/status")
async def get_run_status_for_engine(
    run_id: str,
    engine_id: str,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    """Connector polls run terminal state without admin token."""
    assert_engine_ingest_scope(auth, engine_id)
    run = engine_ingest.get_run(run_id)
    if run is None or run.get("engine_id") != engine_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    return {
        "run_id": run_id,
        "engine_id": run["engine_id"],
        "status": run.get("status", "running"),
        "exit_code": run.get("exit_code", 0),
        "log_excerpt": run.get("log_excerpt", ""),
        "signals": run.get("signals") or {},
        "finished_at": run.get("finished_at", ""),
    }


@router.get("/runs/{run_id}", dependencies=[Depends(require_admin)])
async def get_run(run_id: str):
    run = engine_ingest.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    return run


@router.post("/events")
async def append_event(
    body: RunEventIngest,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    assert_engine_ingest_scope(auth, body.engine_id)
    engine = engine_ingest.get_engine(body.engine_id)
    if engine is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"engine_id '{body.engine_id}' is not registered",
        )
    run = None
    if body.event_type in {"run.started", "run.progress", "run.completed"}:
        run = engine_ingest.upsert_run_from_event(body, engine)
    elif engine_ingest.get_run(body.run_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="run not found")
    event = engine_ingest.append_event(body)
    return {"accepted": True, "event": event, "run": run}


@router.post("/runs/{run_id}/events")
async def append_run_event(
    run_id: str,
    body: RunEventIngest,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    if body.run_id != run_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="run_id mismatch")
    return await append_event(body, auth)


@router.get("/runs/{run_id}/events", dependencies=[Depends(require_admin)])
async def list_run_events(run_id: str, limit: int = 500):
    if engine_ingest.get_run(run_id) is None and not engine_ingest.list_events(run_id=run_id, limit=1):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    return {"events": engine_ingest.list_events(run_id=run_id, limit=limit)}


@router.post("/policy/violations")
async def append_policy_violation(
    body: PolicyViolationIngest,
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
):
    assert_engine_ingest_scope(auth, body.engine_id)
    if engine_ingest.get_run(body.run_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="run not found")
    violation = engine_ingest.append_policy_violation(body)
    return {"accepted": True, "violation": violation}


@router.get("/policy/violations", dependencies=[Depends(require_admin)])
async def list_policy_violations(
    run_id: str | None = None,
    engine_id: str | None = None,
    status_filter: str | None = None,
    limit: int = 200,
):
    return {
        "violations": engine_ingest.list_policy_violations(
            run_id=run_id,
            engine_id=engine_id,
            status=status_filter,
            limit=limit,
        )
    }


@router.get("/costs/summary", dependencies=[Depends(require_admin)])
async def cost_summary():
    return engine_ingest.cost_summary()
