"""Run/event store for centrally hosted Claude coding agents."""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"

_conn: sqlite3.Connection | None = None

TERMINAL_STATUSES = {"succeeded", "failed", "cancelled"}
RUNNING_STATUSES = {"queued", "running"}


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "claude_agent_runs.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS claude_agent_runs (
            run_id              TEXT PRIMARY KEY,
            workspace_id        TEXT NOT NULL,
            account_id          TEXT NOT NULL,
            tenant_id           TEXT NOT NULL DEFAULT '',
            team_id             TEXT NOT NULL DEFAULT '',
            prompt              TEXT NOT NULL,
            model               TEXT NOT NULL DEFAULT '',
            status              TEXT NOT NULL DEFAULT 'queued',
            engine_id           TEXT NOT NULL DEFAULT 'claude-code-hosted',
            log_excerpt         TEXT NOT NULL DEFAULT '',
            result_summary      TEXT NOT NULL DEFAULT '',
            error               TEXT NOT NULL DEFAULT '',
            artifact_manifest   TEXT NOT NULL DEFAULT '[]',
            signals_json        TEXT NOT NULL DEFAULT '{}',
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            started_at          TEXT,
            completed_at        TEXT,
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_claude_agent_runs_workspace ON claude_agent_runs(workspace_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_claude_agent_runs_account ON claude_agent_runs(account_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_claude_agent_runs_status ON claude_agent_runs(status, created_at);

        CREATE TABLE IF NOT EXISTS claude_agent_run_events (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id              TEXT NOT NULL,
            event_type          TEXT NOT NULL,
            seq                 INTEGER NOT NULL DEFAULT 0,
            ts                  TEXT NOT NULL DEFAULT (datetime('now')),
            payload_json        TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_claude_agent_run_events_run ON claude_agent_run_events(run_id, seq, id);
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


def _run_from_row(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["artifact_manifest"] = _json_loads(item.get("artifact_manifest", "[]"), [])
    item["signals"] = _json_loads(item.pop("signals_json", "{}"), {})
    return item


def _event_from_row(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["payload"] = _json_loads(item.pop("payload_json", "{}"), {})
    return item


def create_run(
    *,
    workspace_id: str,
    account_id: str,
    prompt: str,
    tenant_id: str = "",
    team_id: str = "",
    model: str = "",
    signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    run_id = f"car_{uuid.uuid4().hex[:20]}"
    conn = _ensure_conn()
    conn.execute(
        """
        INSERT INTO claude_agent_runs (
            run_id, workspace_id, account_id, tenant_id, team_id, prompt, model,
            status, engine_id, signals_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'claude-code-hosted', ?, datetime('now'), datetime('now'))
        """,
        (
            run_id,
            workspace_id,
            account_id,
            tenant_id,
            team_id,
            prompt,
            model,
            _json_dumps(signals or {}),
        ),
    )
    append_event(run_id, "run.queued", {"workspace_id": workspace_id, "model": model})
    return get_run(run_id) or {}


def get_run(run_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM claude_agent_runs WHERE run_id=?",
        (run_id,),
    ).fetchone()
    return _run_from_row(row) if row else None


def list_runs(
    *,
    workspace_id: str | None = None,
    account_id: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    where: list[str] = []
    params: list[Any] = []
    if workspace_id:
        where.append("workspace_id=?")
        params.append(workspace_id)
    if account_id:
        where.append("account_id=?")
        params.append(account_id)
    if status:
        where.append("status=?")
        params.append(status)
    params.append(max(1, min(limit, 500)))
    clause = "WHERE " + " AND ".join(where) if where else ""
    rows = _ensure_conn().execute(
        f"SELECT * FROM claude_agent_runs {clause} ORDER BY created_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_run_from_row(row) for row in rows]


def update_run_status(
    run_id: str,
    *,
    status: str,
    log_excerpt: str | None = None,
    result_summary: str | None = None,
    error: str | None = None,
    artifact_manifest: list[dict[str, Any]] | None = None,
    signals: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if status not in {"queued", "running", "succeeded", "failed", "cancelled"}:
        raise ValueError("invalid run status")
    sets = ["status=?", "updated_at=datetime('now')"]
    values: list[Any] = [status]
    if status == "running":
        sets.append("started_at=COALESCE(started_at, datetime('now'))")
    if status in TERMINAL_STATUSES:
        sets.append("completed_at=COALESCE(completed_at, datetime('now'))")
    if log_excerpt is not None:
        sets.append("log_excerpt=?")
        values.append(log_excerpt[-65536:])
    if result_summary is not None:
        sets.append("result_summary=?")
        values.append(result_summary[:8000])
    if error is not None:
        sets.append("error=?")
        values.append(error[:4000])
    if artifact_manifest is not None:
        sets.append("artifact_manifest=?")
        values.append(_json_dumps(artifact_manifest))
    if signals is not None:
        sets.append("signals_json=?")
        values.append(_json_dumps(signals))
    values.append(run_id)
    _ensure_conn().execute(
        f"UPDATE claude_agent_runs SET {', '.join(sets)} WHERE run_id=?",
        values,
    )
    append_event(run_id, f"run.{status}", {"status": status})
    return get_run(run_id)


def append_event(run_id: str, event_type: str, payload: dict[str, Any] | None = None, *, seq: int | None = None) -> dict[str, Any]:
    conn = _ensure_conn()
    next_seq = seq
    if next_seq is None:
        row = conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM claude_agent_run_events WHERE run_id=?",
            (run_id,),
        ).fetchone()
        next_seq = int(row["next_seq"]) if row else 1
    cur = conn.execute(
        """
        INSERT INTO claude_agent_run_events (run_id, event_type, seq, ts, payload_json)
        VALUES (?, ?, ?, datetime('now'), ?)
        """,
        (run_id, event_type, next_seq, _json_dumps(payload or {})),
    )
    row = conn.execute("SELECT * FROM claude_agent_run_events WHERE id=?", (cur.lastrowid,)).fetchone()
    return _event_from_row(row)


def list_events(run_id: str, *, limit: int = 500) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        """
        SELECT * FROM claude_agent_run_events
        WHERE run_id=?
        ORDER BY seq ASC, id ASC
        LIMIT ?
        """,
        (run_id, max(1, min(limit, 1000))),
    ).fetchall()
    return [_event_from_row(row) for row in rows]


def active_run_count(account_id: str) -> int:
    row = _ensure_conn().execute(
        """
        SELECT COUNT(*) AS n FROM claude_agent_runs
        WHERE account_id=? AND status IN ('queued', 'running')
        """,
        (account_id,),
    ).fetchone()
    return int(row["n"]) if row else 0
