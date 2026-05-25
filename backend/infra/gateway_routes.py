"""Gateway model alias → LiteLLM target routing."""
from __future__ import annotations

import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


_conn: sqlite3.Connection | None = None


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "gateway.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS gateway_model_routes (
            route_id      TEXT PRIMARY KEY,
            alias         TEXT NOT NULL,
            target_model  TEXT NOT NULL,
            team_id       TEXT NOT NULL DEFAULT '',
            account_id    TEXT NOT NULL DEFAULT '',
            description   TEXT NOT NULL DEFAULT '',
            priority      INTEGER NOT NULL DEFAULT 100,
            enabled       INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_gw_routes_alias ON gateway_model_routes(alias, enabled);
        CREATE INDEX IF NOT EXISTS idx_gw_routes_scope ON gateway_model_routes(team_id, account_id);
        """
    )
    _conn = conn
    return conn


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
) -> dict[str, Any]:
    conn = _ensure_conn()
    route_id = f"gr_{uuid.uuid4().hex[:12]}"
    conn.execute(
        """
        INSERT INTO gateway_model_routes (
            route_id, alias, target_model, team_id, account_id, description, priority, enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
    allowed = {"alias", "target_model", "team_id", "account_id", "description", "priority", "enabled"}
    updates: list[str] = []
    params: list[Any] = []
    for key, value in fields.items():
        if key not in allowed or value is None:
            continue
        if key == "enabled":
            value = 1 if value else 0
        if key == "priority":
            value = int(value)
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


def resolve_target_model(
    alias: str,
    *,
    account_id: str = "",
    team_id: str = "",
) -> tuple[str, dict[str, Any] | None]:
    """Return (target_model, matched_route_or_none)."""
    alias = (alias or "").strip()
    if not alias:
        return alias, None
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
        return alias, None

    account_id = (account_id or "").strip()
    team_id = (team_id or "").strip()

    for scope in ("account", "team", "global"):
        for row in rows:
            item = _row_to_dict(row)
            if scope == "account" and account_id and item.get("account_id") == account_id:
                return item["target_model"], item
            if scope == "team" and team_id and not item.get("account_id") and item.get("team_id") == team_id:
                return item["target_model"], item
            if scope == "global" and not item.get("account_id") and not item.get("team_id"):
                return item["target_model"], item
    return alias, None


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["enabled"] = bool(item.get("enabled", 1))
    return item
