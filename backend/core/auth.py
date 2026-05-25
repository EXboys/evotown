"""Simple multi-role token auth.

Roles (separate env vars in production):
  - Admin (X-Admin-Token)           → ADMIN_TOKEN
  - Engine ingest (Bearer)          → EVOTOWN_ENGINE_INGEST_TOKEN
  - Gateway legacy env keys         → EVOTOWN_GATEWAY_API_KEYS (comma-separated)

Managed gateway keys (evk_…) are stored in SQLite (infra.accounts).

Local dev fallbacks (opt-in via EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK=1):
  - Ingest may fall back to ADMIN_TOKEN when ingest token is unset
  - Gateway may treat ADMIN_TOKEN as a legacy bearer when EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY=1
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any

from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

from infra import accounts as accounts_store

_HEADER_SCHEME = APIKeyHeader(name="X-Admin-Token", auto_error=False)
_BEARER_SCHEME = HTTPBearer(auto_error=False)

GATEWAY_SCOPE_CHAT = "gateway.chat"
LEGACY_GATEWAY_SCOPES = [GATEWAY_SCOPE_CHAT]


def _truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _get_configured_token() -> str:
    return os.environ.get("ADMIN_TOKEN", "").strip()


def legacy_key_id(raw_token: str) -> str:
    """Stable synthetic key_id for legacy env bearer tokens (audit + rate limits)."""
    digest = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    return f"legacy:{digest[:16]}"


async def require_admin(key: str | None = Security(_HEADER_SCHEME)) -> None:
    """FastAPI dependency: validate X-Admin-Token header."""
    admin_token = _get_configured_token()
    if not admin_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server not configured: ADMIN_TOKEN env var is missing.",
        )
    if not key or key != admin_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing X-Admin-Token header.",
        )


def _get_engine_ingest_token() -> str:
    ingest = os.environ.get("EVOTOWN_ENGINE_INGEST_TOKEN", "").strip()
    if ingest:
        return ingest
    if _truthy_env("EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK"):
        return _get_configured_token()
    return ""


async def require_engine_ingest(
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> None:
    token = _get_engine_ingest_token()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Server not configured: set EVOTOWN_ENGINE_INGEST_TOKEN "
                "(or EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK=1 for local dev)."
            ),
        )
    if credentials is None or credentials.scheme.lower() != "bearer" or credentials.credentials != token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing bearer token.",
        )


def _legacy_gateway_keys() -> list[str]:
    raw = os.environ.get("EVOTOWN_GATEWAY_API_KEYS", "").strip()
    keys = [item.strip() for item in raw.split(",") if item.strip()]
    if _truthy_env("EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY"):
        admin_token = _get_configured_token()
        if admin_token and admin_token not in keys:
            keys.append(admin_token)
    return keys


def _gateway_key_label(token: str) -> str:
    if _truthy_env("EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY") and token == _get_configured_token():
        return "admin-token"
    if token.startswith(accounts_store.KEY_PREFIX):
        return token[:12] + "…"
    return f"gateway-key-{token[-6:]}" if len(token) >= 6 else "gateway-key"


def _scopes_list(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(item) for item in raw]
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(item) for item in parsed]
        except json.JSONDecodeError:
            pass
    return list(LEGACY_GATEWAY_SCOPES)


def _identity_from_record(record: dict[str, Any]) -> dict[str, Any]:
    label = record.get("label") or record.get("key_prefix", "") + "…"
    return {
        "key_id": record["key_id"],
        "account_id": record["account_id"],
        "account_name": record.get("account_name", ""),
        "team_id": record.get("account_team_id") or record.get("team_id", ""),
        "key_label": label,
        "key_prefix": record.get("key_prefix", ""),
        "scopes": _scopes_list(record.get("scopes")),
        "monthly_token_limit": int(record.get("monthly_token_limit") or 0),
        "monthly_cost_limit_usd": float(record.get("monthly_cost_limit_usd") or 0),
        "burst_rpm_limit": int(record.get("burst_rpm_limit") or 0),
        "source": "database",
    }


def _legacy_env_limits() -> dict[str, int | float]:
    return {
        "monthly_token_limit": int(os.environ.get("EVOTOWN_GATEWAY_LEGACY_MONTHLY_TOKEN_LIMIT", "0") or 0),
        "monthly_cost_limit_usd": float(os.environ.get("EVOTOWN_GATEWAY_LEGACY_MONTHLY_COST_LIMIT_USD", "0") or 0),
        "burst_rpm_limit": int(os.environ.get("EVOTOWN_GATEWAY_LEGACY_BURST_RPM", "0") or 0),
    }


def _resolve_gateway_identity(raw_token: str) -> dict[str, Any] | None:
    record = accounts_store.lookup_api_key(raw_token, touch_last_used=False)
    if record is not None:
        return _identity_from_record(record)

    if raw_token in _legacy_gateway_keys():
        limits = _legacy_env_limits()
        return {
            "key_id": legacy_key_id(raw_token),
            "account_id": "",
            "account_name": "",
            "team_id": "",
            "key_label": _gateway_key_label(raw_token),
            "key_prefix": "",
            "scopes": list(LEGACY_GATEWAY_SCOPES),
            "source": "legacy_env",
            **limits,
        }
    return None


def key_record_for_checks(identity: dict[str, Any]) -> dict[str, Any]:
    """Resolve DB key row or pass through legacy identity for quota/burst checks."""
    if identity.get("source") == "database":
        key_id = identity.get("key_id") or ""
        if key_id:
            return accounts_store.get_api_key(key_id) or identity
    return identity


def _assert_gateway_scope(identity: dict[str, Any], required_scope: str) -> None:
    scopes = identity.get("scopes") or []
    if required_scope not in scopes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API key missing required scope: {required_scope}",
        )


async def _require_gateway_api_key(
    credentials: HTTPAuthorizationCredentials | None,
    *,
    required_scope: str | None = None,
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing gateway bearer token.",
        )

    identity = _resolve_gateway_identity(credentials.credentials)
    if identity is None:
        if not _legacy_gateway_keys():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Server not configured: create gateway keys via /api/v1/accounts or set EVOTOWN_GATEWAY_API_KEYS.",
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing gateway bearer token.",
        )

    if required_scope:
        _assert_gateway_scope(identity, required_scope)
    return identity


async def require_gateway_api_key(
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> dict[str, Any]:
    return await _require_gateway_api_key(credentials, required_scope=GATEWAY_SCOPE_CHAT)


async def require_gateway_chat(
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> dict[str, Any]:
    return await _require_gateway_api_key(credentials, required_scope=GATEWAY_SCOPE_CHAT)


def admin_token_status() -> str:
    token = _get_configured_token()
    if not token:
        return "NOT SET ⚠️  — all write endpoints will return 503"
    return f"configured ({len(token)} chars) ✓"


def security_status() -> dict[str, str]:
    admin = _get_configured_token()
    ingest = os.environ.get("EVOTOWN_ENGINE_INGEST_TOKEN", "").strip()
    gateway_keys = _legacy_gateway_keys()
    dev_fallback = _truthy_env("EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK")
    dev_admin_gateway = _truthy_env("EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY")

    ingest_effective = ingest or (admin if dev_fallback else "")
    shared_admin_ingest = bool(admin and ingest_effective == admin and ingest == "")
    shared_admin_gateway = bool(admin and dev_admin_gateway and admin in gateway_keys)

    warnings: list[str] = []
    if not ingest and not dev_fallback:
        warnings.append("EVOTOWN_ENGINE_INGEST_TOKEN unset (ingest writes return 503)")
    if shared_admin_ingest and not dev_fallback:
        pass
    if shared_admin_ingest and dev_fallback:
        warnings.append("ingest uses ADMIN_TOKEN via dev fallback")
    if shared_admin_gateway:
        warnings.append("ADMIN_TOKEN enabled as legacy gateway bearer (dev only)")
    if admin and ingest and admin == ingest:
        warnings.append("ADMIN_TOKEN equals EVOTOWN_ENGINE_INGEST_TOKEN")
    if admin and admin in os.environ.get("EVOTOWN_GATEWAY_API_KEYS", "").split(","):
        warnings.append("ADMIN_TOKEN also listed in EVOTOWN_GATEWAY_API_KEYS")

    return {
        "admin_token": admin_token_status(),
        "engine_ingest_token": "configured ✓" if ingest else ("dev fallback → ADMIN" if dev_fallback and admin else "NOT SET"),
        "legacy_gateway_keys": f"{len(gateway_keys)} key(s)" if gateway_keys else "none (use managed evk_ keys)",
        "dev_admin_as_gateway": "enabled ⚠️" if dev_admin_gateway else "disabled",
        "dev_ingest_fallback": "enabled ⚠️" if dev_fallback else "disabled",
        "warnings": "; ".join(warnings) if warnings else "none",
    }


# ── Prompt Injection Guard ─────────────────────────────────────────────────────

_INJECTION_PATTERNS: list[str] = [
    "ignore previous instructions",
    "ignore all previous",
    "disregard all previous",
    "forget everything above",
    "forget all previous",
    "you are now",
    "your new instructions",
    "override your instructions",
    "act as if you are",
    "pretend you are",
    "from now on you",
    "new persona:",
    "jailbreak",
    "<|system|>",
    "<|user|>",
    "<|assistant|>",
    "###instruction",
    "[system]",
    "[user]",
    "忽略之前的指令",
    "忽略所有之前",
    "忘记之前的设定",
    "现在你是",
    "你的新指令",
]

SOUL_MAX_CHARS = 5_000
TASK_MAX_CHARS = 2_000


def check_prompt_injection(text: str) -> str | None:
    lower = text.lower()
    for pattern in _INJECTION_PATTERNS:
        if pattern in lower:
            return pattern
    return None


def validate_soul_content(content: str) -> None:
    if len(content) > SOUL_MAX_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"SOUL.md content exceeds {SOUL_MAX_CHARS} character limit "
                   f"(got {len(content)}).",
        )
    hit = check_prompt_injection(content)
    if hit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"SOUL.md content contains disallowed prompt-injection pattern: '{hit}'.",
        )


def validate_task_content(task: str) -> None:
    if len(task) > TASK_MAX_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task description exceeds {TASK_MAX_CHARS} character limit "
                   f"(got {len(task)}).",
        )
    hit = check_prompt_injection(task)
    if hit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task content contains disallowed prompt-injection pattern: '{hit}'.",
        )
