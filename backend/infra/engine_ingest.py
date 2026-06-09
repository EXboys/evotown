"""External engine ingest persistence.

Stores runtime-neutral engine registrations and completed run reports in a
separate SQLite database so enterprise ingest data does not couple to Arena
state persistence.
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
from pathlib import Path
from typing import Any

INGEST_TOKEN_PREFIX = "evi_"

from domain.models import EngineRegister, PolicyViolationIngest, RunComplete, RunEventIngest
from infra.redaction import redact_text

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"
_DATA_DIR = Path(os.environ.get("EVOTOWN_DATA_DIR", _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"))
_DB_PATH = _DATA_DIR / "engine_ingest.db"

_conn: sqlite3.Connection | None = None


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS engines (
            engine_id       TEXT PRIMARY KEY,
            engine_type     TEXT NOT NULL DEFAULT 'custom',
            engine_version  TEXT NOT NULL,
            display_name    TEXT NOT NULL DEFAULT '',
            owner_team      TEXT NOT NULL DEFAULT '',
            deployment_kind TEXT NOT NULL DEFAULT 'server',
            dispatch_url    TEXT,
            capabilities    TEXT NOT NULL DEFAULT '{}',
            registered_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS external_runs (
            run_id              TEXT PRIMARY KEY,
            engine_id           TEXT NOT NULL,
            engine_type         TEXT NOT NULL DEFAULT 'custom',
            engine_version      TEXT NOT NULL,
            tenant_id           TEXT NOT NULL DEFAULT '',
            team_id             TEXT NOT NULL DEFAULT '',
            agent_id            TEXT NOT NULL DEFAULT '',
            task_id             TEXT NOT NULL DEFAULT '',
            status              TEXT NOT NULL,
            exit_code           INTEGER NOT NULL,
            started_at          TEXT NOT NULL DEFAULT '',
            finished_at         TEXT NOT NULL,
            log_excerpt         TEXT NOT NULL DEFAULT '',
            artifact_manifest   TEXT NOT NULL DEFAULT '[]',
            artifact_bundle_url TEXT,
            signals             TEXT NOT NULL DEFAULT '{}',
            accepted_at         TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_external_runs_engine ON external_runs(engine_id);
        CREATE INDEX IF NOT EXISTS idx_external_runs_finished ON external_runs(finished_at);

        CREATE TABLE IF NOT EXISTS run_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id      TEXT NOT NULL,
            engine_id   TEXT NOT NULL,
            event_type  TEXT NOT NULL,
            ts          TEXT NOT NULL,
            seq         INTEGER NOT NULL,
            payload     TEXT NOT NULL DEFAULT '{}',
            accepted_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, seq);

        CREATE TABLE IF NOT EXISTS policy_violations (
            violation_id  INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id        TEXT NOT NULL,
            engine_id     TEXT NOT NULL,
            policy_id     TEXT NOT NULL,
            severity      TEXT NOT NULL,
            action        TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource      TEXT NOT NULL DEFAULT '',
            message       TEXT NOT NULL DEFAULT '',
            ts            TEXT NOT NULL,
            context       TEXT NOT NULL DEFAULT '{}',
            status        TEXT NOT NULL DEFAULT 'open',
            accepted_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_policy_violations_run ON policy_violations(run_id);
        CREATE INDEX IF NOT EXISTS idx_policy_violations_status ON policy_violations(status);
        """
    )
    _ensure_external_runs_columns(conn)
    _ensure_engine_token_columns(conn)
    _conn = conn
    return conn


def _ensure_engine_token_columns(conn: sqlite3.Connection) -> None:
    rows = conn.execute("PRAGMA table_info(engines)").fetchall()
    columns = {row["name"] for row in rows}
    for name, sql in {
        "ingest_token_hash": "ALTER TABLE engines ADD COLUMN ingest_token_hash TEXT NOT NULL DEFAULT ''",
        "ingest_token_prefix": "ALTER TABLE engines ADD COLUMN ingest_token_prefix TEXT NOT NULL DEFAULT ''",
    }.items():
        if name not in columns:
            conn.execute(sql)
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_engines_ingest_token_hash "
        "ON engines(ingest_token_hash) WHERE ingest_token_hash != ''"
    )


def _ensure_external_runs_columns(conn: sqlite3.Connection) -> None:
    rows = conn.execute("PRAGMA table_info(external_runs)").fetchall()
    columns = {row["name"] for row in rows}
    migrations = {
        "engine_type": "ALTER TABLE external_runs ADD COLUMN engine_type TEXT NOT NULL DEFAULT 'custom'",
        "tenant_id": "ALTER TABLE external_runs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''",
        "team_id": "ALTER TABLE external_runs ADD COLUMN team_id TEXT NOT NULL DEFAULT ''",
        "agent_id": "ALTER TABLE external_runs ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''",
        "task_id": "ALTER TABLE external_runs ADD COLUMN task_id TEXT NOT NULL DEFAULT ''",
        "started_at": "ALTER TABLE external_runs ADD COLUMN started_at TEXT NOT NULL DEFAULT ''",
        "updated_at": "ALTER TABLE external_runs ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
    }
    for name, sql in migrations.items():
        if name not in columns:
            conn.execute(sql)


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def hash_ingest_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def lookup_engine_id_for_ingest_token(raw_token: str) -> str | None:
    if not raw_token.startswith(INGEST_TOKEN_PREFIX):
        return None
    token_hash = hash_ingest_token(raw_token)
    row = _ensure_conn().execute(
        "SELECT engine_id FROM engines WHERE ingest_token_hash=?",
        (token_hash,),
    ).fetchone()
    return row["engine_id"] if row else None


def issue_ingest_token(engine_id: str) -> str:
    """Create or rotate per-engine ingest token; returns plaintext once."""
    raw = f"{INGEST_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
    token_hash = hash_ingest_token(raw)
    prefix = raw[:16]
    _ensure_conn().execute(
        """
        UPDATE engines
        SET ingest_token_hash=?, ingest_token_prefix=?, updated_at=datetime('now')
        WHERE engine_id=?
        """,
        (token_hash, prefix, engine_id),
    )
    return raw


def upsert_engine(body: EngineRegister, *, issue_token: bool = False) -> tuple[dict[str, Any], str | None]:
    """Insert or update engine metadata; optionally issue a per-engine ingest token."""
    conn = _ensure_conn()
    existing = get_engine(body.engine_id)
    capabilities = _json_dumps(body.capabilities)
    conn.execute(
        """
        INSERT INTO engines (
            engine_id, engine_type, engine_version, display_name, owner_team,
            deployment_kind, dispatch_url, capabilities, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(engine_id) DO UPDATE SET
            engine_type=excluded.engine_type,
            engine_version=excluded.engine_version,
            display_name=excluded.display_name,
            owner_team=excluded.owner_team,
            deployment_kind=excluded.deployment_kind,
            dispatch_url=excluded.dispatch_url,
            capabilities=excluded.capabilities,
            updated_at=datetime('now')
        """,
        (
            body.engine_id,
            body.engine_type or "custom",
            body.engine_version,
            body.display_name,
            body.owner_team,
            body.deployment_kind,
            body.dispatch_url,
            capabilities,
        ),
    )
    issued: str | None = None
    if issue_token:
        needs_token = existing is None or body.rotate_ingest_token or not (existing.get("ingest_token_hash") or "")
        if needs_token:
            issued = issue_ingest_token(body.engine_id)
    engine = get_engine(body.engine_id) or {"engine_id": body.engine_id}
    return engine, issued


def register_engine(body: EngineRegister) -> tuple[dict[str, Any], str | None]:
    return upsert_engine(body, issue_token=True)


def _engine_from_row(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data.pop("ingest_token_hash", None)
    data["capabilities"] = _json_loads(data.get("capabilities", "{}"), {})
    return data


def get_engine(engine_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM engines WHERE engine_id=?",
        (engine_id,),
    ).fetchone()
    return _engine_from_row(row) if row else None


def list_engines(limit: int = 100) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        "SELECT * FROM engines ORDER BY updated_at DESC LIMIT ?",
        (max(1, min(limit, 500)),),
    ).fetchall()
    return [_engine_from_row(row) for row in rows]


def complete_run(run_id: str, body: RunComplete) -> tuple[dict[str, Any], bool]:
    conn = _ensure_conn()
    existing = get_run(run_id)
    if existing is not None:
        if existing.get("status") in {"succeeded", "failed", "cancelled"}:
            return existing, False

    manifest = [item.model_dump() for item in body.artifact_manifest]
    engine = get_engine(body.engine_id) or {}
    if existing is None:
        conn.execute(
            """
            INSERT INTO external_runs (
                run_id, engine_id, engine_type, engine_version, status, exit_code,
                started_at, finished_at, log_excerpt, artifact_manifest,
                artifact_bundle_url, signals, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """,
            (
                run_id,
                body.engine_id,
                engine.get("engine_type", "custom"),
                body.engine_version,
                body.status,
                body.exit_code,
                body.finished_at,
                body.finished_at,
                redact_text(body.log_excerpt),
                _json_dumps(manifest),
                body.artifact_bundle_url,
                _json_dumps(body.signals),
            ),
        )
    else:
        conn.execute(
            """
            UPDATE external_runs
            SET engine_version=?, status=?, exit_code=?, finished_at=?, log_excerpt=?,
                artifact_manifest=?, artifact_bundle_url=?, signals=?, updated_at=datetime('now')
            WHERE run_id=?
            """,
            (
                body.engine_version,
                body.status,
                body.exit_code,
                body.finished_at,
                redact_text(body.log_excerpt),
                _json_dumps(manifest),
                body.artifact_bundle_url,
                _json_dumps(body.signals),
                run_id,
            ),
        )
    return get_run(run_id) or {"run_id": run_id}, True


def upsert_run_from_event(body: RunEventIngest, engine: dict[str, Any]) -> dict[str, Any]:
    conn = _ensure_conn()
    existing = get_run(body.run_id)
    event_status = body.status or ("succeeded" if body.event_type == "run.completed" else "running")
    if body.event_type == "run.completed" and event_status == "running":
        event_status = "succeeded"
    engine_version = body.engine_version or engine.get("engine_version", "")
    engine_type = body.engine_type or engine.get("engine_type", "custom")
    manifest = [item.model_dump() for item in body.artifact_manifest]
    signals_json = _json_dumps(body.signals)
    manifest_json = _json_dumps(manifest)

    if existing is None:
        conn.execute(
            """
            INSERT INTO external_runs (
                run_id, engine_id, engine_type, engine_version, tenant_id, team_id,
                agent_id, task_id, status, exit_code, started_at, finished_at,
                log_excerpt, artifact_manifest, artifact_bundle_url, signals, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """,
            (
                body.run_id,
                body.engine_id,
                engine_type,
                engine_version,
                body.tenant_id,
                body.team_id,
                body.agent_id,
                body.task_id,
                event_status,
                body.exit_code if body.exit_code is not None else 0,
                body.ts if body.event_type == "run.started" else "",
                body.ts,
                body.log_excerpt,
                manifest_json,
                body.artifact_bundle_url,
                signals_json,
            ),
        )
    else:
        conn.execute(
            """
            UPDATE external_runs
            SET engine_type=?,
                engine_version=?,
                tenant_id=COALESCE(NULLIF(?, ''), tenant_id),
                team_id=COALESCE(NULLIF(?, ''), team_id),
                agent_id=COALESCE(NULLIF(?, ''), agent_id),
                task_id=COALESCE(NULLIF(?, ''), task_id),
                status=?,
                exit_code=?,
                started_at=CASE WHEN ?='run.started' THEN ? ELSE started_at END,
                finished_at=?,
                log_excerpt=COALESCE(NULLIF(?, ''), log_excerpt),
                artifact_manifest=CASE WHEN ?!='[]' THEN ? ELSE artifact_manifest END,
                artifact_bundle_url=COALESCE(?, artifact_bundle_url),
                signals=CASE WHEN ?!='{}' THEN ? ELSE signals END,
                updated_at=datetime('now')
            WHERE run_id=?
            """,
            (
                engine_type,
                engine_version or existing.get("engine_version", ""),
                body.tenant_id,
                body.team_id,
                body.agent_id,
                body.task_id,
                event_status,
                body.exit_code if body.exit_code is not None else existing.get("exit_code", 0),
                body.event_type,
                body.ts,
                body.ts,
                body.log_excerpt,
                manifest_json,
                manifest_json,
                body.artifact_bundle_url,
                signals_json,
                signals_json,
                body.run_id,
            ),
        )
    return get_run(body.run_id) or {"run_id": body.run_id}


def _event_payload(body: RunEventIngest) -> dict[str, Any]:
    payload = dict(body.payload)
    for key in (
        "tenant_id",
        "team_id",
        "agent_id",
        "engine_type",
        "engine_version",
        "task_id",
        "status",
        "exit_code",
        "log_excerpt",
        "artifact_bundle_url",
        "signals",
    ):
        value = getattr(body, key)
        if value not in (None, "", {}, []):
            payload.setdefault(key, value)
    if body.artifact_manifest:
        payload.setdefault("artifact_manifest", [item.model_dump() for item in body.artifact_manifest])
    return payload


def _run_from_row(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["artifact_manifest"] = _json_loads(data.get("artifact_manifest", "[]"), [])
    data["signals"] = _json_loads(data.get("signals", "{}"), {})
    return data


def get_run(run_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM external_runs WHERE run_id=?",
        (run_id,),
    ).fetchone()
    return _run_from_row(row) if row else None


def list_runs(
    engine_id: str | None = None,
    team_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    capped = max(1, min(limit, 500))
    conn = _ensure_conn()
    clauses: list[str] = []
    params: list[Any] = []
    if engine_id:
        clauses.append("engine_id=?")
        params.append(engine_id)
    if team_id:
        clauses.append("team_id=?")
        params.append(team_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(capped)
    rows = conn.execute(
        f"SELECT * FROM external_runs {where} ORDER BY accepted_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_run_from_row(row) for row in rows]


def append_event(body: RunEventIngest) -> dict[str, Any]:
    conn = _ensure_conn()
    conn.execute(
        """
        INSERT INTO run_events (run_id, engine_id, event_type, ts, seq, payload)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            body.run_id,
            body.engine_id,
            body.event_type,
            body.ts,
            body.seq,
            _json_dumps(_event_payload(body)),
        ),
    )
    row = conn.execute("SELECT * FROM run_events WHERE id=last_insert_rowid()").fetchone()
    return _event_from_row(row)


def _event_from_row(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["payload"] = _json_loads(data.get("payload", "{}"), {})
    return data


def list_events(run_id: str, limit: int = 500) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        "SELECT * FROM run_events WHERE run_id=? ORDER BY seq ASC, id ASC LIMIT ?",
        (run_id, max(1, min(limit, 2000))),
    ).fetchall()
    return [_event_from_row(row) for row in rows]


def append_policy_violation(body: PolicyViolationIngest) -> dict[str, Any]:
    conn = _ensure_conn()
    context = body.context
    conn.execute(
        """
        INSERT INTO policy_violations (
            run_id, engine_id, policy_id, severity, action, resource_type,
            resource, message, ts, context
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            body.run_id,
            body.engine_id,
            body.policy_id,
            body.severity,
            body.action,
            body.resource_type,
            body.resource,
            redact_text(body.message, max_len=2000),
            body.ts,
            _json_dumps({k: redact_text(str(v), max_len=2000) if isinstance(v, str) else v for k, v in context.items()}),
        ),
    )
    row = conn.execute("SELECT * FROM policy_violations WHERE violation_id=last_insert_rowid()").fetchone()
    return _violation_from_row(row)


def _violation_from_row(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["context"] = _json_loads(data.get("context", "{}"), {})
    return data


def list_policy_violations(
    run_id: str | None = None,
    engine_id: str | None = None,
    status: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if run_id:
        clauses.append("run_id=?")
        params.append(run_id)
    if engine_id:
        clauses.append("engine_id=?")
        params.append(engine_id)
    if status:
        clauses.append("status=?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(max(1, min(limit, 1000)))
    rows = _ensure_conn().execute(
        f"SELECT * FROM policy_violations {where} ORDER BY accepted_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_violation_from_row(row) for row in rows]


def cost_summary() -> dict[str, Any]:
    runs = list_runs(limit=500)
    total_cost = 0.0
    input_tokens = 0
    output_tokens = 0
    by_engine: dict[str, dict[str, Any]] = {}
    by_team: dict[str, dict[str, Any]] = {}
    for run in runs:
        signals = run.get("signals") or {}
        cost = float(signals.get("cost_usd") or 0)
        in_tok = int(signals.get("input_tokens") or 0)
        out_tok = int(signals.get("output_tokens") or 0)
        total_cost += cost
        input_tokens += in_tok
        output_tokens += out_tok
        engine_id = run.get("engine_id") or "unknown"
        team_key = str(run.get("team_id") or "").strip() or "(未分配)"
        bucket = by_engine.setdefault(
            engine_id,
            {"engine_id": engine_id, "runs": 0, "cost_usd": 0.0, "input_tokens": 0, "output_tokens": 0},
        )
        bucket["runs"] += 1
        bucket["cost_usd"] += cost
        bucket["input_tokens"] += in_tok
        bucket["output_tokens"] += out_tok
        team_bucket = by_team.setdefault(
            team_key,
            {"team_id": team_key, "runs": 0, "cost_usd": 0.0, "input_tokens": 0, "output_tokens": 0},
        )
        team_bucket["runs"] += 1
        team_bucket["cost_usd"] += cost
        team_bucket["input_tokens"] += in_tok
        team_bucket["output_tokens"] += out_tok
    return {
        "total_runs": len(runs),
        "total_cost_usd": round(total_cost, 6),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "by_engine": list(by_engine.values()),
        "by_team": list(by_team.values()),
    }

