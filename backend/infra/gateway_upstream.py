"""Build per-model upstream targets for the Evotown gateway."""
from __future__ import annotations

import copy
import os
from typing import Any

from fastapi import HTTPException, status

from infra import gateway_models as gateway_models_store


def litellm_base_url() -> str:
    return os.environ.get("LITELLM_BASE_URL", "").rstrip("/")


def litellm_anthropic_base_url() -> str:
    return (os.environ.get("LITELLM_ANTHROPIC_BASE_URL", "").strip() or litellm_base_url()).rstrip("/")


def litellm_auth_header() -> dict[str, str]:
    token = os.environ.get("LITELLM_MASTER_KEY", "").strip() or os.environ.get("LITELLM_API_KEY", "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


def build_upstream_call(
    body: dict[str, Any],
    effective_model: str,
) -> tuple[str, dict[str, str], dict[str, Any]]:
    """Return (url, headers, request_body) for one upstream chat/completions call."""
    req = copy.deepcopy(body)
    req["model"] = effective_model
    metadata = req.get("metadata") if isinstance(req.get("metadata"), dict) else {}
    req["metadata"] = {**metadata, "evotown_effective_model": effective_model}

    managed = gateway_models_store.get_by_model_name(effective_model)
    if managed:
        api_base = managed.get("_api_base") or ""
        if not api_base.startswith("http"):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Upstream model '{effective_model}' has invalid api_base.",
            )
        req["model"] = managed.get("_litellm_model") or effective_model
        req["metadata"]["evotown_upstream_model_id"] = managed.get("model_id", "")
        req["metadata"]["evotown_upstream_mode"] = "managed"
        target = f"{api_base.rstrip('/')}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {managed.get('_api_key', '')}",
        }
        return target, headers, req

    litellm_base = litellm_base_url()
    if not litellm_base:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"Model '{effective_model}' is not registered in Evotown and LITELLM_BASE_URL is not configured. "
                "Add the model under Gateway → 上游模型 in the console."
            ),
        )
    req["metadata"]["evotown_upstream_mode"] = "litellm"
    target = f"{litellm_base}/chat/completions"
    headers = {"Content-Type": "application/json", **litellm_auth_header()}
    return target, headers, req


def build_anthropic_upstream_call(
    body: dict[str, Any],
    effective_model: str,
    *,
    request_headers: dict[str, str] | None = None,
) -> tuple[str, dict[str, str], dict[str, Any]]:
    """Return (url, headers, request_body) for one Anthropic /messages call."""
    req = copy.deepcopy(body)
    req["model"] = effective_model
    req.pop("metadata", None)

    forwarded = _anthropic_forward_headers(request_headers or {})
    managed = gateway_models_store.get_by_model_name(effective_model)
    if managed:
        # Claude Code sends Anthropic /messages payloads. Managed upstream
        # api_base entries are OpenAI-compatible, so route through LiteLLM for
        # Anthropic -> OpenAI translation and only reuse their model mapping.
        req["model"] = managed.get("_litellm_model") or effective_model

    litellm_base = litellm_anthropic_base_url()
    if not litellm_base:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"Model '{effective_model}' is not registered in Evotown and LITELLM_ANTHROPIC_BASE_URL is not configured. "
                "Configure a LiteLLM Anthropic-compatible endpoint or add the model under Gateway → 上游模型."
            ),
        )
    target = f"{litellm_base}/messages"
    headers = {"Content-Type": "application/json", **litellm_auth_header(), **forwarded}
    return target, headers, req


def _anthropic_forward_headers(headers: dict[str, str]) -> dict[str, str]:
    allowed = {
        "anthropic-version",
        "anthropic-beta",
        "anthropic-dangerous-direct-browser-access",
    }
    return {
        key: value
        for key, value in headers.items()
        if key.lower() in allowed and value
    }
