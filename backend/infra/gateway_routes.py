"""Gateway model alias → LiteLLM target routing."""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from infra.gateway_auto import parse_auto_policy, resolve_auto_model
from infra.gateway_retry import RetryPolicy, build_model_chain, parse_fallback_models

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


_conn: sqlite3.Connection | None = None


def _routes_table_ddl() -> str:
    return """
        CREATE TABLE IF NOT EXISTS gateway_model_routes (
            route_id      TEXT PRIMARY KEY,
            alias         TEXT NOT NULL,
            target_model  TEXT NOT NULL,
            team_id       TEXT NOT NULL DEFAULT '',
            account_id    TEXT NOT NULL DEFAULT '',
            description   TEXT NOT NULL DEFAULT '',
            priority      INTEGER NOT NULL DEFAULT 100,
            enabled       INTEGER NOT NULL DEFAULT 1,
            route_type    TEXT NOT NULL DEFAULT 'static',
            fallback_models TEXT NOT NULL DEFAULT '[]',
            retry_policy  TEXT NOT NULL DEFAULT '{}',
            auto_policy   TEXT NOT NULL DEFAULT '{}',
            enable_fallback INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_gw_routes_alias ON gateway_model_routes(alias, enabled);
        CREATE INDEX IF NOT EXISTS idx_gw_routes_scope ON gateway_model_routes(team_id, account_id);
    """


def _migrate_schema(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(gateway_model_routes)").fetchall()}
    if not cols:
        return
    # Repair botched migration that created a column literally named "TEXT".
    if "TEXT" in cols and "route_type" not in cols:
        rows = conn.execute("SELECT * FROM gateway_model_routes").fetchall()
        conn.execute("DROP TABLE gateway_model_routes")
        conn.executescript(_routes_table_ddl())
        for row in rows:
            keys = row.keys()
            conn.execute(
                """
                INSERT INTO gateway_model_routes (
                    route_id, alias, target_model, team_id, account_id, description,
                    priority, enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["route_id"],
                    row["alias"],
                    row["target_model"],
                    row["team_id"],
                    row["account_id"],
                    row["description"],
                    row["priority"],
                    row["enabled"],
                    row["created_at"],
                    row["updated_at"],
                ),
            )
        cols = {row[1] for row in conn.execute("PRAGMA table_info(gateway_model_routes)").fetchall()}

    additions = [
        ("route_type", "TEXT NOT NULL DEFAULT 'static'"),
        ("fallback_models", "TEXT NOT NULL DEFAULT '[]'"),
        ("retry_policy", "TEXT NOT NULL DEFAULT '{}'"),
        ("auto_policy", "TEXT NOT NULL DEFAULT '{}'"),
        ("enable_fallback", "INTEGER NOT NULL DEFAULT 1"),
    ]
    for name, col_type in additions:
        if name not in cols:
            conn.execute(f"ALTER TABLE gateway_model_routes ADD COLUMN {name} {col_type}")


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "gateway.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_routes_table_ddl())
    _migrate_schema(conn)
    _conn = conn
    return conn


def _parse_json_field(raw: Any, default: Any) -> Any:
    if raw is None:
        return default
    if isinstance(raw, (dict, list)):
        return raw
    text = str(raw).strip()
    if not text:
        return default
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return default


def list_routes(*, enabled_only: bool = False) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    where = "WHERE enabled=1" if enabled_only else ""
    rows = conn.execute(
        f"SELECT * FROM gateway_model_routes {where} ORDER BY priority ASC, alias ASC",
    ).fetchall()
    return [_row_to_dict(row) for row in rows]


def create_route(
    *,
    alias: str,
    target_model: str,
    team_id: str = "",
    account_id: str = "",
    description: str = "",
    priority: int = 100,
    enabled: bool = True,
    route_type: str = "static",
    fallback_models: list[str] | str | None = None,
    retry_policy: dict[str, Any] | None = None,
    auto_policy: dict[str, Any] | None = None,
    enable_fallback: bool = True,
) -> dict[str, Any]:
    conn = _ensure_conn()
    route_id = f"gr_{uuid.uuid4().hex[:12]}"
    fallbacks = parse_fallback_models(fallback_models or [])
    conn.execute(
        """
        INSERT INTO gateway_model_routes (
            route_id, alias, target_model, team_id, account_id, description, priority, enabled,
            route_type, fallback_models, retry_policy, auto_policy, enable_fallback
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            route_id,
            alias.strip(),
            target_model.strip(),
            team_id.strip(),
            account_id.strip(),
            description.strip(),
            int(priority),
            1 if enabled else 0,
            (route_type or "static").strip(),
            json.dumps(fallbacks, ensure_ascii=False),
            json.dumps(retry_policy or {}, ensure_ascii=False),
            json.dumps(auto_policy or {}, ensure_ascii=False),
            1 if enable_fallback else 0,
        ),
    )
    return get_route(route_id) or {"route_id": route_id}


def get_route(route_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM gateway_model_routes WHERE route_id=?",
        (route_id,),
    ).fetchone()
    return _row_to_dict(row) if row else None


def update_route(route_id: str, **fields: Any) -> dict[str, Any] | None:
    if get_route(route_id) is None:
        return None
    allowed = {
        "alias",
        "target_model",
        "team_id",
        "account_id",
        "description",
        "priority",
        "enabled",
        "route_type",
        "fallback_models",
        "retry_policy",
        "auto_policy",
        "enable_fallback",
    }
    updates: list[str] = []
    params: list[Any] = []
    for key, value in fields.items():
        if key not in allowed or value is None:
            continue
        if key == "enabled":
            value = 1 if value else 0
        elif key == "enable_fallback":
            value = 1 if value else 0
        elif key == "priority":
            value = int(value)
        elif key == "fallback_models":
            value = json.dumps(parse_fallback_models(value), ensure_ascii=False)
        elif key in ("retry_policy", "auto_policy"):
            value = json.dumps(value if isinstance(value, dict) else {}, ensure_ascii=False)
        updates.append(f"{key}=?")
        params.append(value)
    if not updates:
        return get_route(route_id)
    updates.append("updated_at=datetime('now')")
    params.append(route_id)
    _ensure_conn().execute(
        f"UPDATE gateway_model_routes SET {', '.join(updates)} WHERE route_id=?",
        params,
    )
    return get_route(route_id)


def delete_route(route_id: str) -> bool:
    cur = _ensure_conn().execute("DELETE FROM gateway_model_routes WHERE route_id=?", (route_id,))
    return cur.rowcount > 0


def _match_route_row(
    alias: str,
    *,
    account_id: str = "",
    team_id: str = "",
) -> dict[str, Any] | None:
    conn = _ensure_conn()
    rows = conn.execute(
        """
        SELECT * FROM gateway_model_routes
        WHERE enabled=1 AND alias=?
        ORDER BY priority ASC, updated_at DESC
        """,
        (alias,),
    ).fetchall()
    if not rows:
        return None

    account_id = (account_id or "").strip()
    team_id = (team_id or "").strip()

    for scope in ("account", "team", "global"):
        for row in rows:
            item = _row_to_dict(row)
            if scope == "account" and account_id and item.get("account_id") == account_id:
                return item
            if scope == "team" and team_id and not item.get("account_id") and item.get("team_id") == team_id:
                return item
            if scope == "global" and not item.get("account_id") and not item.get("team_id"):
                return item
    return None


def resolve_target_model(
    alias: str,
    *,
    account_id: str = "",
    team_id: str = "",
    body: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any] | None]:
    """Return (target_model, matched_route_or_none)."""
    alias = (alias or "").strip()
    if not alias:
        return alias, None

    matched = _match_route_row(alias, account_id=account_id, team_id=team_id)
    if not matched:
        return alias, None

    route_type = (matched.get("route_type") or "static").strip().lower()
    if route_type == "auto" or alias.lower() == "auto":
        auto_policy = matched.get("auto_policy") if isinstance(matched.get("auto_policy"), dict) else {}
        model, tier, reason = resolve_auto_model(body or {}, auto_policy)
        if model:
            matched = {
                **matched,
                "evotown_auto_tier": tier,
                "evotown_auto_reason": reason,
            }
            return model, matched
        target = (matched.get("target_model") or "").strip()
        return target or alias, matched

    target = (matched.get("target_model") or "").strip()
    return target or alias, matched


def resolve_model_chain(
    client_model: str,
    *,
    account_id: str = "",
    team_id: str = "",
    body: dict[str, Any] | None = None,
) -> tuple[list[str], dict[str, Any] | None, RetryPolicy, bool]:
    """Return (model_chain, matched_route, retry_policy, routing_via_alias)."""
    client_model = (client_model or "").strip()
    target, matched = resolve_target_model(
        client_model,
        account_id=account_id,
        team_id=team_id,
        body=body,
    )
    via_alias = matched is not None

    retry_raw = {}
    enable_fallback = True
    fallbacks: list[str] = []
    if matched:
        retry_raw = matched.get("retry_policy") if isinstance(matched.get("retry_policy"), dict) else {}
        enable_fallback = bool(matched.get("enable_fallback", True))
        fallbacks = parse_fallback_models(matched.get("fallback_models"))

    policy = RetryPolicy.from_dict(retry_raw)

    if not via_alias:
        return [client_model or target], None, policy, False

    primary = target or client_model
    if enable_fallback and fallbacks:
        chain = build_model_chain(primary, fallbacks, max_hops=policy.max_fallback_hops)
    else:
        chain = [primary]
    return chain, matched, policy, True


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["enabled"] = bool(item.get("enabled", 1))
    item["enable_fallback"] = bool(item.get("enable_fallback", 1))
    item["route_type"] = (item.get("route_type") or "static").strip()
    item["fallback_models"] = parse_fallback_models(_parse_json_field(item.get("fallback_models"), []))
    item["retry_policy"] = _parse_json_field(item.get("retry_policy"), {})
    item["auto_policy"] = parse_auto_policy(_parse_json_field(item.get("auto_policy"), {}))
    return item
