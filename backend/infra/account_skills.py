"""Per-account skill assignment persistence.

Stores which skills (from the skill market/catalog) are assigned to each
gateway account, so the hosted Coding Agent can selectively mount them.
"""

from __future__ import annotations

import os, sqlite3
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
    conn = sqlite3.connect(str(data_dir / "account_skills.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS account_skills (
            account_id  TEXT NOT NULL,
            skill_id    TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (account_id, skill_id)
        );
        CREATE INDEX IF NOT EXISTS idx_account_skills_account ON account_skills(account_id);
        """
    )
    _conn = conn
    return conn


def assign(account_id: str, skill_ids: list[str]) -> None:
    """Replace the full skill list for one account."""
    conn = _ensure_conn()
    conn.execute("DELETE FROM account_skills WHERE account_id=?", (account_id,))
    for sid in skill_ids:
        sid = sid.strip()
        if sid:
            conn.execute(
                "INSERT OR IGNORE INTO account_skills (account_id, skill_id) VALUES (?, ?)",
                (account_id, sid),
            )


def revoke(account_id: str, skill_id: str) -> None:
    """Remove a single skill from an account."""
    conn = _ensure_conn()
    conn.execute("DELETE FROM account_skills WHERE account_id=? AND skill_id=?", (account_id, skill_id.strip()))


def list_for_account(account_id: str) -> list[str]:
    """Return skill_ids assigned to this account."""
    conn = _ensure_conn()
    rows = conn.execute("SELECT skill_id FROM account_skills WHERE account_id=? ORDER BY skill_id", (account_id,)).fetchall()
    return [r["skill_id"] for r in rows]


def list_accounts_for_skill(skill_id: str) -> list[str]:
    """Return account_ids that have this skill."""
    conn = _ensure_conn()
    rows = conn.execute("SELECT account_id FROM account_skills WHERE skill_id=? ORDER BY account_id", (skill_id.strip(),)).fetchall()
    return [r["account_id"] for r in rows]
