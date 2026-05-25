"""Gateway account and API key management (admin)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin
from domain.models import GatewayAccountCreate, GatewayAccountUpdate, GatewayApiKeyCreate
from infra import accounts as accounts_store

router = APIRouter(prefix="/api/v1", tags=["accounts"])


def _enrich_account(account: dict) -> dict:
    counts = accounts_store.account_key_counts([account["account_id"]])
    stats = counts.get(account["account_id"], {"active_keys": 0, "total_keys": 0})
    return {**account, **stats}


@router.post("/accounts", dependencies=[Depends(require_admin)])
async def create_account(body: GatewayAccountCreate):
    account = accounts_store.create_account(
        name=body.name,
        team_id=body.team_id,
        owner_email=body.owner_email,
        notes=body.notes,
    )
    return {"account": _enrich_account(account)}


@router.get("/accounts")
async def list_accounts(status_filter: str | None = None, limit: int = 100):
    items = accounts_store.list_accounts(status=status_filter, limit=limit)
    counts = accounts_store.account_key_counts([a["account_id"] for a in items])
    return {
        "accounts": [
            {**a, **counts.get(a["account_id"], {"active_keys": 0, "total_keys": 0})}
            for a in items
        ]
    }


@router.get("/accounts/{account_id}")
async def get_account(account_id: str):
    account = accounts_store.get_account(account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    return {"account": _enrich_account(account)}


@router.patch("/accounts/{account_id}", dependencies=[Depends(require_admin)])
async def update_account(account_id: str, body: GatewayAccountUpdate):
    if accounts_store.get_account(account_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    account = accounts_store.update_account(
        account_id,
        name=body.name,
        team_id=body.team_id,
        owner_email=body.owner_email,
        status=body.status,
        notes=body.notes,
    )
    return {"account": _enrich_account(account or {})}


@router.get("/accounts/{account_id}/keys")
async def list_account_keys(account_id: str, status_filter: str | None = None, limit: int = 200):
    if accounts_store.get_account(account_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    return {
        "keys": accounts_store.list_api_keys(
            account_id=account_id,
            status=status_filter,
            limit=limit,
        )
    }


@router.post("/accounts/{account_id}/keys", dependencies=[Depends(require_admin)])
async def create_account_key(account_id: str, body: GatewayApiKeyCreate):
    try:
        key_record, secret = accounts_store.create_api_key(
            account_id,
            label=body.label,
            scopes=body.scopes,
            expires_at=body.expires_at,
        )
    except ValueError as exc:
        detail = str(exc)
        code = status.HTTP_404_NOT_FOUND if "not found" in detail else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=detail) from exc
    return {
        "key": key_record,
        "secret": secret,
        "warning": "Store this secret now. It will not be shown again.",
    }


@router.get("/keys")
async def list_all_keys(account_id: str | None = None, status_filter: str | None = None, limit: int = 200):
    return {
        "keys": accounts_store.list_api_keys(
            account_id=account_id,
            status=status_filter,
            limit=limit,
        )
    }


@router.post("/keys/{key_id}/revoke", dependencies=[Depends(require_admin)])
async def revoke_key(key_id: str):
    key = accounts_store.get_api_key(key_id)
    if key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="key not found")
    if key.get("status") == "revoked":
        return {"revoked": True, "key": key}
    revoked = accounts_store.revoke_api_key(key_id)
    return {"revoked": True, "key": revoked}
