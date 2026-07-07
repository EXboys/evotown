"""Task pool — universal task queue for Hermes (system iteration) and evotown agents (business ops).

Table lives in system.db alongside system_config.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import uuid

from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Status constants ────────────────────────────────────────────────
STATUS_PENDING = "pending"
STATUS_PRE_REVIEW = "pre_review"
STATUS_APPROVED = "approved"
STATUS_IN_PROGRESS = "in_progress"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_REJECTED = "rejected"

VALID_STATUSES = {STATUS_PENDING, STATUS_PRE_REVIEW, STATUS_APPROVED, STATUS_IN_PROGRESS, STATUS_COMPLETED, STATUS_FAILED, STATUS_REJECTED}

# ── Claim modes ─────────────────────────────────────────────────────
CLAIM_MODE_EXECUTE = "execute"      # claim approved → execute
CLAIM_MODE_PRE_REVIEW = "pre_review" # claim pending → pre-review

# ── Claimer types ───────────────────────────────────────────────────
CLAIMER_HERMES = "hermes"
CLAIMER_EVOTOWN_AGENT = "evotown_agent"

# ── Submit source ───────────────────────────────────────────────────
SOURCE_PORTAL = "portal"
SOURCE_MCP = "mcp"
SOURCE_ADMIN = "admin"

# ── Timeout: auto-release in_progress tasks stuck > 2 hours ────────
CLAIM_TIMEOUT_SEC = 2 * 3600
# ── Timeout: auto-release pre_review reservations > 10 min (no plan) ─
PRE_REVIEW_TIMEOUT_SEC = 10 * 60


def _data_dir() -> Path:
    return Path(os.environ.get("EVOTOWN_DATA_DIR", "/app/data"))


def _db_path() -> Path:
    return _data_dir() / "system.db"


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _ensure_schema(conn)
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS task_pool (
            id              TEXT PRIMARY KEY,
            title           TEXT NOT NULL,
            description     TEXT NOT NULL DEFAULT '',
            submitter_type  TEXT NOT NULL DEFAULT 'employee',
            submitter_id    TEXT NOT NULL DEFAULT '',
            source          TEXT NOT NULL DEFAULT 'portal',
            status          TEXT NOT NULL DEFAULT 'pending',
            priority        INTEGER NOT NULL DEFAULT 0,
            tags            TEXT NOT NULL DEFAULT '[]',
            requirement     TEXT NOT NULL DEFAULT '',
            plan            TEXT NOT NULL DEFAULT '',
            result          TEXT NOT NULL DEFAULT '',
            target_agent_id TEXT,
            assignee_type   TEXT,
            assignee_id     TEXT,
            claimed_at      TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_task_pool_status ON task_pool(status);
        CREATE INDEX IF NOT EXISTS idx_task_pool_assignee ON task_pool(assignee_type);
    """)


def ensure_schema() -> None:
    """Public entry point for startup initialization."""
    conn = _db()
    _ensure_schema(conn)
    # Migration: add plan column if missing
    cols = {r[1] for r in conn.execute("PRAGMA table_info(task_pool)").fetchall()}
    if "plan" not in cols:
        conn.execute("ALTER TABLE task_pool ADD COLUMN plan TEXT NOT NULL DEFAULT ''")
        conn.commit()


def _task_from_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    try:
        d["tags"] = json.loads(d.get("tags", "[]"))
    except (json.JSONDecodeError, TypeError):
        d["tags"] = []
    return d


# ── CRUD ────────────────────────────────────────────────────────────

_CREATE_RATE_BUCKETS: dict[str, list[float]] = {}
_CREATE_RATE_LOCK = threading.Lock()


def check_create_rate_limit(submitter_key: str) -> None:
    """Per-submitter sliding-window limit for HTTP task creation."""
    import time

    from fastapi import HTTPException

    limit = int(os.environ.get("EVOTOWN_TASK_CREATE_RPM", "30") or "30")
    if limit <= 0 or not submitter_key.strip():
        return
    now = time.monotonic()
    window = 60.0
    with _CREATE_RATE_LOCK:
        bucket = [t for t in _CREATE_RATE_BUCKETS.get(submitter_key, []) if t > now - window]
        if len(bucket) >= limit:
            raise HTTPException(status_code=429, detail="task_create_rate_limit_exceeded")
        bucket.append(now)
        _CREATE_RATE_BUCKETS[submitter_key] = bucket


def create_task(
    *,
    title: str,
    description: str = "",
    submitter_type: str = "employee",
    submitter_id: str = "",
    source: str = SOURCE_PORTAL,
    target_agent_id: str | None = None,
    priority: int = 0,
) -> dict[str, Any]:
    conn = _db()
    task_id = f"task_{uuid.uuid4().hex[:12]}"
    conn.execute(
        """INSERT INTO task_pool (id, title, description, submitter_type, submitter_id, source, target_agent_id, priority)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (task_id, title.strip(), description.strip(), submitter_type, submitter_id, source, target_agent_id, priority),
    )
    conn.commit()
    return get_task(task_id) or {}


def get_task(task_id: str) -> dict[str, Any] | None:
    row = _db().execute("SELECT * FROM task_pool WHERE id = ?", (task_id,)).fetchone()
    return _task_from_row(row) if row else None


def list_tasks(
    *,
    status: str | None = None,
    submitter_type: str | None = None,
    source: str | None = None,
    assignee_type: str | None = None,
    target_agent_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    conn = _db()
    clauses: list[str] = []
    params: list[Any] = []

    if status:
        clauses.append("status = ?")
        params.append(status)
    if submitter_type:
        clauses.append("submitter_type = ?")
        params.append(submitter_type)
    if source:
        clauses.append("source = ?")
        params.append(source)
    if assignee_type:
        clauses.append("assignee_type = ?")
        params.append(assignee_type)
    if target_agent_id:
        clauses.append("target_agent_id = ?")
        params.append(target_agent_id)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.extend([limit, offset])
    rows = conn.execute(
        f"SELECT * FROM task_pool {where} ORDER BY priority ASC, created_at DESC LIMIT ? OFFSET ?",
        params,
    ).fetchall()
    return [_task_from_row(r) for r in rows]


def count_tasks(
    *,
    status: str | None = None,
    submitter_type: str | None = None,
    source: str | None = None,
    assignee_type: str | None = None,
    target_agent_id: str | None = None,
) -> int:
    """Count tasks matching filters (without limit/offset)."""
    conn = _db()
    clauses: list[str] = []
    params: list[Any] = []

    if status:
        clauses.append("status = ?")
        params.append(status)
    if submitter_type:
        clauses.append("submitter_type = ?")
        params.append(submitter_type)
    if source:
        clauses.append("source = ?")
        params.append(source)
    if assignee_type:
        clauses.append("assignee_type = ?")
        params.append(assignee_type)
    if target_agent_id:
        clauses.append("target_agent_id = ?")
        params.append(target_agent_id)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    row = conn.execute(f"SELECT COUNT(*) FROM task_pool {where}", params).fetchone()
    return row[0] if row else 0


def update_task(
    task_id: str,
    *,
    title: str | None = None,
    description: str | None = None,
    status: str | None = None,
    priority: int | None = None,
    tags: list[str] | None = None,
    requirement: str | None = None,
    plan: str | None = None,
    result: str | None = None,
    target_agent_id: str | None = None,
) -> dict[str, Any] | None:
    existing = get_task(task_id)
    if not existing:
        return None

    updates: dict[str, Any] = {}
    if title is not None:
        updates["title"] = title.strip()
    if description is not None:
        updates["description"] = description.strip()
    if status is not None:
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid status: {status}")
        updates["status"] = status
    if priority is not None:
        updates["priority"] = priority
    if tags is not None:
        updates["tags"] = json.dumps(tags, ensure_ascii=False)
    if requirement is not None:
        updates["requirement"] = requirement.strip()
    if plan is not None:
        updates["plan"] = plan.strip()
    if result is not None:
        updates["result"] = result.strip()
    if target_agent_id is not None:
        updates["target_agent_id"] = target_agent_id.strip() if target_agent_id else None

    if not updates:
        return existing

    conn = _db()
    sets = ", ".join(f"{key}=?" for key in updates)
    sets += ", updated_at=datetime('now')"
    conn.execute(
        f"UPDATE task_pool SET {sets} WHERE id=?",
        (*updates.values(), task_id),
    )
    conn.commit()
    return get_task(task_id)


# ── Atomic Claim ────────────────────────────────────────────────────


def claim_task(claimer_type: str, claimer_id: str = "", claim_mode: str = CLAIM_MODE_EXECUTE) -> dict[str, Any] | None:
    """Atomically claim a task.

    claim_mode='execute': claim approved → in_progress (Hermes global mutex applies).
    claim_mode='pre_review': reserve pending task (assignee + claimed_at only) — plan write later
      flips status to pre_review via update_plan().  This avoids "pre_review with empty plan".

    Also auto-releases tasks stuck in_progress > CLAIM_TIMEOUT_SEC,
    and pre_review reservations > PRE_REVIEW_TIMEOUT_SEC (claimed but no plan written).
    """
    conn = _db()
    target_status = STATUS_IN_PROGRESS  # only execution mode changes status
    source_status = STATUS_PENDING if claim_mode == CLAIM_MODE_PRE_REVIEW else STATUS_APPROVED

    with conn:  # transaction
        # ── Auto-release stale pre_review reservations ──────────────
        if claim_mode == CLAIM_MODE_PRE_REVIEW:
            conn.execute(
                """UPDATE task_pool SET assignee_type = NULL, assignee_id = NULL,
                   claimed_at = NULL, updated_at = datetime('now')
                   WHERE status = ? AND assignee_type IS NOT NULL
                   AND (plan IS NULL OR plan = '')
                   AND claimed_at IS NOT NULL
                   AND (strftime('%s', 'now') - strftime('%s', claimed_at)) > ?""",
                (STATUS_PENDING, PRE_REVIEW_TIMEOUT_SEC),
            )

        # ── Auto-release stale tasks (execution only) ───────────────
        if claim_mode == CLAIM_MODE_EXECUTE:
            conn.execute(
                """UPDATE task_pool SET status = ?, assignee_type = NULL, assignee_id = NULL,
                   claimed_at = NULL, updated_at = datetime('now')
                   WHERE status = ? AND claimed_at IS NOT NULL
                   AND (strftime('%s', 'now') - strftime('%s', claimed_at)) > ?""",
                (STATUS_APPROVED, STATUS_IN_PROGRESS, CLAIM_TIMEOUT_SEC),
            )

        # ── Hermes: global mutex (execution only) ──────────────────
        if claimer_type == CLAIMER_HERMES and claim_mode == CLAIM_MODE_EXECUTE:
            conflict = conn.execute(
                "SELECT 1 FROM task_pool WHERE status = ? AND assignee_type = ? LIMIT 1",
                (STATUS_IN_PROGRESS, CLAIMER_HERMES),
            ).fetchone()
            if conflict:
                return None

        # ── Find next task: exact match on target_agent_id ──────────
        # pre_review mode: only pick tasks NOT already reserved by someone else
        if claimer_type == CLAIMER_HERMES:
            extra = ""
            if claim_mode == CLAIM_MODE_PRE_REVIEW:
                extra = "\n                   AND (assignee_type IS NULL OR assignee_type = '')"
            row = conn.execute(
                f"""SELECT * FROM task_pool WHERE status = ?
                   AND target_agent_id = 'sysadmin'{extra}
                   ORDER BY priority ASC, created_at ASC LIMIT 1""",
                (source_status,),
            ).fetchone()
        elif claimer_type == CLAIMER_EVOTOWN_AGENT and claimer_id:
            extra = ""
            if claim_mode == CLAIM_MODE_PRE_REVIEW:
                extra = "\n                   AND (assignee_type IS NULL OR assignee_type = '')"
            row = conn.execute(
                f"""SELECT * FROM task_pool WHERE status = ?
                   AND target_agent_id = ?{extra}
                   ORDER BY priority ASC, created_at ASC LIMIT 1""",
                (source_status, claimer_id),
            ).fetchone()
        else:
            return None

        if not row:
            return None

        # ── Claim it ────────────────────────────────────────────────
        if claim_mode == CLAIM_MODE_PRE_REVIEW:
            # pre_review: only reserve (assignee + claimed_at), status stays pending
            conn.execute(
                """UPDATE task_pool SET assignee_type = ?, assignee_id = ?,
                   claimed_at = datetime('now'), updated_at = datetime('now')
                   WHERE id = ?""",
                (claimer_type, claimer_id, row["id"]),
            )
        else:
            conn.execute(
                """UPDATE task_pool SET status = ?, assignee_type = ?, assignee_id = ?,
                   claimed_at = datetime('now'), updated_at = datetime('now')
                   WHERE id = ?""",
                (target_status, claimer_type, claimer_id, row["id"]),
            )
        conn.commit()

    return get_task(row["id"])


def release_task(task_id: str) -> dict[str, Any] | None:
    """Release a task back to approved (e.g., on error/cancellation)."""
    return update_task(task_id, status=STATUS_APPROVED)


def complete_task(task_id: str, result: str = "") -> dict[str, Any] | None:
    """Mark task as completed with optional result text."""
    return update_task(task_id, status=STATUS_COMPLETED, result=result)


def fail_task(task_id: str, result: str = "") -> dict[str, Any] | None:
    """Mark task as failed with error/result text."""
    return update_task(task_id, status=STATUS_FAILED, result=result)
