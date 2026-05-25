"""LiteLLM-backed centralized OpenAI-compatible gateway."""
from __future__ import annotations

import os
import time
import uuid
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from core.auth import require_gateway_api_key
from infra import gateway

router = APIRouter(prefix="/api/gateway/v1", tags=["gateway"])


def _litellm_base_url() -> str:
    return os.environ.get("LITELLM_BASE_URL", "").rstrip("/")


def _litellm_auth_header() -> dict[str, str]:
    token = os.environ.get("LITELLM_MASTER_KEY", "").strip() or os.environ.get("LITELLM_API_KEY", "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


def _usage_from_response(data: dict[str, Any]) -> dict[str, int]:
    usage = data.get("usage") if isinstance(data, dict) else {}
    if not isinstance(usage, dict):
        usage = {}
    return {
        "prompt_tokens": int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
        "completion_tokens": int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
        "total_tokens": int(usage.get("total_tokens") or 0),
    }


def _cost_from_response(data: dict[str, Any]) -> float:
    for key in ("response_cost", "cost", "cost_usd"):
        value = data.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    hidden = data.get("_hidden_params")
    if isinstance(hidden, dict) and isinstance(hidden.get("response_cost"), (int, float)):
        return float(hidden["response_cost"])
    return 0.0


def _first_message_excerpt(body: dict[str, Any]) -> Any:
    messages = body.get("messages")
    if isinstance(messages, list) and messages:
        return messages[-1]
    return body


@router.get("/health")
async def gateway_health():
    return {
        "status": "ok",
        "litellm_configured": bool(_litellm_base_url()),
        "litellm_base_url": _litellm_base_url() or None,
    }


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    identity: dict[str, str] = Depends(require_gateway_api_key),
    x_evotown_agent_id: str | None = Header(default=None),
    x_evotown_team_id: str | None = Header(default=None),
    x_evotown_engine_id: str | None = Header(default=None),
    x_evotown_conversation_id: str | None = Header(default=None),
):
    litellm_base = _litellm_base_url()
    if not litellm_base:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LITELLM_BASE_URL is not configured.",
        )

    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="JSON object body required.")
    if body.get("stream") is True:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Streaming is not supported by the MVP gateway.")

    request_id = f"gw_{uuid.uuid4().hex}"
    conversation_id = x_evotown_conversation_id or str(body.get("conversation_id") or body.get("thread_id") or request_id)
    model = str(body.get("model") or "")
    started = time.perf_counter()

    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    body["metadata"] = {
        **metadata,
        "evotown_request_id": request_id,
        "evotown_conversation_id": conversation_id,
        "evotown_agent_id": x_evotown_agent_id or "",
        "evotown_team_id": x_evotown_team_id or "",
        "evotown_engine_id": x_evotown_engine_id or "",
    }

    target = f"{litellm_base}/chat/completions"
    headers = {"Content-Type": "application/json", **_litellm_auth_header()}

    try:
        async with httpx.AsyncClient(timeout=float(os.environ.get("EVOTOWN_GATEWAY_TIMEOUT_SEC", "120"))) as client:
            upstream = await client.post(target, json=body, headers=headers)
    except httpx.HTTPError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        gateway.record_request(
            {
                "request_id": request_id,
                "conversation_id": conversation_id,
                "api_key_label": identity["key_label"],
                "account_id": identity.get("account_id", ""),
                "key_id": identity.get("key_id", ""),
                "agent_id": x_evotown_agent_id or "",
                "team_id": x_evotown_team_id or identity.get("team_id", "") or "",
                "engine_id": x_evotown_engine_id or "",
                "model": model,
                "status_code": 502,
                "latency_ms": latency_ms,
                "request_excerpt": _first_message_excerpt(body),
                "error": str(exc),
            }
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"LiteLLM upstream error: {exc}") from exc

    latency_ms = int((time.perf_counter() - started) * 1000)
    try:
        data = upstream.json()
    except ValueError:
        data = {"raw": upstream.text}

    usage = _usage_from_response(data if isinstance(data, dict) else {})
    gateway.record_request(
        {
            "request_id": request_id,
            "conversation_id": conversation_id,
            "api_key_label": identity["key_label"],
            "account_id": identity.get("account_id", ""),
            "key_id": identity.get("key_id", ""),
            "agent_id": x_evotown_agent_id or "",
            "team_id": x_evotown_team_id or identity.get("team_id", "") or "",
            "engine_id": x_evotown_engine_id or "",
            "model": model,
            "status_code": upstream.status_code,
            **usage,
            "cost_usd": _cost_from_response(data if isinstance(data, dict) else {}),
            "latency_ms": latency_ms,
            "risk_status": "allowed",
            "request_excerpt": _first_message_excerpt(body),
            "response_excerpt": data,
            "error": "" if upstream.is_success else str(data),
        }
    )
    if not upstream.is_success:
        raise HTTPException(status_code=upstream.status_code, detail=data)
    return data


@router.get("/usage/summary")
async def usage_summary(limit: int = 10):
    return gateway.usage_summary(limit=limit)


@router.get("/conversations")
async def list_conversations(limit: int = 100):
    return {"conversations": gateway.conversations(limit=limit)}


@router.get("/requests")
async def list_requests(limit: int = 100):
    return {"requests": gateway.recent_requests(limit=limit)}


@router.get("/api-keys")
async def list_api_keys():
    """Legacy env keys plus managed keys (metadata only)."""
    from infra import accounts as accounts_store

    configured = [item.strip() for item in os.environ.get("EVOTOWN_GATEWAY_API_KEYS", "").split(",") if item.strip()]
    legacy = [
        {
            "key_label": f"gateway-key-{key[-6:]}" if len(key) >= 6 else "gateway-key",
            "scope": "chat.completions",
            "source": "legacy_env",
        }
        for key in configured
    ]
    managed = [
        {
            "key_id": k["key_id"],
            "key_label": k.get("label") or k.get("key_prefix", "") + "…",
            "key_prefix": k.get("key_prefix", ""),
            "account_id": k.get("account_id", ""),
            "status": k.get("status", ""),
            "scope": ", ".join(k.get("scopes") or ["gateway.chat"]),
            "source": "database",
            "last_used_at": k.get("last_used_at"),
        }
        for k in accounts_store.list_api_keys(status="active", limit=500)
    ]
    return {
        "keys": managed + legacy,
        "managed_count": len(managed),
        "legacy_env_count": len(legacy),
        "admin_token_fallback": bool(os.environ.get("ADMIN_TOKEN", "").strip()),
    }
