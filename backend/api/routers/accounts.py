"""Gateway account and API key management (admin)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin
from domain.models import (
    GatewayAccountCreate, GatewayAccountUpdate,
    GatewayApiKeyCreate, GatewayApiKeyUpdate,
    GatewayOrgCreate, GatewayOrgUpdate,
)
from infra import accounts as accounts_store
from infra import gateway as gateway_store
from infra import agents as agents_store

router = APIRouter(prefix="/api/v1", tags=["accounts"])


def _enrich_account(account: dict) -> dict:
    aid = account["account_id"]
    return {**account, "agent_binding_count": agents_store.count_account_agents(aid)}


def _enrich_key(key: dict) -> dict:
    usage = gateway_store.monthly_usage_for_key(key.get("key_id", ""))
    return {**key, "monthly_usage": usage}


@router.post("/accounts", dependencies=[Depends(require_admin)])
async def create_account(body: GatewayAccountCreate):
    org_id = body.org_id or accounts_store.ROOT_ORG_ID
    if accounts_store.get_gateway_org(org_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="org not found")
    account = accounts_store.create_account(
        name=body.name,
        org_id=org_id,
        owner_email=body.owner_email,
        notes=body.notes,
        account_type=body.account_type,
        login_name=body.login_name,
        password=body.password,
        role=body.role,
    )
    return {"account": _enrich_account(account)}


@router.get("/accounts", dependencies=[Depends(require_admin)])
async def list_accounts(status_filter: str | None = None, limit: int = 100):
    items = accounts_store.list_accounts(status=status_filter, limit=limit)
    # Enrich with agent binding count
    result = []
    for a in items:
        aid = a["account_id"]
        enriched = {
            **a,
            "agent_binding_count": agents_store.count_account_agents(aid),
        }
        result.append(enriched)
    return {"accounts": result}


@router.get("/accounts/{account_id}", dependencies=[Depends(require_admin)])
async def get_account(account_id: str):
    account = accounts_store.get_account(account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    return {"account": _enrich_account(account)}


@router.patch("/accounts/{account_id}", dependencies=[Depends(require_admin)])
async def update_account(account_id: str, body: GatewayAccountUpdate):
    if accounts_store.get_account(account_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    if body.org_id is not None and body.org_id != "":
        if accounts_store.get_gateway_org(body.org_id) is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="org not found")
    account = accounts_store.update_account(
        account_id,
        name=body.name,
        org_id=body.org_id,
        owner_email=body.owner_email,
        status=body.status,
        notes=body.notes,
        account_type=body.account_type,
        login_name=body.login_name,
        role=body.role,
    )
    # Set password separately if provided
    if body.password:
        accounts_store.set_password(account_id, body.password)
    return {"account": _enrich_account(account or {})}


@router.get("/accounts/{account_id}/keys", dependencies=[Depends(require_admin)])
async def list_account_keys(account_id: str, status_filter: str | None = None, limit: int = 200):
    if accounts_store.get_account(account_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    return {
        "keys": [_enrich_key(k) for k in accounts_store.list_api_keys(
            account_id=account_id,
            status=status_filter,
            limit=limit,
        )]
    }


@router.post("/accounts/{account_id}/keys", dependencies=[Depends(require_admin)])
async def create_account_key(account_id: str, body: GatewayApiKeyCreate):
    try:
        key_record, secret = accounts_store.create_api_key(
            account_id,
            label=body.label,
            scopes=body.scopes,
            expires_at=body.expires_at,
            monthly_token_limit=body.monthly_token_limit,
            monthly_cost_limit_usd=body.monthly_cost_limit_usd,
            burst_rpm_limit=body.burst_rpm_limit,
        )
    except ValueError as exc:
        detail = str(exc)
        code = status.HTTP_404_NOT_FOUND if "not found" in detail else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=detail) from exc
    return {
        "key": _enrich_key(key_record),
        "secret": secret,
        "warning": "Store this secret now. It will not be shown again.",
    }


@router.get("/keys", dependencies=[Depends(require_admin)])
async def list_all_keys(account_id: str | None = None, status_filter: str | None = None, limit: int = 200):
    return {
        "keys": [_enrich_key(k) for k in accounts_store.list_api_keys(
            account_id=account_id,
            status=status_filter,
            limit=limit,
        )]
    }


@router.patch("/keys/{key_id}", dependencies=[Depends(require_admin)])
async def update_key(key_id: str, body: GatewayApiKeyUpdate):
    if accounts_store.get_api_key(key_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="key not found")
    updated = accounts_store.update_api_key(
        key_id,
        label=body.label,
        scopes=body.scopes,
        expires_at=body.expires_at,
        monthly_token_limit=body.monthly_token_limit,
        monthly_cost_limit_usd=body.monthly_cost_limit_usd,
        burst_rpm_limit=body.burst_rpm_limit,
    )
    return {"key": _enrich_key(updated or {})}


@router.post("/keys/{key_id}/revoke", dependencies=[Depends(require_admin)])
async def revoke_key(key_id: str):
    key = accounts_store.get_api_key(key_id)
    if key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="key not found")
    if key.get("status") == "revoked":
        return {"revoked": True, "key": _enrich_key(key)}
    revoked = accounts_store.revoke_api_key(key_id)
    return {"revoked": True, "key": _enrich_key(revoked or key)}


# ── Gateway Orgs ─────────────────────────────────────────────────────────────

def _enrich_org(org: dict) -> dict:
    org_id = org.get("org_id", "")
    account_count = accounts_store.gateway_org_account_count(org_id)
    key_counts = {"active_keys": 0, "total_keys": 0}
    accounts = accounts_store.list_accounts_by_org(org_id, limit=500)
    if accounts:
        ids = [a["account_id"] for a in accounts]
        raw = accounts_store.account_key_counts(ids)
        for v in raw.values():
            key_counts["active_keys"] += v.get("active_keys", 0)
            key_counts["total_keys"] += v.get("total_keys", 0)
    return {**org, "account_count": account_count, **key_counts}


@router.post("/gateway-orgs", dependencies=[Depends(require_admin)])
async def create_gateway_org(body: GatewayOrgCreate):
    org = accounts_store.create_gateway_org(
        name=body.name,
        description=body.description,
        owner_email=body.owner_email,
    )
    return {"org": _enrich_org(org)}


@router.get("/gateway-orgs", dependencies=[Depends(require_admin)])
async def list_gateway_orgs(status_filter: str | None = None, limit: int = 100):
    orgs = accounts_store.list_gateway_orgs(status=status_filter, limit=limit)
    return {"orgs": [_enrich_org(o) for o in orgs]}


@router.get("/gateway-orgs/{org_id}", dependencies=[Depends(require_admin)])
async def get_gateway_org(org_id: str):
    org = accounts_store.get_gateway_org(org_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="org not found")
    return {"org": _enrich_org(org)}


@router.patch("/gateway-orgs/{org_id}", dependencies=[Depends(require_admin)])
async def update_gateway_org(org_id: str, body: GatewayOrgUpdate):
    if accounts_store.get_gateway_org(org_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="org not found")
    org = accounts_store.update_gateway_org(
        org_id,
        name=body.name,
        description=body.description,
        owner_email=body.owner_email,
        status=body.status,
    )
    return {"org": _enrich_org(org or {})}


@router.delete("/gateway-orgs/{org_id}", dependencies=[Depends(require_admin)])
async def delete_gateway_org(org_id: str):
    if accounts_store.get_gateway_org(org_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="org not found")
    try:
        accounts_store.delete_gateway_org(org_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"ok": True}


# ── Agent bindings (M:N account ↔ agent) ────────────────────────────

@router.post("/accounts/{account_id}/bind-agent", dependencies=[Depends(require_admin)])
async def bind_agent_to_account_via_workspace(account_id: str, body: dict):
    agent_id = body.get("agent_id", body.get("workspace_id", "")).strip()
    if not agent_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="agent_id is required")
    if accounts_store.get_account(account_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    ag = agents_store.get_agent(agent_id)
    if ag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    binding = agents_store.bind_account_to_agent(account_id, agent_id)
    if binding is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="binding already exists")
    return {"binding": binding}


@router.delete("/accounts/{account_id}/bind-agent", dependencies=[Depends(require_admin)])
async def unbind_agent_from_account_via_workspace(account_id: str, body: dict):
    agent_id = body.get("agent_id", body.get("workspace_id", "")).strip()
    if not agent_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="agent_id is required")
    if not agents_store.unbind_account_from_agent(account_id, agent_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="binding not found")
    return {"ok": True}


@router.get("/accounts/{account_id}/agents", dependencies=[Depends(require_admin)])
async def list_account_agents_via_workspace(account_id: str):
    if accounts_store.get_account(account_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")
    ag_list = agents_store.list_account_agents(account_id)
    return {"agents": ag_list}


@router.get("/agents/{agent_id}/accounts", dependencies=[Depends(require_admin)])
async def list_agent_accounts_via_workspace(agent_id: str):
    ag = agents_store.get_agent(agent_id)
    if ag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent not found")
    accts = agents_store.list_agent_accounts(agent_id)
    # Enrich with account names
    result = []
    for a in accts:
        acc = accounts_store.get_account(a["account_id"])
        result.append({
            **a,
            "account_name": acc["name"] if acc else "",
            "login_name": acc["login_name"] if acc else "",
        })
    return {"accounts": result}
