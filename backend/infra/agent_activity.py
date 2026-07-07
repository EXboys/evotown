"""Cross-store aggregation for enterprise agent activity audit (#204)."""
from __future__ import annotations

from typing import Any

from infra import accounts as accounts_store
from infra import claude_agent_runs
from infra import gateway
from infra import mcp_registry


def _merge_account_row(
    merged: dict[str, dict[str, Any]],
    account_id: str,
    *,
    run_count: int = 0,
    mcp_calls: int = 0,
    gateway_requests: int = 0,
    total_tokens: int = 0,
    cost_usd: float = 0.0,
) -> None:
    if not account_id:
        return
    row = merged.setdefault(
        account_id,
        {
            "account_id": account_id,
            "run_count": 0,
            "mcp_calls": 0,
            "gateway_requests": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
        },
    )
    row["run_count"] += int(run_count)
    row["mcp_calls"] += int(mcp_calls)
    row["gateway_requests"] += int(gateway_requests)
    row["total_tokens"] += int(total_tokens)
    row["cost_usd"] += float(cost_usd)


def _enrich_accounts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    org_cache: dict[str, dict[str, Any] | None] = {}
    enriched: list[dict[str, Any]] = []
    for row in rows:
        account_id = row["account_id"]
        account = accounts_store.get_account(account_id)
        org_id = (account or {}).get("org_id", "")
        org_name = ""
        if org_id:
            if org_id not in org_cache:
                org_cache[org_id] = accounts_store.get_gateway_org(org_id)
            org = org_cache[org_id]
            org_name = (org or {}).get("name", org_id)
        enriched.append(
            {
                **row,
                "account_name": (account or {}).get("name", account_id),
                "org_id": org_id,
                "org_name": org_name,
            }
        )
    return enriched


def aggregate_by_account(
    *,
    from_ts: str | None = None,
    to_ts: str | None = None,
    org_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """Merge run / MCP / gateway counts grouped by account_id."""
    merged: dict[str, dict[str, Any]] = {}

    for item in claude_agent_runs.count_runs_by_account(from_ts=from_ts, to_ts=to_ts):
        _merge_account_row(merged, item["account_id"], run_count=item["run_count"])

    for item in mcp_registry.count_mcp_calls_by_account(from_ts=from_ts, to_ts=to_ts):
        _merge_account_row(merged, item["account_id"], mcp_calls=item["mcp_calls"])

    for item in gateway.count_requests_by_account(from_ts=from_ts, to_ts=to_ts):
        _merge_account_row(
            merged,
            item["account_id"],
            gateway_requests=item["gateway_requests"],
            total_tokens=item["total_tokens"],
            cost_usd=item["cost_usd"],
        )

    rows = _enrich_accounts(list(merged.values()))
    if org_id:
        rows = [row for row in rows if row.get("org_id") == org_id]

    rows.sort(
        key=lambda row: (
            row["run_count"] + row["mcp_calls"] + row["gateway_requests"],
            row["run_count"],
        ),
        reverse=True,
    )

    effective_limit = max(1, min(limit, 500))
    effective_offset = max(0, offset)
    page = rows[effective_offset : effective_offset + effective_limit]
    has_more = len(rows) > effective_offset + effective_limit

    return {
        "from": from_ts,
        "to": to_ts,
        "org_id": org_id or "",
        "total_accounts": len(rows),
        "summary": page,
        "has_more": has_more,
        "limit": effective_limit,
        "offset": effective_offset,
    }


def list_account_runs(
    account_id: str,
    *,
    from_ts: str | None = None,
    to_ts: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    payload = claude_agent_runs.list_runs_for_account(
        account_id,
        from_ts=from_ts,
        to_ts=to_ts,
        limit=limit,
        offset=offset,
    )
    run_ids = [run["run_id"] for run in payload["runs"]]
    mcp_counts = mcp_registry.count_mcp_calls_by_run_ids(run_ids)
    for run in payload["runs"]:
        run["mcp_calls"] = mcp_counts.get(run["run_id"], 0)
    payload["account_id"] = account_id
    payload["from"] = from_ts
    payload["to"] = to_ts
    return payload


def build_timeline(
    *,
    account_id: str | None = None,
    from_ts: str | None = None,
    to_ts: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """Mixed chronological feed of runs, MCP calls, and gateway requests."""
    fetch_cap = max(1, min(limit + offset, 500))
    events: list[dict[str, Any]] = []

    if account_id:
        runs = claude_agent_runs.list_runs_for_account(
            account_id,
            from_ts=from_ts,
            to_ts=to_ts,
            limit=fetch_cap,
            offset=0,
        )["runs"]
    else:
        runs = claude_agent_runs.list_runs_in_range(
            from_ts=from_ts,
            to_ts=to_ts,
            limit=fetch_cap,
        )
    for run in runs:
        events.append(
            {
                "kind": "run",
                "ts": run.get("created_at") or "",
                "account_id": run.get("account_id", ""),
                "run_id": run["run_id"],
                "agent_id": run.get("agent_id", ""),
                "status": run.get("status", ""),
                "prompt": (run.get("prompt") or "")[:120],
            }
        )

    mcp_rows = (
        mcp_registry.list_mcp_calls_for_account(
            account_id,
            from_ts=from_ts,
            to_ts=to_ts,
            limit=fetch_cap,
            offset=0,
        )
        if account_id
        else mcp_registry.list_mcp_calls_in_range(
            from_ts=from_ts,
            to_ts=to_ts,
            limit=fetch_cap,
            offset=0,
        )
    )
    for call in mcp_rows:
        events.append(
            {
                "kind": "mcp",
                "ts": call.get("called_at") or "",
                "account_id": call.get("account_id", ""),
                "run_id": call.get("run_id", ""),
                "agent_id": call.get("agent_id", ""),
                "service_id": call.get("service_id", ""),
                "status": call.get("status", ""),
                "args": (call.get("args") or "")[:120],
            }
        )

    gateway_rows = (
        gateway.list_requests_for_account(
            account_id,
            from_ts=from_ts,
            to_ts=to_ts,
            limit=fetch_cap,
            offset=0,
        )
        if account_id
        else gateway.list_requests_in_range(
            from_ts=from_ts,
            to_ts=to_ts,
            limit=fetch_cap,
            offset=0,
        )
    )
    for req in gateway_rows:
        events.append(
            {
                "kind": "gateway",
                "ts": req.get("created_at") or "",
                "account_id": req.get("account_id", ""),
                "request_id": req.get("request_id", ""),
                "agent_id": req.get("agent_id", ""),
                "model": req.get("model", ""),
                "status_code": req.get("status_code", 0),
                "total_tokens": req.get("total_tokens", 0),
            }
        )

    events.sort(key=lambda item: item.get("ts") or "", reverse=True)
    effective_limit = max(1, min(limit, 500))
    effective_offset = max(0, offset)
    page = events[effective_offset : effective_offset + effective_limit]
    return {
        "from": from_ts,
        "to": to_ts,
        "account_id": account_id or "",
        "events": page,
        "has_more": len(events) > effective_offset + effective_limit,
        "limit": effective_limit,
        "offset": effective_offset,
    }
