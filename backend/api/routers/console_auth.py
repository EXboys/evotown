"""Console self-service registration and session endpoints."""
from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Security, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials

from core.auth import (
    DEFAULT_CONSOLE_KEY_SCOPES,
    _BEARER_SCHEME,
    create_staff_session,
    destroy_staff_session,
    require_console_session,
    require_staff_session,
    session_from_api_key,
)
from domain.models import ConsoleLogin, ConsoleRegister, OidcExchange, StaffLogin
from infra import accounts as accounts_store
from infra import oidc as oidc_store
from infra import agents as agents_store

router = APIRouter(prefix="/api/v1/auth", tags=["console-auth"])

LOCAL_DEPLOY_KEY_LABEL = "local-deploy"
EMPLOYEE_GATEWAY_SCOPES = [
    accounts_store.GATEWAY_SCOPE_CHAT,
    accounts_store.CONSOLE_SCOPE_READ,
    accounts_store.AGENT_SCOPE_RUN,
]


def _resolve_public_base_url(request: Request | None) -> str:
    explicit = os.environ.get("EVOTOWN_PUBLIC_URL", "").strip().rstrip("/")
    if explicit:
        return explicit
    if request is None:
        return ""
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").split(",")[0].strip()
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(",")[0].strip()
    if not host:
        return ""
    return f"{proto}://{host}".rstrip("/")


def _gateway_credentials_payload(*, request: Request, account_id: str, api_key: str = "") -> dict:
    base = _resolve_public_base_url(request) or "https://evotown.company.internal"
    keys = accounts_store.list_api_keys(account_id=account_id, status="active", limit=50)
    gateway_keys = [
        k for k in keys
        if accounts_store.GATEWAY_SCOPE_CHAT in (k.get("scopes") or [])
    ]
    local_keys = [k for k in gateway_keys if str(k.get("label") or "").startswith(LOCAL_DEPLOY_KEY_LABEL)]
    ref = local_keys[0] if local_keys else (gateway_keys[0] if gateway_keys else None)
    return {
        "evotown_url": base,
        "gateway_base_url": f"{base}/api/gateway/v1",
        "skills_manifest_url": (
            f"{base}/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=openclaw"
        ),
        "api_key": api_key,
        "has_key": bool(api_key or ref),
        "key_prefix": str(ref.get("key_prefix") or "") if ref else "",
        "key_label": str(ref.get("label") or "") if ref else "",
    }


def _public_register_allowed() -> bool:
    if os.environ.get("EVOTOWN_ALLOW_PUBLIC_REGISTER", "").strip().lower() in {"1", "true", "yes", "on"}:
        return True
    return accounts_store.count_accounts(status=None) == 0


def _session_payload(identity: dict) -> dict:
    return {
        "account_id": identity.get("account_id", ""),
        "account_name": identity.get("account_name", ""),
        "org_id": identity.get("org_id", ""),
        "key_id": identity.get("key_id", ""),
        "key_label": identity.get("key_label", ""),
        "scopes": identity.get("scopes", []),
    }


def _console_login_url() -> str:
    explicit = os.environ.get("EVOTOWN_CONSOLE_LOGIN_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    public = os.environ.get("EVOTOWN_PUBLIC_URL", "").strip().rstrip("/")
    return f"{public}/login" if public else "/login"


@router.post("/register")
async def register_console_account(body: ConsoleRegister):
    if not _public_register_allowed():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration is disabled. Ask an administrator to create your account.",
        )
    account = accounts_store.create_account(
        name=body.name,
        org_id=body.org_id or accounts_store.ROOT_ORG_ID,
        owner_email=body.owner_email,
        notes="self-service registration",
    )
    key_record, secret = accounts_store.create_api_key(
        account["account_id"],
        label="console-login",
        scopes=list(DEFAULT_CONSOLE_KEY_SCOPES),
    )
    return {
        "registered": True,
        "account": account,
        "api_key": secret,
        "key": key_record,
        "warning": "Store this API key now. It will not be shown again.",
    }


@router.post("/login")
async def login_console(body: ConsoleLogin):
    session = session_from_api_key(body.api_key.strip())
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key or missing console scope.",
        )
    return {"authenticated": True, "session": _session_payload(session)}


@router.post("/staff-login")
async def staff_login(body: StaffLogin):
    account = accounts_store.lookup_by_login(body.login_name.strip())
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid login name or password.",
        )
    if not accounts_store.verify_password(body.password, account.get("password_hash", "")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid login name or password.",
        )
    token = create_staff_session(account)
    return {
        "authenticated": True,
        "session_token": token,
        "account": {
            "account_id": account.get("account_id"),
            "name": account.get("name"),
            "login_name": account.get("login_name"),
            "org_id": account.get("org_id"),
            "role": account.get("role", "employee"),
        },
    }


@router.get("/staff-me")
async def staff_me(session: dict = Depends(require_staff_session)):
    return {
        "authenticated": True,
        "account": {
            "account_id": session.get("account_id"),
            "account_name": session.get("account_name"),
            "login_name": session.get("login_name"),
            "org_id": session.get("org_id"),
            "role": session.get("role"),
            "scopes": session.get("scopes"),
        },
    }


@router.post("/staff-logout")
async def staff_logout(
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
):
    if credentials is not None and credentials.scheme.lower() == "bearer":
        destroy_staff_session(credentials.credentials)
    return {"ok": True}


@router.get("/me")
async def console_me(session: dict = Depends(require_console_session)):
    return {"session": _session_payload(session)}


@router.get("/registration-status")
async def registration_status():
    return {
        "public_registration_allowed": _public_register_allowed(),
        "account_count": accounts_store.count_accounts(status=None),
        "oidc": oidc_store.public_config(),
    }


@router.get("/oidc/status")
async def oidc_status():
    return oidc_store.public_config()


@router.get("/oidc/start")
async def oidc_start(return_to: str = "/dashboard"):
    if not oidc_store.oidc_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC SSO is not configured.",
        )
    try:
        url = await oidc_store.authorization_url(post_login_redirect=return_to)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return RedirectResponse(url, status_code=302)


@router.get("/oidc/callback")
async def oidc_callback(code: str, state: str):
    if not oidc_store.oidc_enabled():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OIDC SSO is not configured.")
    state_row = oidc_store.pop_state(state)
    if state_row is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OIDC state.")
    try:
        token_response = await oidc_store.exchange_code(code)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"OIDC token exchange failed: {exc}") from exc
    claims = oidc_store.claims_from_token_response(token_response)
    sub = str(claims.get("sub") or "").strip()
    if not sub:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="OIDC id_token missing sub claim.")
    email = str(claims.get("email") or "").strip()
    name = str(claims.get("name") or claims.get("preferred_username") or email or sub).strip()
    account = oidc_store.account_for_oidc(sub=sub, email=email, name=name)
    _key_record, secret = accounts_store.create_api_key(
        account["account_id"],
        label="oidc-login",
        scopes=list(DEFAULT_CONSOLE_KEY_SCOPES),
    )
    login_code = oidc_store.issue_login_code(api_key=secret, account_id=account["account_id"])
    return_to = state_row.get("redirect_uri") or "/dashboard"
    login_url = _console_login_url()
    return RedirectResponse(f"{login_url}?oidc_code={login_code}&return={return_to}", status_code=302)


@router.post("/oidc/exchange")
async def oidc_exchange(body: OidcExchange):
    row = oidc_store.consume_login_code(body.code.strip())
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired OIDC login code.",
        )
    session = session_from_api_key(row["api_key"])
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="OIDC session key is invalid.",
        )
    return {
        "authenticated": True,
        "api_key": row["api_key"],
        "session": _session_payload(session),
        "warning": "Store this API key if you need CLI access. Browser session is active.",
    }


# ── Agent discovery for staff sessions ──────────────────────────────

@router.get("/my-gateway-credentials")
async def my_gateway_credentials(request: Request, session: dict = Depends(require_console_session)):
    """Account-level gateway config for local OpenClaw/Hermes deploy (independent of cloud agents)."""
    account_id = str(session.get("account_id") or "")
    if not account_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account session required")
    return {"credentials": _gateway_credentials_payload(request=request, account_id=account_id)}


@router.post("/my-gateway-credentials/issue")
async def issue_my_gateway_credentials(request: Request, session: dict = Depends(require_console_session)):
    """Issue or rotate the employee local-deploy API key for the logged-in account."""
    account_id = str(session.get("account_id") or "")
    if not account_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account session required")
    for key in accounts_store.list_api_keys(account_id=account_id, status="active", limit=100):
        label = str(key.get("label") or "")
        if label == LOCAL_DEPLOY_KEY_LABEL or label.startswith(f"{LOCAL_DEPLOY_KEY_LABEL}-"):
            accounts_store.revoke_api_key(str(key.get("key_id") or ""))
    _record, secret = accounts_store.create_api_key(
        account_id,
        label=LOCAL_DEPLOY_KEY_LABEL,
        scopes=list(EMPLOYEE_GATEWAY_SCOPES),
    )
    return {
        "credentials": _gateway_credentials_payload(request=request, account_id=account_id, api_key=secret),
        "warning": "Store this API key now. It will not be shown again.",
    }


@router.get("/my-agents")
async def my_agents(session: dict = Depends(require_staff_session)):
    """Return agents bound to the currently logged-in staff account."""
    account_id = session.get("account_id", "")
    ag_list = agents_store.list_account_agents(account_id)
    return {
        "agents": ag_list,
        "account_id": account_id,
        "account_name": session.get("account_name", ""),
    }
