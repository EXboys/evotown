"""Centralized model gateway persistence for LiteLLM-backed calls."""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"
_DATA_DIR = Path(os.environ.get("EVOTOWN_DATA_DIR", _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"))
_DB_PATH = _DATA_DIR / "gateway.db"

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
        CREATE TABLE IF NOT EXISTS gateway_requests (
            request_id        TEXT PRIMARY KEY,
            conversation_id   TEXT NOT NULL,
            api_key_label     TEXT NOT NULL,
            agent_id          TEXT NOT NULL DEFAULT '',
            team_id           TEXT NOT NULL DEFAULT '',
            engine_id         TEXT NOT NULL DEFAULT '',
            model             TEXT NOT NULL DEFAULT '',
            status_code       INTEGER NOT NULL,
            prompt_tokens     INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens      INTEGER NOT NULL DEFAULT 0,
            cost_usd          REAL NOT NULL DEFAULT 0,
            latency_ms        INTEGER NOT NULL DEFAULT 0,
            risk_status       TEXT NOT NULL DEFAULT 'allowed',
            request_excerpt   TEXT NOT NULL DEFAULT '',
            response_excerpt  TEXT NOT NULL DEFAULT '',
            error             TEXT NOT NULL DEFAULT '',
            created_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_gateway_created ON gateway_requests(created_at);
        CREATE INDEX IF NOT EXISTS idx_gateway_agent ON gateway_requests(agent_id);
        CREATE INDEX IF NOT EXISTS idx_gateway_team ON gateway_requests(team_id);
        CREATE INDEX IF NOT EXISTS idx_gateway_conversation ON gateway_requests(conversation_id, created_at);
        """
    )
    _migrate_gateway_schema(conn)
    _conn = conn
    return conn


def _migrate_gateway_schema(conn: sqlite3.Connection) -> None:
    """Add account/key columns to existing gateway.db installs."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(gateway_requests)").fetchall()}
    if "account_id" not in cols:
        conn.execute("ALTER TABLE gateway_requests ADD COLUMN account_id TEXT NOT NULL DEFAULT ''")
    if "key_id" not in cols:
        conn.execute("ALTER TABLE gateway_requests ADD COLUMN key_id TEXT NOT NULL DEFAULT ''")
    if "model_alias" not in cols:
        conn.execute("ALTER TABLE gateway_requests ADD COLUMN model_alias TEXT NOT NULL DEFAULT ''")
    if "user_message" not in cols:
        conn.execute("ALTER TABLE gateway_requests ADD COLUMN user_message TEXT NOT NULL DEFAULT ''")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_gateway_account ON gateway_requests(account_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_gateway_key_created ON gateway_requests(key_id, created_at)")


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _text_excerpt(value: Any, max_chars: int = 2000) -> str:
    if value is None:
        return ""
    text = value if isinstance(value, str) else _json_dumps(value)
    return text[:max_chars]


def record_request(item: dict[str, Any]) -> dict[str, Any]:
    conn = _ensure_conn()
    conn.execute(
        """
        INSERT OR REPLACE INTO gateway_requests (
            request_id, conversation_id, api_key_label, account_id, key_id,
            agent_id, team_id, engine_id,
            model, model_alias, status_code, prompt_tokens, completion_tokens, total_tokens,
            cost_usd, latency_ms, risk_status, request_excerpt, response_excerpt, error,
            user_message
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            item["request_id"],
            item.get("conversation_id", ""),
            item.get("api_key_label", ""),
            item.get("account_id", ""),
            item.get("key_id", ""),
            item.get("agent_id", ""),
            item.get("team_id", ""),
            item.get("engine_id", ""),
            item.get("model", ""),
            item.get("model_alias", ""),
            int(item.get("status_code", 0)),
            int(item.get("prompt_tokens", 0)),
            int(item.get("completion_tokens", 0)),
            int(item.get("total_tokens", 0)),
            float(item.get("cost_usd", 0) or 0),
            int(item.get("latency_ms", 0)),
            item.get("risk_status", "allowed"),
            _text_excerpt(item.get("request_excerpt", "")),
            _text_excerpt(item.get("response_excerpt", "")),
            _text_excerpt(item.get("error", ""), max_chars=1000),
            item.get("user_message", ""),
        ),
    )
    return get_request(item["request_id"]) or item


def _request_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def get_request(request_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM gateway_requests WHERE request_id=?",
        (request_id,),
    ).fetchone()
    return _request_from_row(row) if row else None


def usage_summary(limit: int = 10) -> dict[str, Any]:
    conn = _ensure_conn()
    total = conn.execute(
        """
        SELECT
            COUNT(*) AS total_requests,
            COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
        FROM gateway_requests
        """
    ).fetchone()
    by_model = conn.execute(
        """
        SELECT model, COUNT(*) AS requests, COALESCE(SUM(cost_usd), 0) AS cost_usd,
               COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM gateway_requests
        GROUP BY model
        ORDER BY requests DESC
        LIMIT ?
        """,
        (max(1, min(limit, 100)),),
    ).fetchall()
    by_agent = conn.execute(
        """
        SELECT agent_id, COUNT(*) AS requests, COALESCE(SUM(cost_usd), 0) AS cost_usd,
               COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM gateway_requests
        WHERE agent_id != ''
        GROUP BY agent_id
        ORDER BY requests DESC
        LIMIT ?
        """,
        (max(1, min(limit, 100)),),
    ).fetchall()
    by_account = conn.execute(
        """
        SELECT account_id, COUNT(*) AS requests, COALESCE(SUM(cost_usd), 0) AS cost_usd,
               COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM gateway_requests
        WHERE account_id != ''
        GROUP BY account_id
        ORDER BY requests DESC
        LIMIT ?
        """,
        (max(1, min(limit, 100)),),
    ).fetchall()
    
    # account_id in gateway_requests stores agent_id.
    # Look up agent names from agents.db.
    by_account_list = [dict(row) for row in by_account]
    agent_ids = {row["account_id"] for row in by_account_list}
    agent_names: dict[str, str] = {}
    if agent_ids:
        from infra import agents as agents_store
        for agt_id in agent_ids:
            agent = agents_store.get_agent(agt_id)
            if agent and agent.get("name"):
                agent_names[agt_id] = agent["name"]
    for row in by_account_list:
        row["account_name"] = agent_names.get(row["account_id"], row["account_id"])
    
    return {
        "total": dict(total) if total else {},
        "by_model": [dict(row) for row in by_model],
        "by_agent": [dict(row) for row in by_agent],
        "by_account": by_account_list,
    }


def conversations(limit: int = 100) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        """
        SELECT
            conversation_id,
            MAX(created_at) AS last_seen_at,
            COUNT(*) AS requests,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            MAX(agent_id) AS agent_id,
            MAX(team_id) AS team_id,
            MAX(engine_id) AS engine_id,
            MAX(model) AS model,
            MAX(model_alias) AS model_alias,
            MAX(account_id) AS account_id,
            MAX(user_message) AS user_message
        FROM gateway_requests
        GROUP BY conversation_id
        ORDER BY last_seen_at DESC
        LIMIT ?
        """,
        (max(1, min(limit, 500)),),
    ).fetchall()

    # account_id in gateway_requests stores agent_id.
    # Look up agent names from agents.db.
    result = [dict(row) for row in rows]
    agent_ids = {row["account_id"] for row in result if row["account_id"]}
    agent_names: dict[str, str] = {}
    if agent_ids:
        from infra import agents as agents_store
        for agt_id in agent_ids:
            agent = agents_store.get_agent(agt_id)
            if agent and agent.get("name"):
                agent_names[agt_id] = agent["name"]

    for row in result:
        name = agent_names.get(row["account_id"], "")
        row["agent_name"] = name
        row["account_name"] = ""
        row["agent_id"] = row["account_id"]

    return result


def monthly_usage_for_key(key_id: str) -> dict[str, Any]:
    """Aggregate gateway usage for the current UTC month."""
    if not key_id:
        return {"total_tokens": 0, "cost_usd": 0.0, "requests": 0}
    row = _ensure_conn().execute(
        """
        SELECT
            COUNT(*) AS requests,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(cost_usd), 0) AS cost_usd
        FROM gateway_requests
        WHERE key_id = ?
          AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        """,
        (key_id,),
    ).fetchone()
    return dict(row) if row else {"total_tokens": 0, "cost_usd": 0.0, "requests": 0}


def monthly_usage_by_key(limit: int = 100) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        """
        SELECT
            key_id,
            COUNT(*) AS requests,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(cost_usd), 0) AS cost_usd
        FROM gateway_requests
        WHERE key_id != ''
          AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        GROUP BY key_id
        ORDER BY total_tokens DESC
        LIMIT ?
        """,
        (max(1, min(limit, 500)),),
    ).fetchall()
    return [dict(row) for row in rows]


def request_count_in_window(key_id: str, window_seconds: int = 60) -> int:
    """Count gateway requests for key_id in the last window_seconds."""
    if not key_id:
        return 0
    window = max(1, int(window_seconds))
    row = _ensure_conn().execute(
        """
        SELECT COUNT(*) AS cnt
        FROM gateway_requests
        WHERE key_id = ?
          AND datetime(created_at) >= datetime('now', ?)
        """,
        (key_id, f"-{window} seconds"),
    ).fetchone()
    return int(row["cnt"]) if row else 0


def update_request_risk_status(request_id: str, risk_status: str) -> None:
    _ensure_conn().execute(
        "UPDATE gateway_requests SET risk_status=? WHERE request_id=?",
        (risk_status, request_id),
    )


def recent_requests(limit: int = 100) -> list[dict[str, Any]]:
    rows = _ensure_conn().execute(
        "SELECT * FROM gateway_requests ORDER BY created_at DESC LIMIT ?",
        (max(1, min(limit, 500)),),
    ).fetchall()
    
    # account_id in gateway_requests stores agent_id.
    # Look up agent names from agents.db.
    agent_ids = {row["account_id"] for row in rows if row["account_id"]}
    agent_names: dict[str, str] = {}
    if agent_ids:
        from infra import agents as agents_store
        for agt_id in agent_ids:
            agent = agents_store.get_agent(agt_id)
            if agent and agent.get("name"):
                agent_names[agt_id] = agent["name"]
    
    result = []
    for row in rows:
        req = _request_from_row(row)
        agt_id = row["account_id"]
        name = agent_names.get(agt_id, "")
        req["agent_name"] = name
        req["agent_id"] = agt_id
        req["account_name"] = ""
        result.append(req)
    return result
