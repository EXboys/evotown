"""Staff (account + password) login and session endpoints."""

from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Security, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials

from core.auth import (
    _BEARER_SCHEME,
    create_staff_session,
    destroy_staff_session,
    require_staff_session,
)
from domain.models import StaffLogin
from infra import accounts as accounts_store
from infra import oidc as oidc_store
from infra import agents as agents_store

router = APIRouter(prefix="/api/v1/auth", tags=["console-auth"])


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


def _console_login_url() -> str:
    explicit = os.environ.get("EVOTOWN_CONSOLE_LOGIN_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    public = os.environ.get("EVOTOWN_PUBLIC_URL", "").strip().rstrip("/")
    return f"{public}/login" if public else "/login"


# ── Staff login (account + password) ────────────────────────────────

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


# ── Agent discovery for staff sessions ──────────────────────────────

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


# ── OIDC SSO ────────────────────────────────────────────────────────

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
    staff_token = create_staff_session(account)
    return_to = state_row.get("redirect_uri") or "/agent"
    login_url = _console_login_url()
    return RedirectResponse(
        f"{login_url}?staff_token={staff_token}&return={return_to}",
        status_code=302,
    )
