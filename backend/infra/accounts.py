"""Gateway account and API key persistence."""
from __future__ import annotations

import hashlib
import json
import os
import secrets
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

KEY_PREFIX = "evk_"
DEFAULT_SCOPES = ["gateway.chat"]


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "accounts.db"
    conn = sqlite3.connect(str(db_path), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS gateway_accounts (
            account_id   TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            team_id      TEXT NOT NULL DEFAULT '',
            owner_email  TEXT NOT NULL DEFAULT '',
            status       TEXT NOT NULL DEFAULT 'active',
            notes        TEXT NOT NULL DEFAULT '',
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_gateway_accounts_team ON gateway_accounts(team_id);
        CREATE INDEX IF NOT EXISTS idx_gateway_accounts_status ON gateway_accounts(status);

        CREATE TABLE IF NOT EXISTS gateway_api_keys (
            key_id       TEXT PRIMARY KEY,
            account_id   TEXT NOT NULL,
            label        TEXT NOT NULL DEFAULT '',
            key_prefix   TEXT NOT NULL,
            key_hash     TEXT NOT NULL UNIQUE,
            scopes       TEXT NOT NULL DEFAULT '["gateway.chat"]',
            status       TEXT NOT NULL DEFAULT 'active',
            expires_at   TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            revoked_at   TEXT,
            last_used_at TEXT,
            FOREIGN KEY (account_id) REFERENCES gateway_accounts(account_id)
        );
        CREATE INDEX IF NOT EXISTS idx_gateway_api_keys_account ON gateway_api_keys(account_id);
        CREATE INDEX IF NOT EXISTS idx_gateway_api_keys_hash ON gateway_api_keys(key_hash);
        CREATE INDEX IF NOT EXISTS idx_gateway_api_keys_status ON gateway_api_keys(status);
        """
    )
    _migrate_accounts_schema(conn)
    _conn = conn
    return conn


def _migrate_accounts_schema(conn: sqlite3.Connection) -> None:
    key_cols = {row[1] for row in conn.execute("PRAGMA table_info(gateway_api_keys)").fetchall()}
    if "monthly_token_limit" not in key_cols:
        conn.execute("ALTER TABLE gateway_api_keys ADD COLUMN monthly_token_limit INTEGER NOT NULL DEFAULT 0")
    if "monthly_cost_limit_usd" not in key_cols:
        conn.execute("ALTER TABLE gateway_api_keys ADD COLUMN monthly_cost_limit_usd REAL NOT NULL DEFAULT 0")
    if "burst_rpm_limit" not in key_cols:
        conn.execute("ALTER TABLE gateway_api_keys ADD COLUMN burst_rpm_limit INTEGER NOT NULL DEFAULT 0")


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _account_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def _key_from_row(row: sqlite3.Row, *, include_hash: bool = False) -> dict[str, Any]:
    item = dict(row)
    scopes_raw = item.pop("scopes", "[]")
    try:
        item["scopes"] = json.loads(scopes_raw) if isinstance(scopes_raw, str) else scopes_raw
    except json.JSONDecodeError:
        item["scopes"] = list(DEFAULT_SCOPES)
    if not include_hash:
        item.pop("key_hash", None)
    return item


def create_account(
    *,
    name: str,
    team_id: str = "",
    owner_email: str = "",
    notes: str = "",
) -> dict[str, Any]:
    conn = _ensure_conn()
    account_id = f"acc_{uuid.uuid4().hex[:12]}"
    conn.execute(
        """
        INSERT INTO gateway_accounts (account_id, name, team_id, owner_email, notes)
        VALUES (?, ?, ?, ?, ?)
        """,
        (account_id, name.strip(), team_id.strip(), owner_email.strip(), notes.strip()),
    )
    row = conn.execute("SELECT * FROM gateway_accounts WHERE account_id=?", (account_id,)).fetchone()
    return _account_from_row(row)


def list_accounts(*, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    params: list[Any] = []
    where = ""
    if status:
        where = "WHERE status=?"
        params.append(status)
    params.append(max(1, min(limit, 500)))
    rows = conn.execute(
        f"SELECT * FROM gateway_accounts {where} ORDER BY created_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_account_from_row(row) for row in rows]


def get_account(account_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM gateway_accounts WHERE account_id=?",
        (account_id,),
    ).fetchone()
    return _account_from_row(row) if row else None


def update_account(account_id: str, **fields: Any) -> dict[str, Any] | None:
    allowed = {"name", "team_id", "owner_email", "status", "notes"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return get_account(account_id)
    sets = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [account_id]
    conn = _ensure_conn()
    conn.execute(
        f"UPDATE gateway_accounts SET {sets}, updated_at=datetime('now') WHERE account_id=?",
        values,
    )
    return get_account(account_id)


def _generate_raw_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(32)


def create_api_key(
    account_id: str,
    *,
    label: str = "",
    scopes: list[str] | None = None,
    expires_at: str | None = None,
    monthly_token_limit: int = 0,
    monthly_cost_limit_usd: float = 0,
    burst_rpm_limit: int = 0,
) -> tuple[dict[str, Any], str]:
    account = get_account(account_id)
    if account is None:
        raise ValueError("account not found")
    if account.get("status") != "active":
        raise ValueError("account is not active")

    raw_key = _generate_raw_key()
    key_hash = hash_api_key(raw_key)
    key_id = f"key_{uuid.uuid4().hex[:12]}"
    key_prefix = raw_key[:12]
    scope_list = scopes or list(DEFAULT_SCOPES)

    conn = _ensure_conn()
    conn.execute(
        """
        INSERT INTO gateway_api_keys (
            key_id, account_id, label, key_prefix, key_hash, scopes, expires_at,
            monthly_token_limit, monthly_cost_limit_usd, burst_rpm_limit
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            key_id,
            account_id,
            label.strip(),
            key_prefix,
            key_hash,
            json.dumps(scope_list, separators=(",", ":")),
            expires_at,
            max(0, int(monthly_token_limit)),
            max(0.0, float(monthly_cost_limit_usd)),
            max(0, int(burst_rpm_limit)),
        ),
    )
    row = conn.execute("SELECT * FROM gateway_api_keys WHERE key_id=?", (key_id,)).fetchone()
    return _key_from_row(row), raw_key


def list_api_keys(
    *,
    account_id: str | None = None,
    status: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    clauses: list[str] = []
    params: list[Any] = []
    if account_id:
        clauses.append("account_id=?")
        params.append(account_id)
    if status:
        clauses.append("status=?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(max(1, min(limit, 500)))
    rows = conn.execute(
        f"SELECT * FROM gateway_api_keys {where} ORDER BY created_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_key_from_row(row) for row in rows]


def get_api_key(key_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM gateway_api_keys WHERE key_id=?",
        (key_id,),
    ).fetchone()
    return _key_from_row(row) if row else None


def revoke_api_key(key_id: str) -> dict[str, Any] | None:
    conn = _ensure_conn()
    conn.execute(
        """
        UPDATE gateway_api_keys
        SET status='revoked', revoked_at=datetime('now')
        WHERE key_id=? AND status='active'
        """,
        (key_id,),
    )
    return get_api_key(key_id)


def update_api_key(key_id: str, **fields: Any) -> dict[str, Any] | None:
    allowed = {
        "label",
        "scopes",
        "expires_at",
        "monthly_token_limit",
        "monthly_cost_limit_usd",
        "burst_rpm_limit",
    }
    updates: dict[str, Any] = {}
    for key, value in fields.items():
        if key not in allowed or value is None:
            continue
        if key == "scopes":
            updates[key] = json.dumps(list(value), separators=(",", ":"))
        elif key == "monthly_token_limit":
            updates[key] = max(0, int(value))
        elif key == "monthly_cost_limit_usd":
            updates[key] = max(0.0, float(value))
        elif key == "burst_rpm_limit":
            updates[key] = max(0, int(value))
        else:
            updates[key] = value
    if not updates:
        return get_api_key(key_id)
    sets = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [key_id]
    _ensure_conn().execute(f"UPDATE gateway_api_keys SET {sets} WHERE key_id=?", values)
    return get_api_key(key_id)


def touch_api_key(key_id: str) -> None:
    _ensure_conn().execute(
        "UPDATE gateway_api_keys SET last_used_at=datetime('now') WHERE key_id=?",
        (key_id,),
    )


def default_burst_rpm() -> int:
    return max(0, int(os.environ.get("EVOTOWN_GATEWAY_DEFAULT_BURST_RPM", "0") or 0))


def effective_burst_rpm(key_record: dict[str, Any]) -> int:
    per_key = int(key_record.get("burst_rpm_limit") or 0)
    if per_key > 0:
        return per_key
    return default_burst_rpm()


def check_burst_rate_limit(key_record: dict[str, Any], recent_count: int) -> tuple[bool, str]:
    """Return (allowed, reason). recent_count = requests in the last 60s for this key."""
    limit = effective_burst_rpm(key_record)
    if limit <= 0:
        return True, ""
    if recent_count >= limit:
        return False, "burst_rate_limit_exceeded"
    return True, ""


def check_monthly_quota(key_record: dict[str, Any], usage: dict[str, Any]) -> tuple[bool, str]:
    """Return (allowed, reason). Limits of 0 mean unlimited."""
    token_limit = int(key_record.get("monthly_token_limit") or 0)
    cost_limit = float(key_record.get("monthly_cost_limit_usd") or 0)
    used_tokens = int(usage.get("total_tokens") or 0)
    used_cost = float(usage.get("cost_usd") or 0)
    if token_limit > 0 and used_tokens >= token_limit:
        return False, "monthly_token_limit_exceeded"
    if cost_limit > 0 and used_cost >= cost_limit:
        return False, "monthly_cost_limit_exceeded"
    return True, ""


def lookup_api_key(raw_key: str, *, touch_last_used: bool = False) -> dict[str, Any] | None:
    """Resolve bearer token to account + key metadata. Returns None if invalid."""
    key_hash = hash_api_key(raw_key)
    conn = _ensure_conn()
    row = conn.execute(
        """
        SELECT k.*, a.name AS account_name, a.team_id AS account_team_id, a.status AS account_status
        FROM gateway_api_keys k
        JOIN gateway_accounts a ON a.account_id = k.account_id
        WHERE k.key_hash=?
        """,
        (key_hash,),
    ).fetchone()
    if row is None:
        return None

    item = dict(row)
    if item.get("status") != "active":
        return None
    if item.get("account_status") != "active":
        return None

    expires_at = item.get("expires_at")
    if expires_at:
        expired = conn.execute(
            "SELECT 1 WHERE datetime(?) <= datetime('now')",
            (expires_at,),
        ).fetchone()
        if expired:
            return None

    scopes_raw = item.get("scopes", "[]")
    try:
        item["scopes"] = json.loads(scopes_raw) if isinstance(scopes_raw, str) else scopes_raw
    except json.JSONDecodeError:
        item["scopes"] = list(DEFAULT_SCOPES)

    if touch_last_used:
        conn.execute(
            "UPDATE gateway_api_keys SET last_used_at=datetime('now') WHERE key_id=?",
            (item["key_id"],),
        )
    item.pop("key_hash", None)
    return item


def account_key_counts(account_ids: list[str]) -> dict[str, dict[str, int]]:
    if not account_ids:
        return {}
    conn = _ensure_conn()
    placeholders = ",".join("?" for _ in account_ids)
    rows = conn.execute(
        f"""
        SELECT account_id,
               SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_keys,
               COUNT(*) AS total_keys
        FROM gateway_api_keys
        WHERE account_id IN ({placeholders})
        GROUP BY account_id
        """,
        account_ids,
    ).fetchall()
    return {
        row["account_id"]: {"active_keys": row["active_keys"], "total_keys": row["total_keys"]}
        for row in rows
    }
