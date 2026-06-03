"""Gateway upstream retry and fallback chain execution."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DEFAULT_RETRY_POLICY: dict[str, Any] = {
    "max_retries_same_model": 2,
    "max_fallback_hops": 2,
    "max_total_attempts": 6,
    "retry_on_status": [429, 502, 503, 504],
    "fallback_on_status": [404, 429, 502, 503, 504],
    "retry_on_errors": ["timeout", "connection_error"],
    "fallback_on_errors": ["timeout", "connection_error"],
    "backoff_ms": [200, 800],
    "max_backoff_ms": 5000,
    "respect_retry_after": True,
}

NON_RETRYABLE_STATUS = frozenset({400, 401, 403, 422})


@dataclass
class RetryPolicy:
    max_retries_same_model: int = 2
    max_fallback_hops: int = 2
    max_total_attempts: int = 6
    retry_on_status: frozenset[int] = field(default_factory=lambda: frozenset({429, 502, 503, 504}))
    fallback_on_status: frozenset[int] = field(default_factory=lambda: frozenset({404, 429, 502, 503, 504}))
    retry_on_errors: frozenset[str] = field(default_factory=lambda: frozenset({"timeout", "connection_error"}))
    fallback_on_errors: frozenset[str] = field(default_factory=lambda: frozenset({"timeout", "connection_error"}))
    backoff_ms: list[int] = field(default_factory=lambda: [200, 800])
    max_backoff_ms: int = 5000
    respect_retry_after: bool = True

    @classmethod
    def from_dict(cls, raw: dict[str, Any] | None) -> RetryPolicy:
        base = {**DEFAULT_RETRY_POLICY, **(raw or {})}
        return cls(
            max_retries_same_model=int(base.get("max_retries_same_model", 2)),
            max_fallback_hops=int(base.get("max_fallback_hops", 2)),
            max_total_attempts=int(base.get("max_total_attempts", 6)),
            retry_on_status=frozenset(int(x) for x in (base.get("retry_on_status") or [])),
            fallback_on_status=frozenset(int(x) for x in (base.get("fallback_on_status") or [])),
            retry_on_errors=frozenset(str(x) for x in (base.get("retry_on_errors") or [])),
            fallback_on_errors=frozenset(str(x) for x in (base.get("fallback_on_errors") or [])),
            backoff_ms=[int(x) for x in (base.get("backoff_ms") or [200, 800])],
            max_backoff_ms=int(base.get("max_backoff_ms", 5000)),
            respect_retry_after=bool(base.get("respect_retry_after", True)),
        )


@dataclass
class AttemptRecord:
    model: str
    attempt_index: int
    hop_index: int
    action: str
    status_code: int | None = None
    error_kind: str = ""
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "attempt_index": self.attempt_index,
            "hop_index": self.hop_index,
            "action": self.action,
            "status_code": self.status_code,
            "error_kind": self.error_kind,
            "detail": (self.detail or "")[:500],
        }


@dataclass
class UpstreamResult:
    response: httpx.Response | None = None
    data: Any = None
    status_code: int = 502
    error: str = ""
    attempts: list[AttemptRecord] = field(default_factory=list)
    final_model: str = ""
    success: bool = False


def parse_fallback_models(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        if text.startswith("["):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    return [str(x).strip() for x in parsed if str(x).strip()]
            except json.JSONDecodeError:
                pass
        return [part.strip() for part in text.split(",") if part.strip()]
    return []


def build_model_chain(primary: str, fallback_models: list[str], *, max_hops: int) -> list[str]:
    chain: list[str] = []
    seen: set[str] = set()
    for name in [primary, *fallback_models]:
        key = (name or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        chain.append(key)
        if len(chain) > max_hops + 1:
            break
    return chain[: max_hops + 1]


def error_kind(exc: BaseException | None) -> str:
    if exc is None:
        return ""
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, (httpx.ConnectError, httpx.NetworkError)):
        return "connection_error"
    return "http_error"


def backoff_ms(policy: RetryPolicy, retry_index: int, response: httpx.Response | None) -> int:
    if policy.respect_retry_after and response is not None:
        retry_after = response.headers.get("Retry-After", "").strip()
        if retry_after.isdigit():
            return min(int(retry_after) * 1000, policy.max_backoff_ms)
    if retry_index < len(policy.backoff_ms):
        return min(policy.backoff_ms[retry_index], policy.max_backoff_ms)
    if policy.backoff_ms:
        return min(policy.backoff_ms[-1], policy.max_backoff_ms)
    return 200


def should_retry_same_model(
    *,
    policy: RetryPolicy,
    status_code: int | None,
    error_kind: str,
    retries_used: int,
) -> bool:
    if retries_used >= policy.max_retries_same_model:
        return False
    if status_code is not None:
        if status_code in NON_RETRYABLE_STATUS:
            return False
        if status_code in policy.retry_on_status:
            return True
        return False
    return error_kind in policy.retry_on_errors


def should_fallback(
    *,
    policy: RetryPolicy,
    status_code: int | None,
    error_kind: str,
    hop_index: int,
    chain_len: int,
) -> bool:
    if hop_index >= chain_len - 1:
        return False
    if status_code == 404:
        return True
    if status_code is not None:
        if status_code in NON_RETRYABLE_STATUS and status_code != 404:
            return False
        return status_code in policy.fallback_on_status
    return error_kind in policy.fallback_on_errors


async def post_chat_with_resilience(
    *,
    client: httpx.AsyncClient,
    build_call: Any,
    model_chain: list[str],
    policy: RetryPolicy,
    timeout_sec: float,
) -> UpstreamResult:
    """POST chat/completions with per-model retry and cross-model fallback."""
    result = UpstreamResult()
    total_attempts = 0
    deadline = time.perf_counter() + timeout_sec

    for hop_index, model_name in enumerate(model_chain):
        retries_on_hop = 0
        while True:
            if total_attempts >= policy.max_total_attempts:
                result.attempts.append(
                    AttemptRecord(
                        model=model_name,
                        attempt_index=total_attempts,
                        hop_index=hop_index,
                        action="aborted",
                        detail="max_total_attempts exceeded",
                    )
                )
                return result
            if time.perf_counter() >= deadline:
                result.error = "gateway timeout budget exceeded"
                return result

            total_attempts += 1
            target, headers, body = build_call(model_name)
            try:
                upstream = await client.post(target, json=body, headers=headers)
            except httpx.HTTPError as exc:
                kind = error_kind(exc)
                result.attempts.append(
                    AttemptRecord(
                        model=model_name,
                        attempt_index=total_attempts,
                        hop_index=hop_index,
                        action="error",
                        error_kind=kind,
                        detail=str(exc),
                    )
                )
                if should_retry_same_model(
                    policy=policy,
                    status_code=None,
                    error_kind=kind,
                    retries_used=retries_on_hop,
                ):
                    delay_ms = backoff_ms(policy, retries_on_hop, None)
                    result.attempts.append(
                        AttemptRecord(
                            model=model_name,
                            attempt_index=total_attempts,
                            hop_index=hop_index,
                            action="retry",
                            error_kind=kind,
                            detail=f"backoff {delay_ms}ms",
                        )
                    )
                    retries_on_hop += 1
                    await asyncio.sleep(delay_ms / 1000.0)
                    continue
                if should_fallback(
                    policy=policy,
                    status_code=None,
                    error_kind=kind,
                    hop_index=hop_index,
                    chain_len=len(model_chain),
                ):
                    result.attempts.append(
                        AttemptRecord(
                            model=model_name,
                            attempt_index=total_attempts,
                            hop_index=hop_index,
                            action="fallback",
                            error_kind=kind,
                        )
                    )
                    break
                result.status_code = 502
                result.error = str(exc)
                result.final_model = model_name
                return result

            if upstream.is_success:
                try:
                    data = upstream.json()
                except ValueError:
                    data = {"raw": upstream.text}
                result.response = upstream
                result.data = data
                result.status_code = upstream.status_code
                result.final_model = model_name
                result.success = True
                result.attempts.append(
                    AttemptRecord(
                        model=model_name,
                        attempt_index=total_attempts,
                        hop_index=hop_index,
                        action="success",
                        status_code=upstream.status_code,
                    )
                )
                return result

            err_text = upstream.text[:500]
            result.attempts.append(
                AttemptRecord(
                    model=model_name,
                    attempt_index=total_attempts,
                    hop_index=hop_index,
                    action="upstream_error",
                    status_code=upstream.status_code,
                    detail=err_text,
                )
            )
            if should_retry_same_model(
                policy=policy,
                status_code=upstream.status_code,
                error_kind="",
                retries_used=retries_on_hop,
            ):
                delay_ms = backoff_ms(policy, retries_on_hop, upstream)
                result.attempts.append(
                    AttemptRecord(
                        model=model_name,
                        attempt_index=total_attempts,
                        hop_index=hop_index,
                        action="retry",
                        status_code=upstream.status_code,
                        detail=f"backoff {delay_ms}ms",
                    )
                )
                retries_on_hop += 1
                await asyncio.sleep(delay_ms / 1000.0)
                continue

            if should_fallback(
                policy=policy,
                status_code=upstream.status_code,
                error_kind="",
                hop_index=hop_index,
                chain_len=len(model_chain),
            ):
                result.attempts.append(
                    AttemptRecord(
                        model=model_name,
                        attempt_index=total_attempts,
                        hop_index=hop_index,
                        action="fallback",
                        status_code=upstream.status_code,
                    )
                )
                break

            result.response = upstream
            result.status_code = upstream.status_code
            result.error = err_text
            result.final_model = model_name
            try:
                result.data = upstream.json()
            except ValueError:
                result.data = {"raw": upstream.text}
            return result

    result.error = result.error or "all models in chain failed"
    return result
