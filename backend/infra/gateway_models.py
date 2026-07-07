"""Evotown-managed upstream model registry (provider endpoints + credentials)."""
from __future__ import annotations

import os
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


def _migrate_models_schema(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(gateway_upstream_models)").fetchall()}
    additions = [
        ("protocol", "TEXT NOT NULL DEFAULT 'openai'"),
        ("anthropic_api_base", "TEXT NOT NULL DEFAULT ''"),
        ("is_vision", "INTEGER NOT NULL DEFAULT 0"),
        ("is_vision_default", "INTEGER NOT NULL DEFAULT 0"),
    ]
    for name, col_type in additions:
        if name not in cols:
            conn.execute(f"ALTER TABLE gateway_upstream_models ADD COLUMN {name} {col_type}")


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "gateway.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS gateway_upstream_models (
            model_id          TEXT PRIMARY KEY,
            model_name        TEXT NOT NULL UNIQUE,
            provider_label    TEXT NOT NULL DEFAULT '',
            litellm_model     TEXT NOT NULL DEFAULT '',
            api_base          TEXT NOT NULL,
            api_key           TEXT NOT NULL,
            description       TEXT NOT NULL DEFAULT '',
            enabled           INTEGER NOT NULL DEFAULT 1,
            litellm_synced    INTEGER NOT NULL DEFAULT 0,
            litellm_model_id  TEXT NOT NULL DEFAULT '',
            sync_error        TEXT NOT NULL DEFAULT '',
            created_at        TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_gw_upstream_name ON gateway_upstream_models(model_name, enabled);
        """
    )
    _migrate_models_schema(conn)
    _conn = conn
    return conn


def _mask_api_key(api_key: str) -> str:
    key = (api_key or "").strip()
    if len(key) <= 4:
        return "****" if key else ""
    return f"…{key[-4:]}"


def _public_row(row: sqlite3.Row, *, include_api_key: bool = False) -> dict[str, Any]:
    item = dict(row)
    item["enabled"] = bool(item.get("enabled", 1))
    item["litellm_synced"] = bool(item.get("litellm_synced", 0))
    item["is_vision"] = bool(item.get("is_vision", 0))
    item["is_vision_default"] = bool(item.get("is_vision_default", 0))
    item["protocol"] = (item.get("protocol") or "openai").strip()
    item["anthropic_api_base"] = (item.get("anthropic_api_base") or "").strip()
    raw_key = str(item.pop("api_key", "") or "")
    item["api_key_hint"] = _mask_api_key(raw_key)
    item["api_key_set"] = bool(raw_key)
    if include_api_key:
        item["api_key"] = raw_key
    return item


def list_models(*, enabled_only: bool = False) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    where = "WHERE enabled=1" if enabled_only else ""
    rows = conn.execute(
        f"SELECT * FROM gateway_upstream_models {where} ORDER BY model_name ASC",
    ).fetchall()
    return [_public_row(row) for row in rows]


def get_model(model_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM gateway_upstream_models WHERE model_id=?",
        (model_id,),
    ).fetchone()
    return _public_row(row) if row else None


def get_by_model_name(model_name: str) -> dict[str, Any] | None:
    name = (model_name or "").strip()
    if not name:
        return None
    row = _ensure_conn().execute(
        "SELECT * FROM gateway_upstream_models WHERE model_name=? AND enabled=1",
        (name,),
    ).fetchone()
    if not row:
        return None
    item = _public_row(row)
    item["_api_key"] = row["api_key"]
    item["_litellm_model"] = (row["litellm_model"] or "").strip() or name
    item["_api_base"] = (row["api_base"] or "").strip()
    item["_anthropic_api_base"] = (row["anthropic_api_base"] or "").strip()
    return item


def create_model(
    *,
    model_name: str,
    api_base: str,
    api_key: str,
    anthropic_api_base: str = "",
    litellm_model: str = "",
    provider_label: str = "",
    description: str = "",
    protocol: str = "openai",
    enabled: bool = True,
    is_vision: bool = False,
) -> dict[str, Any]:
    conn = _ensure_conn()
    model_id = f"gm_{uuid.uuid4().hex[:12]}"
    name = model_name.strip()
    conn.execute(
        """
        INSERT INTO gateway_upstream_models (
            model_id, model_name, provider_label, litellm_model, api_base, api_key,
            anthropic_api_base, protocol, description, enabled, is_vision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            model_id,
            name,
            provider_label.strip(),
            (litellm_model or "").strip(),
            api_base.strip().rstrip("/"),
            api_key.strip(),
            anthropic_api_base.strip().rstrip("/"),
            (protocol or "openai").strip(),
            description.strip(),
            1 if enabled else 0,
            1 if is_vision else 0,
        ),
    )
    return get_model(model_id) or {"model_id": model_id}


def update_model(model_id: str, **fields: Any) -> dict[str, Any] | None:
    existing = _ensure_conn().execute(
        "SELECT * FROM gateway_upstream_models WHERE model_id=?",
        (model_id,),
    ).fetchone()
    if existing is None:
        return None

    allowed = {
        "model_name",
        "provider_label",
        "litellm_model",
        "api_base",
        "api_key",
        "anthropic_api_base",
        "protocol",
        "description",
        "enabled",
        "is_vision",
        "is_vision_default",
        "litellm_synced",
        "litellm_model_id",
        "sync_error",
    }
    updates: list[str] = []
    params: list[Any] = []
    for key, value in fields.items():
        if key not in allowed or value is None:
            continue
        if key == "enabled":
            value = 1 if value else 0
        if key == "litellm_synced":
            value = 1 if value else 0
        if key in ("is_vision", "is_vision_default"):
            value = 1 if value else 0
        if key == "api_base" and isinstance(value, str):
            value = value.strip().rstrip("/")
        if key == "anthropic_api_base" and isinstance(value, str):
            value = value.strip().rstrip("/")
        if key == "api_key" and isinstance(value, str) and not value.strip():
            continue
        updates.append(f"{key}=?")
        params.append(value)
    if not updates:
        return get_model(model_id)
    updates.append("updated_at=datetime('now')")
    params.append(model_id)
    _ensure_conn().execute(
        f"UPDATE gateway_upstream_models SET {', '.join(updates)} WHERE model_id=?",
        params,
    )
    return get_model(model_id)


def delete_model(model_id: str) -> dict[str, Any] | None:
    row = _ensure_conn().execute(
        "SELECT * FROM gateway_upstream_models WHERE model_id=?",
        (model_id,),
    ).fetchone()
    if row is None:
        return None
    _ensure_conn().execute("DELETE FROM gateway_upstream_models WHERE model_id=?", (model_id,))
    item = _public_row(row)
    item["_api_key"] = row["api_key"]
    item["_litellm_model_id"] = row["litellm_model_id"]
    return item


def record_litellm_sync(
    model_id: str,
    *,
    synced: bool,
    litellm_model_id: str = "",
    sync_error: str = "",
) -> dict[str, Any] | None:
    return update_model(
        model_id,
        litellm_synced=synced,
        litellm_model_id=litellm_model_id,
        sync_error=sync_error[:500],
    )


def credentials_for_sync(model_id: str) -> dict[str, str] | None:
    row = _ensure_conn().execute(
        "SELECT model_name, api_base, api_key, litellm_model FROM gateway_upstream_models WHERE model_id=?",
        (model_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "model_name": row["model_name"],
        "api_base": row["api_base"],
        "api_key": row["api_key"],
        "litellm_model": row["litellm_model"] or "",
    }


# ── Vision model helpers ──────────────────────────────────────────────

def get_vision_model() -> dict[str, Any] | None:
    """Return the default vision model (is_vision=1, is_vision_default=1, enabled=1)."""
    row = _ensure_conn().execute(
        "SELECT * FROM gateway_upstream_models WHERE is_vision=1 AND is_vision_default=1 AND enabled=1 LIMIT 1",
    ).fetchone()
    if not row:
        return None
    item = _public_row(row)
    item["_api_key"] = row["api_key"]
    item["_litellm_model"] = (row["litellm_model"] or "").strip() or row["model_name"]
    item["_api_base"] = (row["api_base"] or "").strip()
    item["_anthropic_api_base"] = (row["anthropic_api_base"] or "").strip()
    return item


def set_vision_default(model_id: str) -> dict[str, Any] | None:
    """Set one model as the default vision model (mutual exclusion)."""
    conn = _ensure_conn()
    model = conn.execute(
        "SELECT * FROM gateway_upstream_models WHERE model_id=? AND is_vision=1 AND enabled=1",
        (model_id,),
    ).fetchone()
    if model is None:
        return None
    # Clear all existing defaults
    conn.execute("UPDATE gateway_upstream_models SET is_vision_default=0")
    # Set this one
    conn.execute(
        "UPDATE gateway_upstream_models SET is_vision_default=1, updated_at=datetime('now') WHERE model_id=?",
        (model_id,),
    )
    return get_vision_model()
