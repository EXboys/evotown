"""Per-account skill assignment API (admin only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin
from infra import account_skills, accounts as accounts_store

router = APIRouter(prefix="/api/v1", tags=["account-skills"])


@router.get("/accounts/{account_id}/skills", dependencies=[Depends(require_admin)])
async def get_account_skills(account_id: str):
    if accounts_store.get_account(account_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    return {"account_id": account_id, "skills": account_skills.list_for_account(account_id)}


@router.put("/accounts/{account_id}/skills", dependencies=[Depends(require_admin)])
async def set_account_skills(account_id: str, body: dict):
    if accounts_store.get_account(account_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    skill_ids = list(body.get("skills") or [])
    account_skills.assign(account_id, skill_ids)
    return {"account_id": account_id, "skills": account_skills.list_for_account(account_id)}
