"""Agent dispatch queue — center-to-engine tasks and engine-to-engine handoffs."""
from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from core.config import load_dispatch_config
from domain.models import (
    DispatchHandoffSpec,
    DispatchJobAck,
    DispatchJobComplete,
    DispatchJobCreate,
    EngineHeartbeat,
)
from infra import engine_ingest, hosted_workspace_engines

_LEASE_SECONDS = 300
_ONLINE_SECONDS = 120
_RUNNING_STALE_SECONDS = 3600


def _ensure_dispatch_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS dispatch_jobs (
            job_id            TEXT PRIMARY KEY,
            kind              TEXT NOT NULL DEFAULT 'dispatch',
            status            TEXT NOT NULL DEFAULT 'queued',
            source_type       TEXT NOT NULL DEFAULT 'control_plane',
            source_engine_id  TEXT NOT NULL DEFAULT '',
            target_engine_id  TEXT NOT NULL DEFAULT '',
            target_team_id    TEXT NOT NULL DEFAULT '',
            title             TEXT NOT NULL DEFAULT '',
            message           TEXT NOT NULL,
            payload_json      TEXT NOT NULL DEFAULT '{}',
            refs_json         TEXT NOT NULL DEFAULT '{}',
            lease_engine_id   TEXT NOT NULL DEFAULT '',
            lease_expires_at  TEXT,
            run_id            TEXT NOT NULL DEFAULT '',
            result_summary    TEXT NOT NULL DEFAULT '',
            log_excerpt       TEXT NOT NULL DEFAULT '',
            exit_code         INTEGER,
            created_at        TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_status ON dispatch_jobs(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_target_engine ON dispatch_jobs(target_engine_id);
        CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_target_team ON dispatch_jobs(target_team_id);
        """
    )
    rows = conn.execute("PRAGMA table_info(engines)").fetchall()
    columns = {row["name"] for row in rows}
    for name, sql in {
        "last_seen_at": "ALTER TABLE engines ADD COLUMN last_seen_at TEXT",
        "connector_version": "ALTER TABLE engines ADD COLUMN connector_version TEXT NOT NULL DEFAULT ''",
        "online_meta": "ALTER TABLE engines ADD COLUMN online_meta TEXT NOT NULL DEFAULT '{}'",
    }.items():
        if name not in columns:
            conn.execute(sql)


def _db() -> sqlite3.Connection:
    conn = engine_ingest._ensure_conn()
    _ensure_dispatch_schema(conn)
    return conn


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _expires_at(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _job_from_row(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["payload"] = _json_loads(data.pop("payload_json", "{}"), {})
    data["refs"] = _json_loads(data.pop("refs_json", "{}"), {})
    return data


def record_heartbeat(engine_id: str, body: EngineHeartbeat) -> dict[str, Any] | None:
    engine = engine_ingest.get_engine(engine_id)
    if engine is None:
        return None
    meta = {
        "gateway_reachable": body.gateway_reachable,
        **(body.meta or {}),
    }
    conn = _db()
    if body.engine_version:
        conn.execute(
            """
            UPDATE engines
            SET engine_version=?, connector_version=?, last_seen_at=?, online_meta=?, updated_at=datetime('now')
            WHERE engine_id=?
            """,
            (body.engine_version, body.connector_version, _utc_now(), _json_dumps(meta), engine_id),
        )
    else:
        conn.execute(
            """
            UPDATE engines
            SET connector_version=?, last_seen_at=?, online_meta=?, updated_at=datetime('now')
            WHERE engine_id=?
            """,
            (body.connector_version, _utc_now(), _json_dumps(meta), engine_id),
        )
    return get_engine_fleet(engine_id)


def get_engine_fleet(engine_id: str | None = None) -> dict[str, Any] | None:
    if engine_id:
        row = _db().execute("SELECT * FROM engines WHERE engine_id=?", (engine_id,)).fetchone()
        if not row:
            return None
        return _enrich_engine_row(row)
    return None


def list_engines_fleet(limit: int = 200) -> list[dict[str, Any]]:
    rows = _db().execute(
        "SELECT * FROM engines ORDER BY last_seen_at DESC, updated_at DESC LIMIT ?",
        (max(1, min(limit, 500)),),
    ).fetchall()
    return [_enrich_engine_row(row) for row in rows]


def _enrich_engine_row(row: sqlite3.Row) -> dict[str, Any]:
    data = engine_ingest._engine_from_row(row)
    last_seen = data.get("last_seen_at") or ""
    online = False
    if last_seen:
        try:
            seen = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
            online = (datetime.now(timezone.utc) - seen).total_seconds() <= _ONLINE_SECONDS
        except ValueError:
            online = False
    caps = data.get("capabilities") or {}
    if caps.get("hosted") and hosted_workspace_engines.hosted_workspace_available(data["engine_id"]):
        data["online"] = True
    else:
        data["online"] = online
    data["online_meta"] = _json_loads(data.get("online_meta") or "{}", {})
    return data


def _validate_targets(body: DispatchJobCreate) -> None:
    if not body.target_engine_id and not body.target_team_id:
        raise ValueError("target_engine_id or target_team_id is required")
    if body.target_engine_id and hosted_workspace_engines.is_hosted_engine(body.target_engine_id):
        if not hosted_workspace_engines.hosted_workspace_available(body.target_engine_id):
            raise ValueError("target hosted coding workspace is not available")


def fail_job(job_id: str, *, summary: str) -> dict[str, Any] | None:
    conn = _db()
    conn.execute(
        """
        UPDATE dispatch_jobs
        SET status='failed', result_summary=?, completed_at=?, updated_at=datetime('now')
        WHERE job_id=? AND status IN ('queued', 'leased', 'running')
        """,
        (summary, _utc_now(), job_id),
    )
    return get_job(job_id)


def _team_pairs_policy() -> str:
    return load_dispatch_config().get("team_pairs", "*")


def validate_handoff_policy(
    source_engine_id: str,
    *,
    target_engine_id: str | None = None,
    target_team_id: str | None = None,
) -> None:
    """Cross-team handoff guard. EVOTOWN_DISPATCH_TEAM_PAIRS=sales:finance,it:finance or *."""
    if target_engine_id and target_engine_id == source_engine_id:
        raise ValueError("cannot handoff to the same engine_id")
    pairs_raw = _team_pairs_policy()
    if pairs_raw == "*":
        return
    source = engine_ingest.get_engine(source_engine_id) or {}
    src_team = (source.get("owner_team") or "").strip()
    dst_team = (target_team_id or "").strip()
    if not dst_team and target_engine_id:
        target = engine_ingest.get_engine(target_engine_id) or {}
        dst_team = (target.get("owner_team") or "").strip()
    if not src_team or not dst_team:
        return
    allowed: set[tuple[str, str]] = set()
    for part in pairs_raw.split(","):
        piece = part.strip()
        if not piece:
            continue
        if ":" in piece:
            a, _, b = piece.partition(":")
            allowed.add((a.strip(), b.strip()))
        else:
            allowed.add((piece, dst_team))
    if (src_team, dst_team) not in allowed:
        raise ValueError(f"handoff from team '{src_team}' to '{dst_team}' is not allowed by policy")


def create_job(
    body: DispatchJobCreate,
    *,
    source_type: str = "control_plane",
    source_engine_id: str = "",
    parent_job_id: str = "",
) -> dict[str, Any]:
    _validate_targets(body)
    if source_type == "engine" and source_engine_id:
        validate_handoff_policy(
            source_engine_id,
            target_engine_id=body.target_engine_id,
            target_team_id=body.target_team_id,
        )
    refs = dict(body.refs)
    if parent_job_id:
        refs["parent_job_id"] = parent_job_id
    job_id = f"job_{uuid.uuid4().hex[:20]}"
    src_engine = source_engine_id or (body.source_engine_id or "")
    conn = _db()
    conn.execute(
        """
        INSERT INTO dispatch_jobs (
            job_id, kind, status, source_type, source_engine_id,
            target_engine_id, target_team_id, title, message,
            payload_json, refs_json, run_id, created_at, updated_at
        )
        VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, '', datetime('now'), datetime('now'))
        """,
        (
            job_id,
            body.kind,
            source_type,
            src_engine,
            body.target_engine_id or "",
            body.target_team_id or "",
            body.title,
            body.message,
            _json_dumps(body.payload),
            _json_dumps(refs),
        ),
    )
    job = get_job(job_id)
    assert job is not None
    return job


def _parse_follow_up_handoff(payload: dict[str, Any], parent_job_id: str) -> DispatchHandoffSpec | None:
    raw = payload.get("on_success_handoff")
    if not raw or not isinstance(raw, dict):
        return None
    try:
        spec = DispatchHandoffSpec.model_validate(raw)
    except Exception:
        return None
    if not spec.target_engine_id and not spec.target_team_id:
        return None
    refs = dict(spec.refs)
    refs["parent_job_id"] = parent_job_id
    return spec.model_copy(update={"refs": refs})


def get_job(job_id: str) -> dict[str, Any] | None:
    row = _db().execute("SELECT * FROM dispatch_jobs WHERE job_id=?", (job_id,)).fetchone()
    return _job_from_row(row) if row else None


def list_jobs(
    *,
    status: str | None = None,
    target_engine_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if status:
        clauses.append("status=?")
        params.append(status)
    if target_engine_id:
        clauses.append("(target_engine_id=? OR source_engine_id=?)")
        params.extend([target_engine_id, target_engine_id])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(max(1, min(limit, 500)))
    rows = _db().execute(
        f"SELECT * FROM dispatch_jobs {where} ORDER BY created_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_job_from_row(row) for row in rows]


def _requeue_stale(conn: sqlite3.Connection) -> None:
    now = _utc_now()
    conn.execute(
        """
        UPDATE dispatch_jobs
        SET status='queued', lease_engine_id='', lease_expires_at=NULL, updated_at=datetime('now')
        WHERE status='leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
        """,
        (now,),
    )
    stale_running = (
        datetime.now(timezone.utc) - timedelta(seconds=_RUNNING_STALE_SECONDS)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute(
        """
        UPDATE dispatch_jobs
        SET status='queued', lease_engine_id='', lease_expires_at=NULL,
            result_summary='requeued after running timeout', updated_at=datetime('now')
        WHERE status='running' AND updated_at < ?
        """,
        (stale_running,),
    )


def lease_job(engine_id: str) -> dict[str, Any] | None:
    if hosted_workspace_engines.is_hosted_engine(engine_id):
        return None
    engine = engine_ingest.get_engine(engine_id)
    if engine is None:
        return None
    owner_team = engine.get("owner_team") or ""
    conn = _db()
    _requeue_stale(conn)
    row = conn.execute(
        """
        SELECT * FROM dispatch_jobs
        WHERE status='queued'
          AND (
            target_engine_id=?
            OR (target_engine_id='' AND target_team_id!='' AND target_team_id=?)
          )
        ORDER BY created_at ASC
        LIMIT 1
        """,
        (engine_id, owner_team),
    ).fetchone()
    if row is None:
        return None
    job_id = row["job_id"]
    expires = _expires_at(_LEASE_SECONDS)
    updated = conn.execute(
        """
        UPDATE dispatch_jobs
        SET status='leased', lease_engine_id=?, lease_expires_at=?, updated_at=datetime('now')
        WHERE job_id=? AND status='queued'
        """,
        (engine_id, expires, job_id),
    ).rowcount
    if not updated:
        return lease_job(engine_id)
    job = get_job(job_id)
    if job is None:
        return None
    return {
        "job_id": job_id,
        "run_id": job_id,
        "kind": job["kind"],
        "title": job["title"],
        "message": job["message"],
        "payload": job["payload"],
        "refs": job["refs"],
        "source_engine_id": job["source_engine_id"],
        "lease_expires_at": expires,
    }


def claim_next_hosted_job() -> dict[str, Any] | None:
    """Claim the next queued job targeted at a hosted coding workspace engine."""
    prefix = hosted_workspace_engines.HOSTED_ENGINE_PREFIX + "%"
    conn = _db()
    _requeue_stale(conn)
    while True:
        row = conn.execute(
            """
            SELECT * FROM dispatch_jobs
            WHERE status='queued' AND target_engine_id LIKE ?
            ORDER BY created_at ASC
            LIMIT 1
            """,
            (prefix,),
        ).fetchone()
        if row is None:
            return None
        job_id = row["job_id"]
        engine_id = row["target_engine_id"]
        if not hosted_workspace_engines.hosted_workspace_available(engine_id):
            fail_job(job_id, summary="target hosted coding workspace is not available")
            continue
        expires = _expires_at(_LEASE_SECONDS)
        updated = conn.execute(
            """
            UPDATE dispatch_jobs
            SET status='leased', lease_engine_id=?, lease_expires_at=?, updated_at=datetime('now')
            WHERE job_id=? AND status='queued'
            """,
            (engine_id, expires, job_id),
        ).rowcount
        if not updated:
            continue
        job = get_job(job_id)
        if job is None:
            continue
        return job


def ack_job(job_id: str, body: DispatchJobAck) -> dict[str, Any] | None:
    job = get_job(job_id)
    if job is None:
        return None
    if job["status"] not in {"leased", "running"}:
        return None
    if job["lease_engine_id"] and job["lease_engine_id"] != body.engine_id:
        return None
    conn = _db()
    conn.execute(
        """
        UPDATE dispatch_jobs
        SET status='running', lease_engine_id=?, updated_at=datetime('now')
        WHERE job_id=?
        """,
        (body.engine_id, job_id),
    )
    return get_job(job_id)


def complete_job(job_id: str, body: DispatchJobComplete) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    job = get_job(job_id)
    if job is None:
        return None, None
    if job["status"] in {"completed", "failed", "cancelled"}:
        return job, None
    if job["lease_engine_id"] and job["lease_engine_id"] != body.engine_id:
        return None, None
    terminal = "completed" if body.status == "succeeded" else "failed"
    if body.status == "cancelled":
        terminal = "failed"
    run_id = body.run_id or job_id
    conn = _db()
    conn.execute(
        """
        UPDATE dispatch_jobs
        SET status=?, run_id=?, result_summary=?, log_excerpt=?, exit_code=?,
            completed_at=?, updated_at=datetime('now')
        WHERE job_id=?
        """,
        (
            terminal,
            run_id,
            body.result_summary,
            body.log_excerpt,
            body.exit_code,
            _utc_now(),
            job_id,
        ),
    )
    finished = get_job(job_id)
    follow_up: dict[str, Any] | None = None
    if finished and terminal == "completed":
        spec = _parse_follow_up_handoff(finished.get("payload") or {}, job_id)
        if spec:
            child = create_job(
                DispatchJobCreate(
                    kind=spec.kind,
                    source_engine_id=body.engine_id,
                    target_engine_id=spec.target_engine_id,
                    target_team_id=spec.target_team_id,
                    title=spec.title,
                    message=spec.message,
                    payload={},
                    refs=spec.refs,
                ),
                source_type="engine",
                source_engine_id=body.engine_id,
                parent_job_id=job_id,
            )
            follow_up = child
    return finished, follow_up


def cancel_job(job_id: str, *, reason: str = "") -> dict[str, Any] | None:
    job = get_job(job_id)
    if job is None:
        return None
    if job["status"] in {"completed", "failed", "cancelled"}:
        return job
    conn = _db()
    conn.execute(
        """
        UPDATE dispatch_jobs
        SET status='cancelled', result_summary=?, completed_at=?, updated_at=datetime('now')
        WHERE job_id=?
        """,
        (reason or "cancelled by admin", _utc_now(), job_id),
    )
    return get_job(job_id)


def lease_job_wait(engine_id: str, timeout_sec: int = 0) -> dict[str, Any] | None:
    """Optional long-poll: retry lease until timeout (max 60s server-side)."""
    deadline = time.time() + max(0, min(timeout_sec, 60))
    while True:
        leased = lease_job(engine_id)
        if leased is not None:
            return leased
        if timeout_sec <= 0 or time.time() >= deadline:
            return None
        time.sleep(1)
