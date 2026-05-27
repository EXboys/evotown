"""Enterprise policy API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin, require_admin_or_ingest
from domain.models import PoliciesReplace, PolicyUpsert
from infra import policies

router = APIRouter(prefix="/api/v1", tags=["policies"])


@router.get("/policies", dependencies=[Depends(require_admin_or_ingest)])
async def get_policies(enabled_only: bool = False):
    return policies.list_policies(enabled_only=enabled_only)


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
