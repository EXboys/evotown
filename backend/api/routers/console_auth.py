"""Console self-service registration and session endpoints."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, status

from core.auth import (
    DEFAULT_CONSOLE_KEY_SCOPES,
    require_console_session,
    session_from_api_key,
)
from domain.models import ConsoleLogin, ConsoleRegister
from infra import accounts as accounts_store

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
    }
