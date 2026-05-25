"""简单双 Token 鉴权

策略：
  - 管理面读/写（账号、Key、网关审计）→ X-Admin-Token
  - Arena 观战 GET + WebSocket               → 公开（agents / runs 等）
  - Gateway chat/completions                 → Bearer API key + scope 校验

启动前在环境变量或 .env 中设置：
  ADMIN_TOKEN=your-secret-here

Gateway API keys:
  - 优先查 SQLite 账号库（infra.accounts）
  - 回退到 EVOTOWN_GATEWAY_API_KEYS / ADMIN_TOKEN（本地兼容）
"""
from __future__ import annotations

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


def _get_configured_token() -> str:
    return os.environ.get("ADMIN_TOKEN", "").strip()


async def require_admin(key: str | None = Security(_HEADER_SCHEME)) -> None:
    """FastAPI 依赖：校验 X-Admin-Token 请求头。"""
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
    return os.environ.get("EVOTOWN_ENGINE_INGEST_TOKEN", "").strip() or _get_configured_token()


async def require_engine_ingest(
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> None:
    token = _get_engine_ingest_token()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server not configured: EVOTOWN_ENGINE_INGEST_TOKEN or ADMIN_TOKEN is missing.",
        )
    if credentials is None or credentials.scheme.lower() != "bearer" or credentials.credentials != token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing bearer token.",
        )


def _legacy_gateway_keys() -> list[str]:
    raw = os.environ.get("EVOTOWN_GATEWAY_API_KEYS", "").strip()
    keys = [item.strip() for item in raw.split(",") if item.strip()]
    admin_token = _get_configured_token()
    if admin_token:
        keys.append(admin_token)
    return keys


def _gateway_key_label(token: str) -> str:
    if token == _get_configured_token():
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
        "source": "database",
    }


def _resolve_gateway_identity(raw_token: str) -> dict[str, Any] | None:
    record = accounts_store.lookup_api_key(raw_token, touch_last_used=False)
    if record is not None:
        return _identity_from_record(record)

    if raw_token in _legacy_gateway_keys():
        return {
            "key_id": "",
            "account_id": "",
            "account_name": "",
            "team_id": "",
            "key_label": _gateway_key_label(raw_token),
            "key_prefix": "",
            "scopes": list(LEGACY_GATEWAY_SCOPES),
            "monthly_token_limit": int(os.environ.get("EVOTOWN_GATEWAY_LEGACY_MONTHLY_TOKEN_LIMIT", "0") or 0),
            "monthly_cost_limit_usd": float(os.environ.get("EVOTOWN_GATEWAY_LEGACY_MONTHLY_COST_LIMIT_USD", "0") or 0),
            "source": "legacy_env",
        }
    return None


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
