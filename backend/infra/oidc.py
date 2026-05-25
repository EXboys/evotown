"""OIDC / SSO helpers for console login (authorization code flow)."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sqlite3
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx

from infra import accounts as accounts_store

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


_conn: sqlite3.Connection | None = None
_discovery_cache: dict[str, Any] | None = None


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "accounts.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS oidc_states (
            state         TEXT PRIMARY KEY,
            nonce         TEXT NOT NULL,
            redirect_uri  TEXT NOT NULL,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS oidc_login_codes (
            code          TEXT PRIMARY KEY,
            api_key       TEXT NOT NULL,
            account_id    TEXT NOT NULL,
            expires_at    TEXT NOT NULL,
            consumed_at   TEXT
        );
        """
    )
    _migrate_accounts_oidc(conn)
    _conn = conn
    return conn


def _migrate_accounts_oidc(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(gateway_accounts)").fetchall()}
    if "oidc_sub" not in cols:
        conn.execute("ALTER TABLE gateway_accounts ADD COLUMN oidc_sub TEXT NOT NULL DEFAULT ''")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_accounts_oidc_sub ON gateway_accounts(oidc_sub) WHERE oidc_sub != ''")


def oidc_enabled() -> bool:
    return bool(_issuer() and _client_id() and _client_secret())


def _issuer() -> str:
    return os.environ.get("EVOTOWN_OIDC_ISSUER", "").strip().rstrip("/")


def _client_id() -> str:
    return os.environ.get("EVOTOWN_OIDC_CLIENT_ID", "").strip()


def _client_secret() -> str:
    return os.environ.get("EVOTOWN_OIDC_CLIENT_SECRET", "").strip()


def _redirect_uri() -> str:
    explicit = os.environ.get("EVOTOWN_OIDC_REDIRECT_URI", "").strip()
    if explicit:
        return explicit
    public = os.environ.get("EVOTOWN_PUBLIC_URL", "").strip().rstrip("/")
    if public:
        return f"{public}/api/v1/auth/oidc/callback"
    return ""


def public_config() -> dict[str, Any]:
    return {
        "enabled": oidc_enabled(),
        "issuer": _issuer() or None,
        "redirect_uri": _redirect_uri() or None,
    }


async def discover() -> dict[str, Any]:
    global _discovery_cache
    if _discovery_cache is not None:
        return _discovery_cache
    issuer = _issuer()
    if not issuer:
        return {}
    url = f"{issuer}/.well-known/openid-configuration"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        _discovery_cache = resp.json()
        return _discovery_cache


def create_state(*, redirect_uri: str) -> tuple[str, str]:
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    _ensure_conn().execute(
        "INSERT INTO oidc_states (state, nonce, redirect_uri) VALUES (?, ?, ?)",
        (state, nonce, redirect_uri),
    )
    return state, nonce


def pop_state(state: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute("SELECT * FROM oidc_states WHERE state=?", (state,)).fetchone()
    if row is None:
        return None
    _ensure_conn().execute("DELETE FROM oidc_states WHERE state=?", (state,))
    return dict(row)


async def authorization_url(*, post_login_redirect: str) -> str:
    meta = await discover()
    auth_endpoint = meta.get("authorization_endpoint")
    if not auth_endpoint:
        raise RuntimeError("OIDC discovery missing authorization_endpoint")
    redirect_uri = _redirect_uri()
    if not redirect_uri:
        raise RuntimeError("EVOTOWN_OIDC_REDIRECT_URI or EVOTOWN_PUBLIC_URL required")
    state, nonce = create_state(redirect_uri=post_login_redirect)
    params = {
        "client_id": _client_id(),
        "response_type": "code",
        "scope": os.environ.get("EVOTOWN_OIDC_SCOPES", "openid email profile"),
        "redirect_uri": redirect_uri,
        "state": state,
        "nonce": nonce,
    }
    return f"{auth_endpoint}?{urlencode(params)}"


def _decode_jwt_payload(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        raw = base64.urlsafe_b64decode(payload.encode("ascii"))
        return json.loads(raw.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return {}


async def exchange_code(code: str) -> dict[str, Any]:
    meta = await discover()
    token_endpoint = meta.get("token_endpoint")
    if not token_endpoint:
        raise RuntimeError("OIDC discovery missing token_endpoint")
    redirect_uri = _redirect_uri()
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": _client_id(),
        "client_secret": _client_secret(),
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(token_endpoint, data=data)
        resp.raise_for_status()
        return resp.json()


def account_for_oidc(*, sub: str, email: str, name: str) -> dict[str, Any]:
    conn = _ensure_conn()
    row = conn.execute(
        "SELECT * FROM gateway_accounts WHERE oidc_sub=? AND status='active'",
        (sub,),
    ).fetchone()
    if row is not None:
        return dict(row)
    account = accounts_store.create_account(
        name=name or email or f"oidc-{sub[:8]}",
        team_id=os.environ.get("EVOTOWN_OIDC_DEFAULT_TEAM_ID", "").strip(),
        owner_email=email,
        notes="oidc sso",
    )
    conn.execute(
        "UPDATE gateway_accounts SET oidc_sub=?, updated_at=datetime('now') WHERE account_id=?",
        (sub, account["account_id"]),
    )
    return accounts_store.get_account(account["account_id"]) or account


def issue_login_code(*, api_key: str, account_id: str, ttl_sec: int = 120) -> str:
    code = secrets.token_urlsafe(32)
    _ensure_conn().execute(
        """
        INSERT INTO oidc_login_codes (code, api_key, account_id, expires_at)
        VALUES (?, ?, ?, datetime('now', ?))
        """,
        (code, api_key, account_id, f"+{ttl_sec} seconds"),
    )
    return code


def consume_login_code(code: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        """
        SELECT * FROM oidc_login_codes
        WHERE code=? AND consumed_at IS NULL AND datetime(expires_at) > datetime('now')
        """,
        (code.strip(),),
    ).fetchone()
    if row is None:
        return None
    _ensure_conn().execute(
        "UPDATE oidc_login_codes SET consumed_at=datetime('now') WHERE code=?",
        (code.strip(),),
    )
    return dict(row)


def claims_from_token_response(token_response: dict[str, Any]) -> dict[str, Any]:
    id_token = token_response.get("id_token")
    if isinstance(id_token, str) and id_token:
        claims = _decode_jwt_payload(id_token)
        if claims:
            return claims
    return {}
