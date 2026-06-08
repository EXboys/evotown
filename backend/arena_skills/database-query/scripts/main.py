#!/usr/bin/env python3
"""Query registered business databases via Evotown Database MCP Proxy (read-only)."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


def _proxy_base() -> str:
    return os.environ.get("EVOTOWN_DB_MCP_URL", "http://localhost:9100").rstrip("/")


def _api_key(input_data: dict) -> str:
    key = str(input_data.get("api_key") or os.environ.get("EVOTOWN_EMPLOYEE_API_KEY") or "").strip()
    if not key:
        raise ValueError("api_key is required (or set EVOTOWN_EMPLOYEE_API_KEY)")
    return key


def _request(method: str, path: str, api_key: str, body: dict | None = None) -> dict:
    url = f"{_proxy_base()}{path}"
    data = None
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(detail)
            message = parsed.get("detail", detail)
        except json.JSONDecodeError:
            message = detail
        raise RuntimeError(f"HTTP {exc.code}: {message}") from exc


def main() -> None:
    input_data = json.loads(sys.stdin.read() or "{}")
    action = str(input_data.get("action") or "query").strip().lower()
    api_key = _api_key(input_data)

    if action == "list_connections":
        result = _request("GET", "/catalog", api_key)
    elif action == "list_tables":
        connection_id = str(input_data.get("connection_id") or "").strip()
        if not connection_id:
            raise ValueError("connection_id is required for list_tables")
        result = _request("GET", f"/connections/{connection_id}/tables", api_key)
    elif action == "query":
        connection_id = str(input_data.get("connection_id") or "").strip()
        sql = str(input_data.get("sql") or "").strip()
        if not connection_id or not sql:
            raise ValueError("connection_id and sql are required for query")
        result = _request("POST", "/query", api_key, {"connection_id": connection_id, "sql": sql})
    else:
        raise ValueError(f"unknown action: {action}")

    print(json.dumps(result, ensure_ascii=False, default=str))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
