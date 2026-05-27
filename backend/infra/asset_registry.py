"""Asset registry — review layer for skills, prompts, workflows, etc."""
from __future__ import annotations

import json
import os
import secrets
import sqlite3
from pathlib import Path
from typing import Any, Literal

AssetStatus = Literal["pending", "approved", "rejected", "deprecated"]
AssetType = Literal["skill", "prompt", "workflow", "playbook", "memory_snippet", "tool_config", "evaluation_case"]

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"
_DATA_DIR = Path(os.environ.get("EVOTOWN_DATA_DIR", _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"))

_conn: sqlite3.Connection | None = None


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DATA_DIR / "asset_registry.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS assets (
            asset_id        TEXT PRIMARY KEY,
            asset_type      TEXT NOT NULL,
            source_run_id   TEXT NOT NULL DEFAULT '',
            name            TEXT NOT NULL,
            description     TEXT NOT NULL DEFAULT '',
            author          TEXT NOT NULL DEFAULT '',
            team_id         TEXT NOT NULL DEFAULT '',
            engine_id       TEXT NOT NULL DEFAULT '',
            version         TEXT NOT NULL DEFAULT '0.1.0',
            status          TEXT NOT NULL DEFAULT 'pending',
            tags            TEXT NOT NULL DEFAULT '[]',
            content         TEXT NOT NULL DEFAULT '{}',
            reviewer        TEXT NOT NULL DEFAULT '',
            review_reason   TEXT NOT NULL DEFAULT '',
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            reviewed_at     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
        CREATE INDEX IF NOT EXISTS idx_assets_run ON assets(source_run_id);
        CREATE INDEX IF NOT EXISTS idx_assets_team ON assets(team_id);
        """
    )
    _conn = conn
    return conn


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _asset_from_row(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["tags"] = _json_loads(str(item.get("tags") or "[]"), [])
    item["content"] = _json_loads(str(item.get("content") or "{}"), {})
    return item


def _new_asset_id(asset_type: str) -> str:
    return f"asset_{asset_type}_{secrets.token_hex(6)}"


def propose_asset(body: dict[str, Any]) -> dict[str, Any]:
    asset_id = str(body.get("asset_id") or "").strip() or _new_asset_id(str(body.get("asset_type") or "custom"))
    if get_asset(asset_id) is not None:
        raise ValueError(f"asset already exists: {asset_id}")
    conn = _ensure_conn()
    conn.execute(
        """
        INSERT INTO assets (
            asset_id, asset_type, source_run_id, name, description, author,
            team_id, engine_id, version, status, tags, content
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        """,
        (
            asset_id,
            str(body.get("asset_type") or "prompt"),
            str(body.get("source_run_id") or ""),
            str(body.get("name") or asset_id),
            str(body.get("description") or ""),
            str(body.get("author") or ""),
            str(body.get("team_id") or ""),
            str(body.get("engine_id") or ""),
            str(body.get("version") or "0.1.0"),
            _json_dumps(body.get("tags") or []),
            _json_dumps(body.get("content") or {}),
        ),
    )
    result = get_asset(asset_id)
    if result is None:
        raise RuntimeError("failed to create asset")
    return result


def get_asset(asset_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute("SELECT * FROM assets WHERE asset_id=?", (asset_id,)).fetchone()
    return _asset_from_row(row) if row else None


def list_assets(
    *,
    status: str | None = None,
    asset_type: str | None = None,
    team_id: str | None = None,
    source_run_id: str | None = None,
    query: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if status:
        clauses.append("status=?")
        params.append(status)
    if asset_type:
        clauses.append("asset_type=?")
        params.append(asset_type)
    if team_id:
        clauses.append("team_id=?")
        params.append(team_id)
    if source_run_id:
        clauses.append("source_run_id=?")
        params.append(source_run_id)
    if query:
        clauses.append("(lower(name) LIKE ? OR lower(description) LIKE ?)")
        q = f"%{query.lower()}%"
        params.extend([q, q])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(max(1, min(limit, 500)))
    rows = _ensure_conn().execute(
        f"SELECT * FROM assets {where} ORDER BY created_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_asset_from_row(row) for row in rows]


def review_asset(asset_id: str, *, decision: str, reviewer: str, reason: str = "") -> dict[str, Any] | None:
    asset = get_asset(asset_id)
    if asset is None:
        return None
    status = "approved" if decision == "approved" else "rejected"
    _ensure_conn().execute(
        """
        UPDATE assets
        SET status=?, reviewer=?, review_reason=?, reviewed_at=datetime('now')
        WHERE asset_id=?
        """,
        (status, reviewer, reason, asset_id),
    )
    return get_asset(asset_id)
