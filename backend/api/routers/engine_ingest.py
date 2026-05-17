"""External engine ingest API."""
from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_engine_ingest
from domain.models import EngineRegister, PolicyViolationIngest, RunComplete, RunEventIngest
from infra import engine_ingest

router = APIRouter(prefix="/api/v1", tags=["engine-ingest"])


@router.post("/engines/register", dependencies=[Depends(require_engine_ingest)])
async def register_engine(body: EngineRegister):
    engine = engine_ingest.register_engine(body)
    return {"registered": True, "engine": engine}


@router.get("/engines")
async def list_engines(limit: int = 100):
    return {"engines": engine_ingest.list_engines(limit=limit)}


@router.post("/runs/{run_id}/complete", dependencies=[Depends(require_engine_ingest)])
async def complete_run(run_id: str, body: RunComplete):
    engine = engine_ingest.get_engine(body.engine_id)
    if engine is None:
        # Accepting unknown engines would weaken provenance. Register first.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"engine_id '{body.engine_id}' is not registered",
        )
    run, created = engine_ingest.complete_run(run_id, body)
    if not created:
        return {"accepted": True, "idempotent": True, "run_id": run_id, "run": run}
    return {"accepted": True, "idempotent": False, "run_id": run_id, "run": run}


@router.get("/runs")
async def list_runs(engine_id: str | None = None, limit: int = 100):
    return {"runs": engine_ingest.list_runs(engine_id=engine_id, limit=limit)}


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    run = engine_ingest.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    return run


@router.post("/events", dependencies=[Depends(require_engine_ingest)])
async def append_event(body: RunEventIngest):
    if engine_ingest.get_run(body.run_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="run not found")
    event = engine_ingest.append_event(body)
    return {"accepted": True, "event": event}


@router.get("/runs/{run_id}/events")
async def list_run_events(run_id: str, limit: int = 500):
    if engine_ingest.get_run(run_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    return {"events": engine_ingest.list_events(run_id=run_id, limit=limit)}


@router.post("/policy/violations", dependencies=[Depends(require_engine_ingest)])
async def append_policy_violation(body: PolicyViolationIngest):
    if engine_ingest.get_run(body.run_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="run not found")
    violation = engine_ingest.append_policy_violation(body)
    return {"accepted": True, "violation": violation}


@router.get("/policy/violations")
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


@router.get("/costs/summary")
async def cost_summary():
    return engine_ingest.cost_summary()

