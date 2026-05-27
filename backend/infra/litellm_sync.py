"""Best-effort sync of Evotown upstream models into LiteLLM proxy."""
from __future__ import annotations

import os
from typing import Any

import httpx


def _litellm_base_url() -> str:
    return os.environ.get("LITELLM_BASE_URL", "").rstrip("/")


def _litellm_admin_root() -> str:
    base = _litellm_base_url()
    if not base:
        return ""
    if base.endswith("/v1"):
        return base[:-3]
    return base


def _auth_headers() -> dict[str, str]:
    token = os.environ.get("LITELLM_MASTER_KEY", "").strip() or os.environ.get("LITELLM_API_KEY", "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


def litellm_configured() -> bool:
    return bool(_litellm_admin_root() and _auth_headers())


def _litellm_model_param(model_name: str, litellm_model: str) -> str:
    explicit = (litellm_model or "").strip()
    if explicit:
        return explicit
    if "/" in model_name:
        return model_name
    return f"openai/{model_name}"


async def sync_upstream_model(
    *,
    model_name: str,
    api_base: str,
    api_key: str,
    litellm_model: str = "",
) -> dict[str, Any]:
    """POST /model/new on LiteLLM. Returns {ok, litellm_model_id, error}."""
    root = _litellm_admin_root()
    if not root:
        return {"ok": False, "error": "LITELLM_BASE_URL is not configured"}
    headers = {"Content-Type": "application/json", **_auth_headers()}
    if not headers.get("Authorization"):
        return {"ok": False, "error": "LITELLM_MASTER_KEY is not configured"}

    payload = {
        "model_name": model_name.strip(),
        "litellm_params": {
            "model": _litellm_model_param(model_name, litellm_model),
            "api_key": api_key,
            "api_base": api_base.rstrip("/"),
        },
        "model_info": {"managed_by": "evotown"},
    }
    url = f"{root}/model/new"
    timeout = float(os.environ.get("EVOTOWN_GATEWAY_TIMEOUT_SEC", "30"))
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        return {"ok": False, "error": str(exc)}

    if resp.status_code >= 400:
        detail = resp.text[:500]
        try:
            body = resp.json()
            if isinstance(body, dict):
                detail = str(body.get("detail") or body.get("error") or detail)
        except ValueError:
            pass
        return {"ok": False, "error": detail or f"HTTP {resp.status_code}"}

    litellm_model_id = ""
    try:
        data = resp.json()
        if isinstance(data, dict):
            info = data.get("model_info")
            if isinstance(info, dict) and info.get("id"):
                litellm_model_id = str(info["id"])
            elif data.get("model_id"):
                litellm_model_id = str(data["model_id"])
    except ValueError:
        pass
    return {"ok": True, "litellm_model_id": litellm_model_id, "error": ""}
