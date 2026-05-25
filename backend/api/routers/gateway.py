"""LiteLLM-backed centralized OpenAI-compatible gateway."""
from __future__ import annotations

import json
import os
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse

from core.auth import key_record_for_checks, require_admin, require_gateway_chat
from infra import accounts as accounts_store
from infra import gateway
from infra import gateway_routes as gateway_routes_store

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


def _record_gateway_request(item: dict[str, Any]) -> None:
    gateway.record_request(item)


def _check_burst_or_raise(identity: dict[str, Any], *, request_id: str, conversation_id: str, model: str, body: dict[str, Any]) -> None:
    key_id = identity.get("key_id") or ""
    if not key_id:
        return

    key_record = key_record_for_checks(identity)
    recent = gateway.request_count_in_window(key_id, window_seconds=60)
    allowed, reason = accounts_store.check_burst_rate_limit(key_record, recent)
    if allowed:
        return

    _record_gateway_request(
        {
            "request_id": request_id,
            "conversation_id": conversation_id,
            "api_key_label": identity["key_label"],
            "account_id": identity.get("account_id", ""),
            "key_id": key_id,
            "agent_id": "",
            "team_id": identity.get("team_id", "") or "",
            "engine_id": "",
            "model": model,
            "status_code": 429,
            "latency_ms": 0,
            "risk_status": reason,
            "request_excerpt": _first_message_excerpt(body),
            "error": reason,
        }
    )
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "error": reason,
            "recent_requests_60s": recent,
            "burst_rpm_limit": accounts_store.effective_burst_rpm(key_record),
        },
    )


def _check_quota_or_raise(identity: dict[str, Any], *, request_id: str, conversation_id: str, model: str, body: dict[str, Any]) -> None:
    key_id = identity.get("key_id") or ""
    if not key_id:
        return

    key_record = key_record_for_checks(identity)
    usage = gateway.monthly_usage_for_key(key_id)
    allowed, reason = accounts_store.check_monthly_quota(key_record, usage)
    if allowed:
        return

    _record_gateway_request(
        {
            "request_id": request_id,
            "conversation_id": conversation_id,
            "api_key_label": identity["key_label"],
            "account_id": identity.get("account_id", ""),
            "key_id": key_id,
            "agent_id": "",
            "team_id": identity.get("team_id", "") or "",
            "engine_id": "",
            "model": model,
            "status_code": 429,
            "latency_ms": 0,
            "risk_status": reason,
            "request_excerpt": _first_message_excerpt(body),
            "error": reason,
        }
    )
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={
            "error": reason,
            "monthly_usage": usage,
            "limits": {
                "monthly_token_limit": int(key_record.get("monthly_token_limit") or 0),
                "monthly_cost_limit_usd": float(key_record.get("monthly_cost_limit_usd") or 0),
            },
        },
    )


def _post_check_quota(identity: dict[str, Any], request_id: str) -> str | None:
    """After a successful upstream call, flag audit row if monthly quota is now exceeded."""
    key_id = identity.get("key_id") or ""
    if not key_id:
        return None

    key_record = key_record_for_checks(identity)
    usage = gateway.monthly_usage_for_key(key_id)
    allowed, reason = accounts_store.check_monthly_quota(key_record, usage)
    if allowed:
        return None

    post_reason = f"{reason}_post"
    gateway.update_request_risk_status(request_id, post_reason)
    return post_reason


def _gateway_timeout_sec() -> float:
    return float(os.environ.get("EVOTOWN_GATEWAY_TIMEOUT_SEC", "120"))


def _prepare_chat_request(
    body: dict[str, Any],
    *,
    identity: dict[str, Any],
    x_evotown_agent_id: str | None,
    x_evotown_team_id: str | None,
    x_evotown_engine_id: str | None,
    x_evotown_conversation_id: str | None,
) -> tuple[str, str, str, dict[str, Any], str, dict[str, str]]:
    request_id = f"gw_{uuid.uuid4().hex}"
    conversation_id = x_evotown_conversation_id or str(body.get("conversation_id") or body.get("thread_id") or request_id)
    client_model = str(body.get("model") or "")
    team_scope = (x_evotown_team_id or identity.get("team_id") or "").strip()
    account_scope = (identity.get("account_id") or "").strip()
    target_model, matched_route = gateway_routes_store.resolve_target_model(
        client_model,
        account_id=account_scope,
        team_id=team_scope,
    )
    if target_model and target_model != client_model:
        body["model"] = target_model
    model = client_model or target_model

    _check_burst_or_raise(
        identity,
        request_id=request_id,
        conversation_id=conversation_id,
        model=model,
        body=body,
    )
    _check_quota_or_raise(
        identity,
        request_id=request_id,
        conversation_id=conversation_id,
        model=model,
        body=body,
    )

    litellm_base = _litellm_base_url()
    if not litellm_base:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LITELLM_BASE_URL is not configured.",
        )

    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    body["metadata"] = {
        **metadata,
        "evotown_request_id": request_id,
        "evotown_conversation_id": conversation_id,
        "evotown_agent_id": x_evotown_agent_id or "",
        "evotown_team_id": x_evotown_team_id or "",
        "evotown_engine_id": x_evotown_engine_id or "",
        "evotown_client_model": client_model,
        "evotown_routed_model": target_model,
        "evotown_route_id": (matched_route or {}).get("route_id", ""),
    }

    target = f"{litellm_base}/chat/completions"
    headers = {"Content-Type": "application/json", **_litellm_auth_header()}
    return request_id, conversation_id, model, body, target, headers


def _audit_identity_fields(
    identity: dict[str, Any],
    *,
    x_evotown_agent_id: str | None,
    x_evotown_team_id: str | None,
    x_evotown_engine_id: str | None,
) -> dict[str, str]:
    return {
        "api_key_label": identity["key_label"],
        "account_id": identity.get("account_id", ""),
        "key_id": identity.get("key_id", ""),
        "agent_id": x_evotown_agent_id or "",
        "team_id": x_evotown_team_id or identity.get("team_id", "") or "",
        "engine_id": x_evotown_engine_id or "",
    }


def _finalize_success_audit(
    identity: dict[str, Any],
    response: Response | None,
    *,
    request_id: str,
) -> None:
    key_id = identity.get("key_id") or ""
    if not key_id:
        return
    accounts_store.touch_api_key(key_id)
    post_reason = _post_check_quota(identity, request_id)
    if post_reason and response is not None:
        response.headers["X-Evotown-Quota-Exceeded"] = post_reason


def _parse_sse_usage(line: str, usage: dict[str, int], cost: float) -> tuple[dict[str, int], float]:
    if not line.startswith("data:"):
        return usage, cost
    payload_text = line[5:].strip()
    if not payload_text or payload_text == "[DONE]":
        return usage, cost
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError:
        return usage, cost
    if not isinstance(payload, dict):
        return usage, cost
    parsed_usage = _usage_from_response(payload)
    if parsed_usage.get("total_tokens"):
        usage = parsed_usage
    parsed_cost = _cost_from_response(payload)
    if parsed_cost:
        cost = parsed_cost
    return usage, cost


async def _stream_upstream_chat(
    *,
    target: str,
    headers: dict[str, str],
    body: dict[str, Any],
    request_id: str,
    conversation_id: str,
    model: str,
    identity: dict[str, Any],
    x_evotown_agent_id: str | None,
    x_evotown_team_id: str | None,
    x_evotown_engine_id: str | None,
    response: Response,
) -> AsyncIterator[bytes]:
    started = time.perf_counter()
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    cost = 0.0
    status_code = 200
    error = ""
    audit = _audit_identity_fields(
        identity,
        x_evotown_agent_id=x_evotown_agent_id,
        x_evotown_team_id=x_evotown_team_id,
        x_evotown_engine_id=x_evotown_engine_id,
    )

    try:
        async with httpx.AsyncClient(timeout=_gateway_timeout_sec()) as client:
            async with client.stream("POST", target, json=body, headers=headers) as upstream:
                status_code = upstream.status_code
                if upstream.status_code >= 400:
                    err_body = await upstream.aread()
                    error = err_body.decode("utf-8", errors="replace")
                    yield err_body
                    return

                async for line in upstream.aiter_lines():
                    if line:
                        usage, cost = _parse_sse_usage(line, usage, cost)
                        yield (line + "\n").encode("utf-8")
                    else:
                        yield b"\n"
    except httpx.HTTPError as exc:
        status_code = 502
        error = str(exc)
        payload = json.dumps({"error": {"message": error, "type": "gateway_upstream_error"}})
        yield f"data: {payload}\n\n".encode("utf-8")
    finally:
        latency_ms = int((time.perf_counter() - started) * 1000)
        _record_gateway_request(
            {
                "request_id": request_id,
                "conversation_id": conversation_id,
                **audit,
                "model": model,
                "status_code": status_code,
                **usage,
                "cost_usd": cost,
                "latency_ms": latency_ms,
                "risk_status": "allowed" if status_code < 400 else "upstream_error",
                "request_excerpt": _first_message_excerpt(body),
                "response_excerpt": {"stream": True, **usage},
                "error": error,
            }
        )
        if status_code < 400:
            _finalize_success_audit(identity, response, request_id=request_id)


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
    response: Response,
    identity: dict[str, Any] = Depends(require_gateway_chat),
    x_evotown_agent_id: str | None = Header(default=None),
    x_evotown_team_id: str | None = Header(default=None),
    x_evotown_engine_id: str | None = Header(default=None),
    x_evotown_conversation_id: str | None = Header(default=None),
):
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="JSON object body required.")

    request_id, conversation_id, model, body, target, headers = _prepare_chat_request(
        body,
        identity=identity,
        x_evotown_agent_id=x_evotown_agent_id,
        x_evotown_team_id=x_evotown_team_id,
        x_evotown_engine_id=x_evotown_engine_id,
        x_evotown_conversation_id=x_evotown_conversation_id,
    )

    if body.get("stream") is True:
        return StreamingResponse(
            _stream_upstream_chat(
                target=target,
                headers=headers,
                body=body,
                request_id=request_id,
                conversation_id=conversation_id,
                model=model,
                identity=identity,
                x_evotown_agent_id=x_evotown_agent_id,
                x_evotown_team_id=x_evotown_team_id,
                x_evotown_engine_id=x_evotown_engine_id,
                response=response,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Evotown-Request-Id": request_id,
                "X-Evotown-Conversation-Id": conversation_id,
            },
        )

    started = time.perf_counter()
    audit = _audit_identity_fields(
        identity,
        x_evotown_agent_id=x_evotown_agent_id,
        x_evotown_team_id=x_evotown_team_id,
        x_evotown_engine_id=x_evotown_engine_id,
    )

    try:
        async with httpx.AsyncClient(timeout=_gateway_timeout_sec()) as client:
            upstream = await client.post(target, json=body, headers=headers)
    except httpx.HTTPError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        _record_gateway_request(
            {
                "request_id": request_id,
                "conversation_id": conversation_id,
                **audit,
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
    _record_gateway_request(
        {
            "request_id": request_id,
            "conversation_id": conversation_id,
            **audit,
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

    if upstream.is_success:
        _finalize_success_audit(identity, response, request_id=request_id)

    if not upstream.is_success:
        raise HTTPException(status_code=upstream.status_code, detail=data)
    return data


@router.get("/usage/summary", dependencies=[Depends(require_admin)])
async def usage_summary(limit: int = 10):
    return gateway.usage_summary(limit=limit)


@router.get("/conversations", dependencies=[Depends(require_admin)])
async def list_conversations(limit: int = 100):
    return {"conversations": gateway.conversations(limit=limit)}


@router.get("/requests", dependencies=[Depends(require_admin)])
async def list_requests(limit: int = 100):
    return {"requests": gateway.recent_requests(limit=limit)}


@router.get("/api-keys", dependencies=[Depends(require_admin)])
async def list_api_keys():
    """Legacy env keys plus managed keys (metadata only)."""
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
            "monthly_token_limit": k.get("monthly_token_limit", 0),
            "monthly_cost_limit_usd": k.get("monthly_cost_limit_usd", 0),
            "monthly_usage": gateway.monthly_usage_for_key(k["key_id"]),
        }
        for k in accounts_store.list_api_keys(status="active", limit=500)
    ]
    return {
        "keys": managed + legacy,
        "managed_count": len(managed),
        "legacy_env_count": len(legacy),
        "admin_token_fallback": bool(os.environ.get("ADMIN_TOKEN", "").strip()),
    }
