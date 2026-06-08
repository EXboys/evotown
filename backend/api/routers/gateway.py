"""LiteLLM-backed centralized OpenAI-compatible gateway."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse

from core.auth import key_record_for_checks, require_admin, require_gateway_chat
from infra import accounts as accounts_store
from infra import gateway
from infra import gateway_models as gateway_models_store
from infra import gateway_retry
from infra import gateway_routes as gateway_routes_store
from infra import gateway_upstream
from infra.gateway_retry import RetryPolicy

router = APIRouter(prefix="/api/gateway/v1", tags=["gateway"])


@dataclass
class GatewayChatContext:
    request_id: str
    conversation_id: str
    client_model: str
    body: dict[str, Any]
    model_chain: list[str]
    policy: RetryPolicy
    matched_route: dict[str, Any] | None
    via_alias: bool
    user_message: str


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
            "model": "",
            "model_alias": body.get("metadata", {}).get("evotown_client_model", "") if body.get("metadata", {}).get("evotown_via_alias") else "",
            "status_code": 429,
            "latency_ms": 0,
            "risk_status": reason,
            "request_excerpt": _first_message_excerpt(body),
            "error": reason,
            "user_message": _extract_last_user_content(body),
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
            "model": "",
            "model_alias": body.get("metadata", {}).get("evotown_client_model", "") if body.get("metadata", {}).get("evotown_via_alias") else "",
            "status_code": 429,
            "latency_ms": 0,
            "risk_status": reason,
            "request_excerpt": _first_message_excerpt(body),
            "error": reason,
            "user_message": _extract_last_user_content(body),
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


def _extract_first_user_content(body: dict[str, Any]) -> str:
    """Extract the first user message content from the messages array."""
    messages = body.get("messages")
    if not isinstance(messages, list):
        return ""
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "user":
            return str(m.get("content", ""))
    return ""


def _extract_last_user_content(body: dict[str, Any]) -> str:
    """Extract the last user message content from the messages array.

    This is the actual user input that triggered the current model call.
    In tool-continuation turns, the last user message is still the same
    as the original question; in multi-turn conversations, it reflects
    the latest user input.
    """
    messages = body.get("messages")
    if not isinstance(messages, list):
        return ""
    last_user = ""
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "user":
            last_user = str(m.get("content", ""))
    return last_user


def _detect_client_type(body: dict[str, Any]) -> str:
    """Detect the AI client type from request body characteristics.

    Priority:
    1. Body carries conversation_id/thread_id → client manages its own
       session state → OpenClaw (or similar self-managing client).
    2. Last message role=user → Hermes (default until Claude Code / Codex tested).
    3. Last message role=tool → Hermes tool-call loop.
    """
    # ------------------------------------------------------------------
    # OpenClaw: sends conversation_id / thread_id in the body (manages
    # its own session fingerprint).  Hermes does NOT send these fields.
    # ------------------------------------------------------------------
    if body.get("conversation_id") or body.get("thread_id"):
        return "openclaw"

    # ------------------------------------------------------------------
    # Hermes: standard OpenAI messages with tool-call loop
    # ------------------------------------------------------------------
    messages = body.get("messages")
    if isinstance(messages, list) and messages:
        last = messages[-1]
        if isinstance(last, dict):
            role = last.get("role", "")
            if role == "tool":
                return "hermes"
            if role == "user":
                # TODO(claude-code): Detect Claude Code — may include Anthropic-specific
                #   fields (system prompt shape, stop_sequences, etc.)
                # TODO(codex): Detect Codex — uses different body format
                #   (responses API, not chat/completions)
                return "hermes"  # default until other clients are tested
    return "unknown"


def _resolve_conversation_id(body: dict[str, Any], account_id: str, fallback: str) -> str:
    """Derive conversation_id from first user message fingerprint.

    Each account_id + first-user-message-content pair maps to a unique
    conversation.  Tool-call continuations inside the same turn will have
    the same first user message → same conversation_id.  Concurrent
    sessions from the same account get different fingerprints because
    their first user message differs.
    """
    first_user_content = _extract_first_user_content(body)
    if not first_user_content:
        return fallback

    # account_id + first user message → deterministic conversation id
    fingerprint = f"{account_id}:{first_user_content}"
    conv_hash = hashlib.md5(fingerprint.encode()).hexdigest()[:16]
    return f"gw_{conv_hash}"


def _prepare_chat_context(
    body: dict[str, Any],
    *,
    identity: dict[str, Any],
    x_evotown_agent_id: str | None,
    x_evotown_team_id: str | None,
    x_evotown_engine_id: str | None,
    x_evotown_conversation_id: str | None,
) -> GatewayChatContext:
    request_id = f"gw_{uuid.uuid4().hex}"
    client_model = str(body.get("model") or "")
    team_scope = (x_evotown_team_id or identity.get("team_id") or "").strip()
    account_scope = (identity.get("account_id") or "").strip()
    # Priority: header > body > fingerprint-based inference
    conversation_id = (x_evotown_conversation_id
                       or str(body.get("conversation_id") or body.get("thread_id") or "")
                       or _resolve_conversation_id(body, account_scope, request_id))

    model_chain, matched_route, policy, via_alias = gateway_routes_store.resolve_model_chain(
        client_model,
        account_id=account_scope,
        team_id=team_scope,
        body=body,
    )
    primary = model_chain[0] if model_chain else client_model
    if via_alias and primary:
        body["model"] = primary

    _check_burst_or_raise(
        identity,
        request_id=request_id,
        conversation_id=conversation_id,
        model=client_model or primary,
        body=body,
    )
    _check_quota_or_raise(
        identity,
        request_id=request_id,
        conversation_id=conversation_id,
        model=client_model or primary,
        body=body,
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
        "evotown_routed_model": primary,
        "evotown_route_id": (matched_route or {}).get("route_id", ""),
        "evotown_model_chain": model_chain,
        "evotown_via_alias": via_alias,
    }
    if matched_route:
        if matched_route.get("evotown_auto_tier"):
            body["metadata"]["evotown_auto_tier"] = matched_route["evotown_auto_tier"]
        if matched_route.get("evotown_auto_reason"):
            body["metadata"]["evotown_auto_reason"] = matched_route["evotown_auto_reason"]

    return GatewayChatContext(
        request_id=request_id,
        conversation_id=conversation_id,
        client_model=client_model or primary,
        body=body,
        model_chain=model_chain,
        policy=policy,
        matched_route=matched_route,
        via_alias=via_alias,
        user_message=_extract_last_user_content(body),
    )


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


def _record_attempts_metadata(body: dict[str, Any], attempts: list[gateway_retry.AttemptRecord]) -> None:
    meta = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    meta["evotown_attempts"] = [a.to_dict() for a in attempts]
    body["metadata"] = meta


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


def _sse_has_content_chunk(line: str) -> bool:
    if not line.startswith("data:"):
        return False
    payload_text = line[5:].strip()
    if not payload_text or payload_text == "[DONE]":
        return False
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError:
        return False
    if not isinstance(payload, dict):
        return False
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return False
    delta = choices[0].get("delta") if isinstance(choices[0], dict) else {}
    if isinstance(delta, dict) and delta.get("content"):
        return True
    return False


async def _stream_upstream_chat(
    *,
    ctx: GatewayChatContext,
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
    attempts: list[gateway_retry.AttemptRecord] = []
    audit = _audit_identity_fields(
        identity,
        x_evotown_agent_id=x_evotown_agent_id,
        x_evotown_team_id=x_evotown_team_id,
        x_evotown_engine_id=x_evotown_engine_id,
    )
    policy = ctx.policy
    total_attempts = 0
    deadline = time.perf_counter() + _gateway_timeout_sec()

    def build_call(model_name: str) -> tuple[str, dict[str, str], dict[str, Any]]:
        return gateway_upstream.build_upstream_call(ctx.body, model_name)

    try:
        async with httpx.AsyncClient(timeout=_gateway_timeout_sec()) as client:
            for hop_index, model_name in enumerate(ctx.model_chain):
                retries_on_hop = 0
                while True:
                    if total_attempts >= policy.max_total_attempts or time.perf_counter() >= deadline:
                        status_code = 502
                        error = "gateway retry budget exceeded"
                        payload = json.dumps({"error": {"message": error, "type": "gateway_upstream_error"}})
                        yield f"data: {payload}\n\n".encode("utf-8")
                        return

                    total_attempts += 1
                    target, headers, req_body = build_call(model_name)
                    chunks_sent = False
                    try:
                        async with client.stream("POST", target, json=req_body, headers=headers) as upstream:
                            status_code = upstream.status_code
                            if upstream.status_code >= 400:
                                err_body = await upstream.aread()
                                error = err_body.decode("utf-8", errors="replace")
                                attempts.append(
                                    gateway_retry.AttemptRecord(
                                        model=model_name,
                                        attempt_index=total_attempts,
                                        hop_index=hop_index,
                                        action="upstream_error",
                                        status_code=upstream.status_code,
                                        detail=error[:200],
                                    )
                                )
                                if gateway_retry.should_retry_same_model(
                                    policy=policy,
                                    status_code=upstream.status_code,
                                    error_kind="",
                                    retries_used=retries_on_hop,
                                ):
                                    delay_ms = gateway_retry.backoff_ms(policy, retries_on_hop, upstream)
                                    retries_on_hop += 1
                                    await asyncio.sleep(delay_ms / 1000.0)
                                    continue
                                if gateway_retry.should_fallback(
                                    policy=policy,
                                    status_code=upstream.status_code,
                                    error_kind="",
                                    hop_index=hop_index,
                                    chain_len=len(ctx.model_chain),
                                ):
                                    attempts.append(
                                        gateway_retry.AttemptRecord(
                                            model=model_name,
                                            attempt_index=total_attempts,
                                            hop_index=hop_index,
                                            action="fallback",
                                            status_code=upstream.status_code,
                                        )
                                    )
                                    break
                                yield err_body
                                return

                            attempts.append(
                                gateway_retry.AttemptRecord(
                                    model=model_name,
                                    attempt_index=total_attempts,
                                    hop_index=hop_index,
                                    action="stream_start",
                                    status_code=200,
                                )
                            )
                            async for line in upstream.aiter_lines():
                                if line:
                                    if _sse_has_content_chunk(line):
                                        chunks_sent = True
                                    usage, cost = _parse_sse_usage(line, usage, cost)
                                    yield (line + "\n").encode("utf-8")
                                else:
                                    yield b"\n"
                            attempts.append(
                                gateway_retry.AttemptRecord(
                                    model=model_name,
                                    attempt_index=total_attempts,
                                    hop_index=hop_index,
                                    action="success",
                                    status_code=200,
                                )
                            )
                            return
                    except httpx.HTTPError as exc:
                        kind = gateway_retry.error_kind(exc)
                        error = str(exc)
                        attempts.append(
                            gateway_retry.AttemptRecord(
                                model=model_name,
                                attempt_index=total_attempts,
                                hop_index=hop_index,
                                action="error",
                                error_kind=kind,
                                detail=error,
                            )
                        )
                        if chunks_sent:
                            status_code = 502
                            payload = json.dumps({"error": {"message": error, "type": "gateway_upstream_error"}})
                            yield f"data: {payload}\n\n".encode("utf-8")
                            return
                        if gateway_retry.should_retry_same_model(
                            policy=policy,
                            status_code=None,
                            error_kind=kind,
                            retries_used=retries_on_hop,
                        ):
                            delay_ms = gateway_retry.backoff_ms(policy, retries_on_hop, None)
                            retries_on_hop += 1
                            await asyncio.sleep(delay_ms / 1000.0)
                            continue
                        if gateway_retry.should_fallback(
                            policy=policy,
                            status_code=None,
                            error_kind=kind,
                            hop_index=hop_index,
                            chain_len=len(ctx.model_chain),
                        ):
                            break
                        status_code = 502
                        payload = json.dumps({"error": {"message": error, "type": "gateway_upstream_error"}})
                        yield f"data: {payload}\n\n".encode("utf-8")
                        return

            status_code = 502
            error = error or "all models in chain failed"
            payload = json.dumps({"error": {"message": error, "type": "gateway_upstream_error"}})
            yield f"data: {payload}\n\n".encode("utf-8")
    finally:
        _record_attempts_metadata(ctx.body, attempts)
        latency_ms = int((time.perf_counter() - started) * 1000)
        _success_models = [a.model for a in attempts if a.action == "success"]
        _stream_final_model = _success_models[-1] if _success_models else ""
        _record_gateway_request(
            {
                "request_id": ctx.request_id,
                "conversation_id": ctx.conversation_id,
                **audit,
                "model": _stream_final_model or ctx.client_model,
                "model_alias": ctx.client_model if ctx.via_alias else "",
                "status_code": status_code,
                **usage,
                "cost_usd": cost,
                "latency_ms": latency_ms,
                "risk_status": "allowed" if status_code < 400 else "upstream_error",
                "request_excerpt": _first_message_excerpt(ctx.body),
                "response_excerpt": {"stream": True, **usage, "attempts": [a.to_dict() for a in attempts]},
                "error": error,
                "user_message": ctx.user_message,
            }
        )
        if status_code < 400:
            _finalize_success_audit(identity, response, request_id=ctx.request_id)


@router.get("/health")
async def gateway_health():
    return {
        "status": "ok",
        "litellm_configured": bool(gateway_upstream.litellm_base_url()),
        "litellm_base_url": gateway_upstream.litellm_base_url() or None,
        "managed_upstream_models": len(gateway_models_store.list_models(enabled_only=True)),
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
    # TEMP DEBUG: capture raw request headers for client-type detection
    import json as _json
    _hdrs = {k: v for k, v in request.headers.items() if not k.startswith("x-forwarded")}
    print(f"[CLIENT-DEBUG] account={identity.get('account_id','')} headers={_json.dumps(_hdrs, default=str)}", flush=True)
    if not isinstance(body, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="JSON object body required.")

    ctx = _prepare_chat_context(
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
                ctx=ctx,
                identity=identity,
                x_evotown_agent_id=x_evotown_agent_id,
                x_evotown_team_id=x_evotown_team_id,
                x_evotown_engine_id=x_evotown_engine_id,
                response=response,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Evotown-Request-Id": ctx.request_id,
                "X-Evotown-Conversation-Id": ctx.conversation_id,
            },
        )

    started = time.perf_counter()
    audit = _audit_identity_fields(
        identity,
        x_evotown_agent_id=x_evotown_agent_id,
        x_evotown_team_id=x_evotown_team_id,
        x_evotown_engine_id=x_evotown_engine_id,
    )

    build_call: Callable[[str], tuple[str, dict[str, str], dict[str, Any]]] = (
        lambda model_name: gateway_upstream.build_upstream_call(ctx.body, model_name)
    )

    try:
        async with httpx.AsyncClient(timeout=_gateway_timeout_sec()) as client:
            upstream_result = await gateway_retry.post_chat_with_resilience(
                client=client,
                build_call=build_call,
                model_chain=ctx.model_chain,
                policy=ctx.policy,
                timeout_sec=_gateway_timeout_sec(),
            )
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        _record_gateway_request(
            {
                "request_id": ctx.request_id,
                "conversation_id": ctx.conversation_id,
                **audit,
                "model": "",
                "model_alias": ctx.client_model if ctx.via_alias else "",
                "status_code": 502,
                "latency_ms": latency_ms,
                "request_excerpt": _first_message_excerpt(ctx.body),
                "error": str(exc),
                "user_message": ctx.user_message,
            }
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Upstream error: {exc}") from exc

    _record_attempts_metadata(ctx.body, upstream_result.attempts)
    latency_ms = int((time.perf_counter() - started) * 1000)
    data = upstream_result.data if upstream_result.data is not None else {"error": upstream_result.error}
    usage = _usage_from_response(data if isinstance(data, dict) else {})

    _record_gateway_request(
        {
            "request_id": ctx.request_id,
            "conversation_id": ctx.conversation_id,
            **audit,
            "model": upstream_result.final_model or ctx.client_model,
            "model_alias": ctx.client_model if ctx.via_alias else "",
            "status_code": upstream_result.status_code,
            **usage,
            "cost_usd": _cost_from_response(data if isinstance(data, dict) else {}),
            "latency_ms": latency_ms,
            "risk_status": "allowed" if upstream_result.success else "upstream_error",
            "request_excerpt": _first_message_excerpt(ctx.body),
            "response_excerpt": {
                **(data if isinstance(data, dict) else {"raw": data}),
                "evotown_final_model": upstream_result.final_model,
                "evotown_attempts": [a.to_dict() for a in upstream_result.attempts],
            },
            "error": "" if upstream_result.success else str(upstream_result.error or data),
            "user_message": ctx.user_message,
        }
    )

    if upstream_result.success:
        _finalize_success_audit(identity, response, request_id=ctx.request_id)
        response.headers["X-Evotown-Request-Id"] = ctx.request_id
        response.headers["X-Evotown-Conversation-Id"] = ctx.conversation_id
        if upstream_result.final_model:
            response.headers["X-Evotown-Final-Model"] = upstream_result.final_model
        response.headers["X-Evotown-Upstream-Attempts"] = str(len(upstream_result.attempts))
        return data

    raise HTTPException(status_code=upstream_result.status_code, detail=data)


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
