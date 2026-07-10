"""Unified task board nodes — sync dispatch_jobs + hosted agent runs."""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from infra import agent_dispatch, claude_agent_runs, hosted_agent_engines

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"

_conn: sqlite3.Connection | None = None

BOARD_STATUSES = ("queued", "running", "done", "failed")
SOURCE_DISPATCH = "dispatch_job"
SOURCE_HOSTED_RUN = "hosted_run"

_DISPATCH_TO_BOARD = {
    "queued": "queued",
    "leased": "queued",
    "running": "running",
    "completed": "done",
    "failed": "failed",
    "cancelled": "failed",
}

_RUN_TO_BOARD = {
    "queued": "queued",
    "running": "running",
    "succeeded": "done",
    "failed": "failed",
    "cancelled": "failed",
}


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "task_nodes.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS task_nodes (
            node_id              TEXT PRIMARY KEY,
            agent_id             TEXT NOT NULL DEFAULT '',
            source_type          TEXT NOT NULL,
            source_id            TEXT NOT NULL,
            title                TEXT NOT NULL DEFAULT '',
            message              TEXT NOT NULL DEFAULT '',
            board_status         TEXT NOT NULL DEFAULT 'queued',
            source_status        TEXT NOT NULL DEFAULT '',
            depends_on_node_id   TEXT NOT NULL DEFAULT '',
            sequence             INTEGER NOT NULL DEFAULT 0,
            run_id               TEXT NOT NULL DEFAULT '',
            dispatch_job_id      TEXT NOT NULL DEFAULT '',
            payload_json         TEXT NOT NULL DEFAULT '{}',
            refs_json            TEXT NOT NULL DEFAULT '{}',
            created_at           TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at         TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_task_nodes_source
            ON task_nodes(source_type, source_id);
        CREATE INDEX IF NOT EXISTS idx_task_nodes_agent_board
            ON task_nodes(agent_id, board_status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_task_nodes_depends
            ON task_nodes(depends_on_node_id);
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


def _node_from_row(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["payload"] = _json_loads(item.pop("payload_json", "{}"), {})
    item["refs"] = _json_loads(item.pop("refs_json", "{}"), {})
    return item


def _agent_id_from_dispatch_job(job: dict[str, Any]) -> str:
    engine_id = str(job.get("target_engine_id") or "")
    agent_id = hosted_agent_engines.agent_id_from_engine(engine_id)
    return agent_id or ""


def _board_status_from_dispatch(status: str) -> str:
    return _DISPATCH_TO_BOARD.get(status, "queued")


def _board_status_from_run(status: str) -> str:
    return _RUN_TO_BOARD.get(status, "queued")


def _resolve_depends_on_node_id(parent_source_id: str, *, source_type: str) -> str:
    if not parent_source_id:
        return ""
    row = _ensure_conn().execute(
        "SELECT node_id FROM task_nodes WHERE source_type=? AND source_id=?",
        (source_type, parent_source_id),
    ).fetchone()
    return str(row["node_id"]) if row else ""


def upsert_from_dispatch_job(job: dict[str, Any]) -> dict[str, Any]:
    job_id = str(job.get("job_id") or "")
    if not job_id:
        raise ValueError("job_id is required")

    agent_id = _agent_id_from_dispatch_job(job)
    refs = job.get("refs") if isinstance(job.get("refs"), dict) else {}
    parent_job_id = str(refs.get("parent_job_id") or "")
    depends_on = _resolve_depends_on_node_id(parent_job_id, source_type=SOURCE_DISPATCH) if parent_job_id else ""

    run_id = str(job.get("run_id") or "")
    source_status = str(job.get("status") or "queued")
    board_status = _board_status_from_dispatch(source_status)

    if run_id:
        run = claude_agent_runs.get_run(run_id)
        if run:
            board_status = _board_status_from_run(str(run.get("status") or source_status))
            source_status = str(run.get("status") or source_status)

    conn = _ensure_conn()
    existing = conn.execute(
        "SELECT node_id FROM task_nodes WHERE source_type=? AND source_id=?",
        (SOURCE_DISPATCH, job_id),
    ).fetchone()

    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    title = str(job.get("title") or "")
    message = str(job.get("message") or "")
    completed_at = job.get("completed_at")

    if existing:
        conn.execute(
            """
            UPDATE task_nodes
            SET agent_id=?, title=?, message=?, board_status=?, source_status=?,
                depends_on_node_id=?, run_id=?, dispatch_job_id=?, payload_json=?,
                refs_json=?, updated_at=datetime('now'),
                completed_at=COALESCE(?, completed_at)
            WHERE node_id=?
            """,
            (
                agent_id,
                title,
                message,
                board_status,
                source_status,
                depends_on,
                run_id,
                job_id,
                _json_dumps(payload),
                _json_dumps(refs),
                completed_at,
                existing["node_id"],
            ),
        )
        node_id = str(existing["node_id"])
    else:
        node_id = f"tn_{uuid.uuid4().hex[:20]}"
        conn.execute(
            """
            INSERT INTO task_nodes (
                node_id, agent_id, source_type, source_id, title, message,
                board_status, source_status, depends_on_node_id, run_id,
                dispatch_job_id, payload_json, refs_json, created_at, updated_at,
                completed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
            """,
            (
                node_id,
                agent_id,
                SOURCE_DISPATCH,
                job_id,
                title,
                message,
                board_status,
                source_status,
                depends_on,
                run_id,
                job_id,
                _json_dumps(payload),
                _json_dumps(refs),
                job.get("created_at"),
                completed_at,
            ),
        )

    row = conn.execute("SELECT * FROM task_nodes WHERE node_id=?", (node_id,)).fetchone()
    assert row is not None
    return _node_from_row(row)


def upsert_from_hosted_run(run: dict[str, Any]) -> dict[str, Any] | None:
    run_id = str(run.get("run_id") or "")
    if not run_id:
        raise ValueError("run_id is required")

    signals = run.get("signals") if isinstance(run.get("signals"), dict) else {}
    dispatch_job_id = str(signals.get("dispatch_job_id") or "")
    if dispatch_job_id:
        job = agent_dispatch.get_job(dispatch_job_id)
        if job:
            return upsert_from_dispatch_job(job)
        return None

    agent_id = str(run.get("agent_id") or "")
    source_status = str(run.get("status") or "queued")
    board_status = _board_status_from_run(source_status)
    prompt = str(run.get("prompt") or "")

    conn = _ensure_conn()
    existing = conn.execute(
        "SELECT node_id FROM task_nodes WHERE source_type=? AND source_id=?",
        (SOURCE_HOSTED_RUN, run_id),
    ).fetchone()

    if existing:
        conn.execute(
            """
            UPDATE task_nodes
            SET agent_id=?, message=?, board_status=?, source_status=?,
                run_id=?, updated_at=datetime('now'),
                completed_at=COALESCE(?, completed_at)
            WHERE node_id=?
            """,
            (
                agent_id,
                prompt,
                board_status,
                source_status,
                run_id,
                run.get("completed_at"),
                existing["node_id"],
            ),
        )
        node_id = str(existing["node_id"])
    else:
        node_id = f"tn_{uuid.uuid4().hex[:20]}"
        conn.execute(
            """
            INSERT INTO task_nodes (
                node_id, agent_id, source_type, source_id, title, message,
                board_status, source_status, run_id, payload_json, refs_json,
                created_at, updated_at, completed_at
            )
            VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, '{}', '{}', ?, datetime('now'), ?)
            """,
            (
                node_id,
                agent_id,
                SOURCE_HOSTED_RUN,
                run_id,
                prompt,
                board_status,
                source_status,
                run_id,
                run.get("created_at"),
                run.get("completed_at"),
            ),
        )

    row = conn.execute("SELECT * FROM task_nodes WHERE node_id=?", (node_id,)).fetchone()
    return _node_from_row(row) if row else None


def sync_recent(*, limit: int = 500) -> int:
    """Refresh task_nodes from dispatch_jobs and hosted runs. Returns upsert count."""
    count = 0
    for job in agent_dispatch.list_jobs(limit=limit):
        upsert_from_dispatch_job(job)
        count += 1

    runs_payload = claude_agent_runs.list_runs(limit=limit)
    for run in runs_payload.get("runs") or []:
        if upsert_from_hosted_run(run):
            count += 1
    return count


def list_board(
    *,
    agent_id: str | None = None,
    limit: int = 200,
) -> dict[str, list[dict[str, Any]]]:
    sync_recent(limit=max(limit, 200))

    where: list[str] = []
    params: list[Any] = []
    if agent_id:
        where.append("agent_id=?")
        params.append(agent_id)
    clause = "WHERE " + " AND ".join(where) if where else ""
    effective_limit = max(1, min(limit, 500))
    params.append(effective_limit)

    rows = _ensure_conn().execute(
        f"""
        SELECT * FROM task_nodes
        {clause}
        ORDER BY created_at DESC
        LIMIT ?
        """,
        params,
    ).fetchall()

    grouped: dict[str, list[dict[str, Any]]] = {status: [] for status in BOARD_STATUSES}
    for row in rows:
        node = _node_from_row(row)
        status = str(node.get("board_status") or "queued")
        if status not in grouped:
            status = "queued"
        grouped[status].append(node)
    return grouped


def get_node(node_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute("SELECT * FROM task_nodes WHERE node_id=?", (node_id,)).fetchone()
    return _node_from_row(row) if row else None
