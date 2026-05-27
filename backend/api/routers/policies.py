"""Enterprise policy API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin, require_admin_or_ingest
from domain.models import PoliciesReplace, PolicyEvaluateRequest, PolicyUpsert
from domain.policy.types import EvaluationContext
from infra import policies
from infra import policy_engine

router = APIRouter(prefix="/api/v1", tags=["policies"])


@router.get("/policies", dependencies=[Depends(require_admin_or_ingest)])
async def get_policies(enabled_only: bool = False):
    return policies.list_policies(enabled_only=enabled_only)


@router.post("/policy/evaluate", dependencies=[Depends(require_admin_or_ingest)])
async def evaluate_policy(body: PolicyEvaluateRequest):
    """Connector/runtime checks an action before execution or upload."""
    evaluation = policy_engine.evaluate_context(
        EvaluationContext(
            kind=body.kind,
            resource=body.resource,
            run_id=body.run_id,
            engine_id=body.engine_id,
            workspace_roots=body.workspace_roots,
            extra=body.extra,
        )
    )
    if body.run_id and body.engine_id and evaluation.hits:
        policy_engine.record_violations(evaluation, run_id=body.run_id, engine_id=body.engine_id)
    return evaluation.to_dict()


@router.put("/policies", dependencies=[Depends(require_admin)])
async def replace_policies(body: PoliciesReplace):
    payload = [item.model_dump() for item in body.policies]
    return policies.replace_policies(payload)


@router.put("/policies/{policy_id}", dependencies=[Depends(require_admin)])
async def upsert_policy(policy_id: str, body: PolicyUpsert):
    if body.policy_id != policy_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="policy_id mismatch")
    try:
        return {"policy": policies.upsert_policy(body.model_dump())}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
