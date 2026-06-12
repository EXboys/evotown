"""Gateway account and API key management (admin)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import require_admin
from domain.models import (
    GatewayAccountCreate, GatewayAccountUpdate,
    GatewayApiKeyCreate, GatewayApiKeyUpdate,
    GatewayOrgCreate, GatewayOrgUpdate,
    SetupAgentRequest,
)
from infra import accounts as accounts_store
from infra import gateway as gateway_store
from infra import workspaces as workspaces_store

router = APIRouter(prefix="/api/v1", tags=["accounts"])


def _generate_workspace_name(account: dict, account_type: str, custom_name: str = "") -> str:
    if custom_name.strip():
        return custom_name.strip()
    name = account.get("name", "")
    if account_type == "employee":
        return f"{name}助理"
    return name


def _enrich_account(account: dict) -> dict:
    counts = accounts_store.account_key_counts([account["account_id"]])
    stats = counts.get(account["account_id"], {"active_keys": 0, "total_keys": 0})
    return {**account, **stats}


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
    )
    return {"account": _enrich_account(account)}


@router.post("/accounts/{account_id}/setup-agent", dependencies=[Depends(require_admin)])
async def setup_agent(account_id: str, body: SetupAgentRequest | None = None):
    """一键为已有账号创建 Agent 工作空间并签发 agent key。每个账号只能配置一次。"""
    account = accounts_store.get_account(account_id)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="account not found")

    # 检查是否已配置
    existing = workspaces_store.list_workspaces(owner_account_id=account_id)
    if existing:
        return {
            "configured": True,
            "workspace": existing[0],
            "message": "该账号已配置 Agent 工作空间",
        }

    account_type = account.get("account_type", "employee")
    workspace_name = _generate_workspace_name(
        account, account_type, (body.workspace_name if body else "")
    )

    workspace = workspaces_store.create_workspace(
        owner_account_id=account_id,
        name=workspace_name,
        tenant_id=account.get("org_id", ""),
        team_id=account.get("org_id", ""),
    )

    key_record, secret = accounts_store.create_api_key(
        account_id,
        label=f"Agent 助理 - {workspace_name}",
        scopes=["console.read", "agent.run"],
    )

    return {
        "configured": False,
        "workspace": workspace,
        "api_key": key_record,
        "secret": secret,
        "warning": "Store this secret now. It will not be shown again.",
    }


@router.get("/accounts", dependencies=[Depends(require_admin)])
async def list_accounts(status_filter: str | None = None, limit: int = 100):
    items = accounts_store.list_accounts(status=status_filter, limit=limit)
    counts = accounts_store.account_key_counts([a["account_id"] for a in items])
    # Enrich with workspace info
    result = []
    for a in items:
        aid = a["account_id"]
        enriched = {**a, **counts.get(aid, {"active_keys": 0, "total_keys": 0})}
        # Check if this account has an agent workspace
        agent_ws = workspaces_store.list_workspaces(owner_account_id=aid)
        if agent_ws:
            enriched["agent_workspace_id"] = agent_ws[0]["workspace_id"]
            enriched["agent_workspace_name"] = agent_ws[0]["name"]
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
    )
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
