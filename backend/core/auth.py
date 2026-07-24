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
import secrets
import time
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

from infra import accounts as accounts_store
from infra import engine_ingest as engine_ingest_store

_HEADER_SCHEME = APIKeyHeader(name="X-Admin-Token", auto_error=False)
_BEARER_SCHEME = HTTPBearer(auto_error=False)
_ANTHROPIC_API_KEY_HEADER = APIKeyHeader(name="x-api-key", auto_error=False)

GATEWAY_SCOPE_CHAT = "gateway.chat"
CONSOLE_SCOPE_READ = "console.read"
CONSOLE_SCOPE_WRITE = "console.write"
WORKSPACE_SCOPE_READ = "workspace.read"
WORKSPACE_SCOPE_WRITE = "workspace.write"
AGENT_SCOPE_RUN = "agent.run"
AGENT_SCOPE_ADMIN = "agent.admin"
TASK_SCOPE_SUBMIT = "task.submit"
LEGACY_GATEWAY_SCOPES = [GATEWAY_SCOPE_CHAT]


def _truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def allow_global_ingest_scope() -> bool:
    """IT bootstrap token may act as any engine_id (legacy). Default off in production."""
    return _truthy_env("EVOTOWN_ALLOW_GLOBAL_INGEST_SCOPE")


def _get_configured_token() -> str:
    return os.environ.get("ADMIN_TOKEN", "").strip()


def legacy_key_id(raw_token: str) -> str:
    """Stable synthetic key_id for legacy env bearer tokens (audit + rate limits)."""
    digest = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    return f"legacy:{digest[:16]}"


def has_console_write(scopes: list[str]) -> bool:
    return CONSOLE_SCOPE_WRITE in scopes


def has_console_read(scopes: list[str]) -> bool:
    return CONSOLE_SCOPE_READ in scopes or CONSOLE_SCOPE_WRITE in scopes


def has_task_submit(scopes: list[str]) -> bool:
    return "*" in scopes or TASK_SCOPE_SUBMIT in scopes


_ALLOWED_TASK_SUBMIT_STAFF_ROLES = frozenset({"admin", "employee"})
def session_from_api_key_for_mcp(raw_key: str) -> dict[str, Any] | None:
    """Validate an API key for agent MCP calls (accepts agent.run or console.read scope)."""
    record = accounts_store.lookup_api_key(raw_key, touch_last_used=True)
    if record is None:
        return None
    scopes = _scopes_list(record.get("scopes"))
    if not (has_console_read(scopes) or AGENT_SCOPE_RUN in scopes):
        return None
    return _identity_from_record(record)


async def require_mcp_call(
    key: str | None = Security(_HEADER_SCHEME),
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> dict[str, Any] | None:
    """Validate agent or console key for MCP calls."""
    admin_token = _get_configured_token()
    if admin_token and key and key == admin_token:
        return {"source": "admin_token", "scopes": ["*"]}
    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
        staff = get_staff_session(token)
        if staff is not None:
            return staff
        session = session_from_api_key_for_mcp(token)
        if session is not None:
            return session
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key or missing console.read/agent.run scope.",
        )
    return None


async def require_admin(
    key: str | None = Security(_HEADER_SCHEME),
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> None:
    """Validate bootstrap admin token or console API key with write scope, or staff session with admin role."""
    admin_token = _get_configured_token()
    if admin_token and key and key == admin_token:
        return
    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
        # Check staff session first (account + password login)
        staff = get_staff_session(token)
        if staff is not None and has_console_write(staff.get("scopes", [])):
            return
        # Fall back to API key
        identity = _resolve_gateway_identity(token)
        if identity is not None and has_console_write(_scopes_list(identity.get("scopes"))):
            return
    if not admin_token and credentials is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server not configured: set ADMIN_TOKEN or sign in with a console API key.",
        )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Invalid or missing credentials. Sign in at /login or provide X-Admin-Token / Bearer console key.",
    )


async def require_console_read(
    key: str | None = Security(_HEADER_SCHEME),
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> dict[str, Any] | None:
    """Validate read access for market browsing/download. Returns session or None for public catalog."""
    admin_token = _get_configured_token()
    if admin_token and key and key == admin_token:
        return {"source": "admin_token", "scopes": ["*"]}
    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
        # Check staff session first
        staff = get_staff_session(token)
        if staff is not None:
            return staff
        # Staff session token exists but is expired → 401 to trigger login redirect
        if accounts_store.staff_session_exists(token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Staff session expired. Please log in again.",
            )
        # Fall back to API key
        session = session_from_api_key_for_mcp(token)
        if session is not None:
            return session
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key or missing console.read scope.",
        )
    return None


def _get_engine_ingest_token() -> str:
    ingest = os.environ.get("EVOTOWN_ENGINE_INGEST_TOKEN", "").strip()
    if ingest:
        return ingest
    if _truthy_env("EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK"):
        return _get_configured_token()
    return ""


@dataclass(frozen=True)
class EngineIngestAuth:
    """Resolved ingest bearer: IT global token or per-engine evi_ token."""

    mode: Literal["global", "engine"]
    engine_id: str | None = None


def _parse_bearer(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing bearer token.",
        )
    return credentials.credentials


async def get_engine_ingest_auth(
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> EngineIngestAuth:
    """Accept IT global ingest token or per-engine evi_ token."""
    raw = _parse_bearer(credentials)
    global_token = _get_engine_ingest_token()
    if global_token and raw == global_token:
        return EngineIngestAuth(mode="global", engine_id=None)
    engine_id = engine_ingest_store.lookup_engine_id_for_ingest_token(raw)
    if engine_id:
        return EngineIngestAuth(mode="engine", engine_id=engine_id)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Invalid or missing bearer token.",
    )


def assert_engine_ingest_scope(auth: EngineIngestAuth, engine_id: str) -> None:
    if auth.mode == "global":
        if not allow_global_ingest_scope():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "IT global ingest token cannot call per-engine APIs. "
                    "Use the machine's evi_ token or set EVOTOWN_ALLOW_GLOBAL_INGEST_SCOPE=1 for legacy mode."
                ),
            )
        return
    if auth.engine_id != engine_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"ingest token is not authorized for engine_id '{engine_id}'",
        )


async def require_engine_ingest_global(
    auth: EngineIngestAuth = Depends(get_engine_ingest_auth),
) -> EngineIngestAuth:
    """Endpoints that only IT / connector bootstrap should call with the shared token."""
    if auth.mode != "global":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires the IT engine ingest token (not a per-engine evi_ token).",
        )
    return auth


async def require_admin_or_ingest(
    key: str | None = Security(_HEADER_SCHEME),
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> Literal["admin", "ingest", "console"]:
    admin_token = _get_configured_token()
    if admin_token and key and key == admin_token:
        return "admin"
    if credentials is not None and credentials.scheme.lower() == "bearer":
        raw = credentials.credentials
        global_token = _get_engine_ingest_token()
        if global_token and raw == global_token:
            return "ingest"
        if engine_ingest_store.lookup_engine_id_for_ingest_token(raw):
            return "ingest"
        if session_from_api_key_for_mcp(raw) is not None:
            return "console"
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Requires X-Admin-Token, console API key, or engine ingest bearer.",
    )


async def require_engine_ingest(
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> EngineIngestAuth:
    """Backward-compatible alias: returns resolved ingest auth (global or per-engine)."""
    return await get_engine_ingest_auth(credentials)


async def require_engine_register(
    key: str | None = Security(_HEADER_SCHEME),
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> None:
    """Register / rotate tokens: admin header OR IT global ingest bearer."""
    admin_token = _get_configured_token()
    if admin_token and key and key == admin_token:
        return
    global_token = _get_engine_ingest_token()
    if (
        global_token
        and credentials is not None
        and credentials.scheme.lower() == "bearer"
        and credentials.credentials == global_token
    ):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Register requires X-Admin-Token or IT EVOTOWN_ENGINE_INGEST_TOKEN bearer.",
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
        "org_id": record.get("account_org_id") or record.get("org_id", ""),
        "team_id": record.get("account_org_id") or record.get("org_id", ""),
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
            "org_id": "",
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
    raw_token: str | None = None,
) -> dict[str, Any]:
    token = (raw_token or "").strip()
    if not token and credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    if not token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing gateway token.",
        )

    identity = _resolve_gateway_identity(token)
    if identity is None:
        if not _legacy_gateway_keys():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Server not configured: create gateway keys via /api/v1/accounts or set EVOTOWN_GATEWAY_API_KEYS.",
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing gateway token.",
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


async def require_gateway_chat_or_x_api_key(
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
    x_api_key: str | None = Security(_ANTHROPIC_API_KEY_HEADER),
) -> dict[str, Any]:
    return await _require_gateway_api_key(
        credentials,
        raw_token=x_api_key,
        required_scope=GATEWAY_SCOPE_CHAT,
    )


def admin_token_status() -> str:
    token = _get_configured_token()
    if not token:
        return "NOT SET ⚠️  — all write endpoints will return 503"
    return f"configured ({len(token)} chars) ✓"


def production_hardening_issues() -> list[str]:
    """Blocking issues for enterprise production checks (empty = pass).

    Used by ``enterprise-deploy.sh --check`` and surfaced on ``GET /health``.
    Soft operational notes (e.g. missing ingest token) stay in ``security_status``.
    """
    issues: list[str] = []
    if _truthy_env("EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY"):
        issues.append("EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY is enabled (admin must not be a gateway bearer)")
    if _truthy_env("EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK"):
        issues.append("EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK is enabled (ingest must not fall back to ADMIN_TOKEN)")
    if _truthy_env("EVOTOWN_ALLOW_PUBLIC_REGISTER"):
        issues.append("EVOTOWN_ALLOW_PUBLIC_REGISTER is enabled (set to 0 for enterprise)")
    cors_raw = os.environ.get("CORS_ORIGINS", "").strip()
    if not cors_raw or cors_raw == "*":
        issues.append("CORS_ORIGINS is * or unset (bind to EVOTOWN_PUBLIC_URL)")
    return issues


def security_status() -> dict[str, Any]:
    admin = _get_configured_token()
    ingest = os.environ.get("EVOTOWN_ENGINE_INGEST_TOKEN", "").strip()
    gateway_keys = _legacy_gateway_keys()
    dev_fallback = _truthy_env("EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK")
    dev_admin_gateway = _truthy_env("EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY")
    public_register = _truthy_env("EVOTOWN_ALLOW_PUBLIC_REGISTER")

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
    if public_register:
        warnings.append("EVOTOWN_ALLOW_PUBLIC_REGISTER enabled")

    hardening = production_hardening_issues()
    # Hardening issues are also security warnings for operators.
    for issue in hardening:
        if issue not in warnings:
            warnings.append(issue)

    return {
        "admin_token": admin_token_status(),
        "engine_ingest_token": "configured ✓" if ingest else ("dev fallback → ADMIN" if dev_fallback and admin else "NOT SET"),
        "legacy_gateway_keys": f"{len(gateway_keys)} key(s)" if gateway_keys else "none (use managed evk_ keys)",
        "dev_admin_as_gateway": "enabled ⚠️" if dev_admin_gateway else "disabled",
        "dev_ingest_fallback": "enabled ⚠️" if dev_fallback else "disabled",
        "public_register": "enabled ⚠️" if public_register else "disabled",
        "hardening_ok": len(hardening) == 0,
        "security_warnings": warnings,
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


# ── Staff session store (account + password login, SQLite-backed) ────

STAFF_SESSION_TTL = int(os.environ.get("EVOTOWN_STAFF_SESSION_TTL", "86400"))  # synced from system.db on startup
# Employee scopes — agent.write intentionally excluded: creation/management require admin console.write
STAFF_EMPLOYEE_SCOPES = [
    CONSOLE_SCOPE_READ,
    AGENT_SCOPE_RUN,
    "agent.read",
    TASK_SCOPE_SUBMIT,
]


def staff_session_scopes(role: str) -> list[str]:
    if role == "admin":
        return [CONSOLE_SCOPE_READ, CONSOLE_SCOPE_WRITE, TASK_SCOPE_SUBMIT]
    return list(STAFF_EMPLOYEE_SCOPES)


def create_staff_session(account: dict[str, Any]) -> str:
    from infra import accounts as accounts_store

    token = secrets.token_urlsafe(32)
    role = str(account.get("role") or "employee")
    session: dict[str, Any] = {
        "token": token,
        "account_id": account.get("account_id", ""),
        "account_name": account.get("name", ""),
        "login_name": account.get("login_name", ""),
        "org_id": account.get("org_id", ""),
        "role": role,
        "scopes": staff_session_scopes(role),
        "expires_at": time.time() + STAFF_SESSION_TTL,
    }
    accounts_store.save_staff_session(session)
    return token


def get_staff_session(token: str) -> dict[str, Any] | None:
    from infra import accounts as accounts_store

    session = accounts_store.load_staff_session(token)
    if session is None:
        return None
    current_scopes = staff_session_scopes(str(session.get("role") or "employee"))
    if session.get("scopes") != current_scopes:
        session["scopes"] = current_scopes
        accounts_store.save_staff_session(
            {
                "token": token,
                "account_id": session["account_id"],
                "account_name": session["account_name"],
                "login_name": session["login_name"],
                "org_id": session["org_id"],
                "role": session["role"],
                "scopes": current_scopes,
                "expires_at": session["expires_at"],
            }
        )
    return session


def destroy_staff_session(token: str) -> None:
    from infra import accounts as accounts_store

    accounts_store.destroy_staff_session(token)


async def require_staff_session(
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> dict[str, Any]:
    """Validate staff session Bearer token. Used for /agent pages."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )
    session = get_staff_session(credentials.credentials)
    if session is None:
        from infra import accounts as accounts_store

        if accounts_store.staff_session_exists(credentials.credentials):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Staff session expired. Please log in again.",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid staff session token.",
        )
    return session


async def get_optional_admin_identity(
    key: str | None = Security(_HEADER_SCHEME),
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> dict[str, Any] | None:
    """Validate optional auth for task_pool endpoints. Returns identity dict with submitter_type/submitter_id, or None."""
    return _resolve_task_submitter_identity(key, credentials)


def session_from_api_key_for_task_pool(raw_key: str) -> dict[str, Any] | None:
    """Resolve API keys that carry task.submit (console keys need not include console.read)."""
    record = accounts_store.lookup_api_key(raw_key, touch_last_used=True)
    if record is None:
        return None
    scopes = _scopes_list(record.get("scopes"))
    if not has_task_submit(scopes):
        return None
    identity = _identity_from_record(record)
    identity["auth_kind"] = "api_key"
    identity["submitter_type"] = "api_key"
    identity["submitter_id"] = str(identity.get("account_id") or "")
    return identity


def _resolve_task_submitter_identity(
    key: str | None,
    credentials: HTTPAuthorizationCredentials | None,
) -> dict[str, Any] | None:
    admin_token = _get_configured_token()
    if admin_token and key and key == admin_token:
        return {
            "auth_kind": "admin",
            "submitter_type": "admin",
            "submitter_id": "",
            "scopes": ["*"],
        }
    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
        staff = get_staff_session(token)
        if staff is not None:
            role = str(staff.get("role") or "employee")
            return {
                "auth_kind": "staff",
                "submitter_type": "employee",
                "submitter_id": staff.get("account_id", ""),
                "role": role,
                "scopes": staff.get("scopes", []),
            }
        return session_from_api_key_for_task_pool(token)
    return None


def _authorize_task_submit(identity: dict[str, Any]) -> None:
    scopes = _scopes_list(identity.get("scopes"))
    auth_kind = str(identity.get("auth_kind") or "")

    if auth_kind == "admin" and "*" in scopes:
        return

    if auth_kind == "staff":
        role = str(identity.get("role") or "employee").strip().lower()
        if role not in _ALLOWED_TASK_SUBMIT_STAFF_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only staff accounts with role admin or employee can submit tasks.",
            )
        if not has_task_submit(scopes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required scope: {TASK_SCOPE_SUBMIT}",
            )
        return

    if auth_kind == "api_key":
        if not has_task_submit(scopes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"API key missing required scope: {TASK_SCOPE_SUBMIT}",
            )
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Not authorized to submit tasks.",
    )


async def require_task_submitter_identity(
    key: str | None = Security(_HEADER_SCHEME),
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> dict[str, Any]:
    """Require authenticated identity authorized to submit tasks to the pool."""
    identity = _resolve_task_submitter_identity(key, credentials)
    if identity is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Sign in or provide X-Admin-Token / Bearer token.",
        )
    _authorize_task_submit(identity)
    return identity

