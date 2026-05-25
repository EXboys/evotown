"""Console self-service registration and session endpoints."""
from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse

from core.auth import (
    DEFAULT_CONSOLE_KEY_SCOPES,
    require_console_session,
    session_from_api_key,
)
from domain.models import ConsoleLogin, ConsoleRegister, OidcExchange
from infra import accounts as accounts_store
from infra import oidc as oidc_store

router = APIRouter(prefix="/api/v1/auth", tags=["console-auth"])


def _public_register_allowed() -> bool:
    if os.environ.get("EVOTOWN_ALLOW_PUBLIC_REGISTER", "").strip().lower() in {"1", "true", "yes", "on"}:
        return True
    return accounts_store.count_accounts(status=None) == 0


def _session_payload(identity: dict) -> dict:
    return {
        "account_id": identity.get("account_id", ""),
        "account_name": identity.get("account_name", ""),
        "team_id": identity.get("team_id", ""),
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
        team_id=body.team_id,
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
