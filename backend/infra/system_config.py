"""System configuration — DB-backed, env-synced singleton.

On startup: sync system.db values to os.environ, overwriting any stale env values.
On admin save: write DB → os.environ → .env file.
"""

import logging
import os
import sqlite3
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULTS: list[tuple[str, str, str | None, str, str, str, str | None]] = [
    # (key, value, env_var, category, label, input_type, options_json)
    ("brand_name", "Evotown", None, "enterprise", "企业名称", "text", None),
    ("site_name", "Evotown", None, "enterprise", "系统名称", "text", None),
    ("portal_hero_title", "企业 Agent", None, "enterprise", "首页标题", "text", None),
    (
        "portal_hero_desc",
        "Evotown 将 Agent 运行监控、技能资产市场与企业控制台整合在一起。团队可以看清「谁在做什么」，沉淀可复用技能，并统一管理引擎、成本与风险。",
        None,
        "enterprise",
        "首页描述",
        "textarea",
        None,
    ),
    (
        "portal_footer_text",
        "© 2025 Evotown · Enterprise Agent Platform",
        None,
        "enterprise",
        "Footer 文字",
        "text",
        None,
    ),
    ("staff_session_ttl", "86400", "EVOTOWN_STAFF_SESSION_TTL", "system", "会话超时(秒)", "number", None),
    ("EVOTOWN_CLAUDE_RUN_TIMEOUT_SEC", "3600", "EVOTOWN_CLAUDE_RUN_TIMEOUT_SEC", "system", "运行超时(秒)", "number", None),
    ("EVOTOWN_CLAUDE_MAX_TURNS", "100", "EVOTOWN_CLAUDE_MAX_TURNS", "system", "最大轮次", "number", None),
    (
        "agent_default_model_policy",
        "routes_only",
        None,
        "system",
        "默认模型策略",
        "select",
        '["routes_only","all"]',
    ),
]

# Keys that require a backend restart when changed
_RESTART_KEYS = {"staff_session_ttl", "EVOTOWN_CLAUDE_RUN_TIMEOUT_SEC", "EVOTOWN_CLAUDE_MAX_TURNS"}


def _data_dir() -> Path:
    return Path(os.environ.get("EVOTOWN_DATA_DIR", "/app/data"))


def _db_path() -> Path:
    return _data_dir() / "system.db"


def system_dir() -> Path:
    p = _data_dir() / "system"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _ensure_schema(conn)
    _seed_defaults(conn)
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS system_config (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL,
            env_var     TEXT,
            category    TEXT NOT NULL DEFAULT 'system',
            label       TEXT NOT NULL DEFAULT '',
            input_type  TEXT NOT NULL DEFAULT 'text',
            options     TEXT,
            updated_at  TEXT DEFAULT (datetime('now'))
        );
    """)


def _seed_defaults(conn: sqlite3.Connection) -> None:
    for key, value, env_var, category, label, input_type, options in DEFAULTS:
        conn.execute(
            "INSERT OR IGNORE INTO system_config (key, value, env_var, category, label, input_type, options) "
            "VALUES (?,?,?,?,?,?,?)",
            (key, value, env_var, category, label, input_type, options),
        )
    conn.commit()


def sync_env_on_startup() -> list[str]:
    """On startup: sync system.db → os.environ.

    Returns list of env vars that were changed (for logging)."""
    changed: list[str] = []
    conn = _db()
    rows = conn.execute(
        "SELECT key, value, env_var FROM system_config WHERE env_var IS NOT NULL"
    ).fetchall()
    for row in rows:
        env_var = row["env_var"]
        db_value = row["value"]
        if os.environ.get(env_var) != db_value:
            os.environ[env_var] = db_value
            changed.append(env_var)
            logger.info("system_config startup sync: %s → %s", env_var, db_value)
    return changed


def update_config(updates: dict[str, str]) -> list[str]:
    """Update config key→value pairs. Returns keys that need a restart."""
    restart_needed: list[str] = []
    conn = _db()
    for key, value in updates.items():
        row = conn.execute("SELECT * FROM system_config WHERE key = ?", (key,)).fetchone()
        if not row:
            continue
        conn.execute(
            "UPDATE system_config SET value = ?, updated_at = datetime('now') WHERE key = ?",
            (value, key),
        )
        env_var = row["env_var"]
        if env_var:
            os.environ[env_var] = value
            if key in _RESTART_KEYS:
                restart_needed.append(key)
    conn.commit()
    return restart_needed


def save_logo(file_data: bytes) -> str:
    """Save uploaded logo file. Returns the filename."""
    logo_path = system_dir() / "logo.png"
    logo_path.write_bytes(file_data)
    return "logo.png"


def logo_exists() -> bool:
    return (system_dir() / "logo.png").is_file()


def get_all() -> list[dict]:
    """Return all config rows (admin view)."""
    conn = _db()
    rows = conn.execute("SELECT * FROM system_config ORDER BY category, key").fetchall()
    return [dict(r) for r in rows]


def get_public() -> dict[str, str]:
    """Return key→value map for frontend consumption."""
    conn = _db()
    rows = conn.execute("SELECT key, value FROM system_config").fetchall()
    return {r["key"]: r["value"] for r in rows}


def get_value(key: str, default: str = "") -> str:
    """Read a single config value with fallback."""
    conn = _db()
    row = conn.execute("SELECT value FROM system_config WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default
