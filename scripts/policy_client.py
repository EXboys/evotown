"""Stdlib policy client for Evotown connector (pull + evaluate)."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_POLICY_CACHE = Path.home() / ".config" / "evotown" / "policies-cache.json"


def http_json(
    method: str,
    url: str,
    *,
    token: str,
    body: dict | None = None,
    timeout: int = 30,
) -> tuple[int, dict[str, Any]]:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"detail": raw or exc.reason}
        return exc.code, payload


def pull_policies(base_url: str, token: str, *, cache_path: Path = DEFAULT_POLICY_CACHE) -> dict[str, Any]:
    status, payload = http_json("GET", f"{base_url.rstrip('/')}/api/v1/policies?enabled_only=true", token=token)
    if status != 200:
        raise RuntimeError(f"pull policies failed ({status}): {payload.get('detail', payload)}")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cached = {"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **payload}
    cache_path.write_text(json.dumps(cached, ensure_ascii=False, indent=2), encoding="utf-8")
    return cached


def evaluate(
    base_url: str,
    token: str,
    *,
    kind: str,
    resource: str,
    run_id: str = "",
    engine_id: str = "",
    workspace_roots: list[str] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "kind": kind,
        "resource": resource,
        "run_id": run_id,
        "engine_id": engine_id,
        "workspace_roots": workspace_roots or [],
        "extra": extra or {},
    }
    status, payload = http_json(
        "POST",
        f"{base_url.rstrip('/')}/api/v1/policy/evaluate",
        token=token,
        body=body,
    )
    if status != 200:
        raise RuntimeError(f"policy evaluate failed ({status}): {payload.get('detail', payload)}")
    return payload


def enforce(
    base_url: str,
    token: str,
    *,
    kind: str,
    resource: str,
    run_id: str = "",
    engine_id: str = "",
    workspace_roots: list[str] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = evaluate(
        base_url,
        token,
        kind=kind,
        resource=resource,
        run_id=run_id,
        engine_id=engine_id,
        workspace_roots=workspace_roots,
        extra=extra,
    )
    if not result.get("allowed", True):
        hits = result.get("hits") or []
        message = hits[0].get("message") if hits else "blocked by policy"
        raise PolicyBlockedError(message, result)
    return result


class PolicyBlockedError(Exception):
    def __init__(self, message: str, evaluation: dict[str, Any]) -> None:
        super().__init__(message)
        self.evaluation = evaluation
