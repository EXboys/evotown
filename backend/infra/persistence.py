"""竞技场状态持久化 — SQLite WAL 主存储 + JSON 原子备份

架构：
  主存储  $EVOTOWN_DATA_DIR/arena_state.db   (sqlite3 WAL 模式，crash-safe)
  备份    $EVOTOWN_DATA_DIR/arena_state.json  (tmp→rename 原子写，人类可读)
  legacy  backend/arena_state.json           (旧镜像兼容路径，首次启动自动迁移)

路径优先级：
  1. 环境变量 EVOTOWN_DATA_DIR（Docker 部署时设为 /app/data）
  2. 本地回退：backend/ 同级目录下的 data/ 文件夹

对外 API（签名不变，下游无需改动）：
  load_state(experiment_id)  → dict
  save_state(agent_counter, agents, experiment_id, task_counter,
             global_task_counter, teams)  → None
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("evotown.persistence")

# ── 路径配置 ────────────────────────────────────────────────────────────────
_DATA_DIR          = Path(os.environ.get("EVOTOWN_DATA_DIR", Path(__file__).parent.parent / "data"))
_DB_PATH           = _DATA_DIR / "arena_state.db"
_STATE_PATH        = _DATA_DIR / "arena_state.json"
_LEGACY_STATE_PATH = Path(__file__).parent.parent / "arena_state.json"

# 模块级单例连接（生命周期同进程，WAL 模式下多读单写安全）
_conn: sqlite3.Connection | None = None


# ─────────────────────────────────────────────────────────────────────────────
# SQLite 内部工具
# ─────────────────────────────────────────────────────────────────────────────

def _ensure_conn() -> sqlite3.Connection:
    """懒初始化：打开（或创建）DB，建表（幂等），启用 WAL。

    连接使用 isolation_level=None（autocommit 模式），所有事务由调用方
    显式 BEGIN IMMEDIATE / COMMIT / ROLLBACK 管理，避免 Python 自动发出
    DEFERRED BEGIN 导致锁升级失败。
    busy_timeout=10000：并发写入时最多等待 10 s，而非立即抛异常。
    """
    global _conn
    if _conn is not None:
        return _conn
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS arena_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agents (
            id               TEXT PRIMARY KEY,
            display_name     TEXT    DEFAULT '',
            balance          INTEGER DEFAULT 100,
            status           TEXT    DEFAULT 'active',
            soul_type        TEXT    DEFAULT 'balanced',
            team_id          TEXT,
            rescue_given     INTEGER DEFAULT 0,
            rescue_received  INTEGER DEFAULT 0,
            solo_preference  INTEGER DEFAULT 0,
            evolution_focus  TEXT    DEFAULT '',
            loyalty          INTEGER DEFAULT 100,
            updated_at       TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS teams (
            team_id       TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            members       TEXT DEFAULT '[]',
            shared_skills TEXT DEFAULT '[]',
            shared_wisdom TEXT DEFAULT '[]',
            creed         TEXT DEFAULT '',
            created_at    TEXT NOT NULL,
            updated_at    TEXT DEFAULT (datetime('now'))
        );
    """)
    # ── 旧库迁移：为已存在的表补列（SQLite 不支持 IF NOT EXISTS for columns）──
    for ddl in [
        "ALTER TABLE agents ADD COLUMN loyalty INTEGER DEFAULT 100",
        "ALTER TABLE teams  ADD COLUMN creed   TEXT    DEFAULT ''",
    ]:
        try:
            conn.execute(ddl)
        except sqlite3.OperationalError:
            pass  # 列已存在，跳过
    conn.commit()
    _conn = conn
    return conn


def _sqlite_has_data(conn: sqlite3.Connection) -> bool:
    try:
        row = conn.execute("SELECT COUNT(*) FROM agents").fetchone()
        return bool(row and row[0] > 0)
    except Exception:
        return False


def _load_from_sqlite(conn: sqlite3.Connection, experiment_id: str | None) -> dict[str, Any]:
    def _meta(key: str, default: str = "0") -> str:
        row = conn.execute("SELECT value FROM arena_meta WHERE key=?", (key,)).fetchone()
        return row[0] if row else default

    def _int(val: str, default: int = 0) -> int:
        try:
            return int(val)
        except (TypeError, ValueError):
            return default

    exp_id = _meta("experiment_id", experiment_id or "") or experiment_id
    result: dict[str, Any] = {
        "agent_counter":       _int(_meta("agent_counter")),
        "task_counter":        _int(_meta("task_counter")),
        "global_task_counter": _int(_meta("global_task_counter")),
        "experiment_id":       exp_id,
        "agents": [],
        "teams":  [],
    }

    for row in conn.execute("SELECT * FROM agents"):
        r = dict(row)
        result["agents"].append({
            "id":              r["id"],
            "display_name":    r["display_name"] or "",
            "balance":         int(r["balance"] or 100),
            "status":          r["status"] or "active",
            "soul_type":       r["soul_type"] or "balanced",
            "team_id":         r["team_id"],
            "rescue_given":    int(r["rescue_given"] or 0),
            "rescue_received": int(r["rescue_received"] or 0),
            "solo_preference": bool(r["solo_preference"]),
            "evolution_focus": r["evolution_focus"] or "",
            "loyalty":         int(r["loyalty"]) if r.get("loyalty") is not None else 100,
        })

    for row in conn.execute("SELECT * FROM teams"):
        r = dict(row)
        try:
            members       = json.loads(r["members"] or "[]")
            shared_skills = json.loads(r["shared_skills"] or "[]")
            shared_wisdom = json.loads(r["shared_wisdom"] or "[]")
        except json.JSONDecodeError:
            members, shared_skills, shared_wisdom = [], [], []
        result["teams"].append({
            "team_id":       r["team_id"],
            "name":          r["name"],
            "members":       members,
            "shared_skills": shared_skills,
            "shared_wisdom": shared_wisdom,
            "creed":         r.get("creed") or "",
            "created_at":    r["created_at"],
        })

    return result


def _save_to_sqlite(
    conn: sqlite3.Connection,
    agent_counter: int,
    agents: list[dict[str, Any]],
    experiment_id: str | None,
    task_counter: int | None,
    global_task_counter: int,
    teams: list[dict[str, Any]] | None,
) -> None:
    """单事务全量写入（原子性，WAL crash-safe）。

    使用 BEGIN IMMEDIATE 立即获取写锁，避免多并发 Agent 保存时发生
    DEFERRED→EXCLUSIVE 的锁升级竞争（combined with busy_timeout=10000s
    排队等待而非立即失败）。
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        # ── arena_meta ────────────────────────────────────────────────────
        meta_rows = [
            ("agent_counter",       str(agent_counter)),
            ("task_counter",        str(task_counter or 0)),
            ("global_task_counter", str(global_task_counter)),
        ]
        if experiment_id:
            meta_rows.append(("experiment_id", experiment_id))
        conn.executemany(
            "INSERT OR REPLACE INTO arena_meta(key, value) VALUES (?, ?)",
            meta_rows,
        )

        # ── agents：全量 UPSERT + 删除已退场 ──────────────────────────────
        current_ids = {a["id"] for a in agents if a.get("id")}
        conn.executemany(
            """INSERT OR REPLACE INTO agents
               (id, display_name, balance, status, soul_type,
                team_id, rescue_given, rescue_received, solo_preference,
                evolution_focus, loyalty, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            [
                (
                    a.get("id"),
                    a.get("display_name", ""),
                    int(a.get("balance", 100)),
                    a.get("status", "active"),
                    a.get("soul_type", "balanced"),
                    a.get("team_id"),
                    int(a.get("rescue_given", 0)),
                    int(a.get("rescue_received", 0)),
                    1 if a.get("solo_preference") else 0,
                    a.get("evolution_focus", ""),
                    int(a.get("loyalty", 100)),
                )
                for a in agents if a.get("id")
            ],
        )
        if current_ids:
            placeholders = ",".join("?" * len(current_ids))
            conn.execute(
                f"DELETE FROM agents WHERE id NOT IN ({placeholders})",
                list(current_ids),
            )
        else:
            conn.execute("DELETE FROM agents")

        # ── teams：全量替换 ──────────────────────────────────────────────
        conn.execute("DELETE FROM teams")
        if teams:
            conn.executemany(
                """INSERT INTO teams
                   (team_id, name, members, shared_skills, shared_wisdom,
                    creed, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                [
                    (
                        t.get("team_id"),
                        t.get("name", ""),
                        json.dumps(t.get("members", []),       ensure_ascii=False),
                        json.dumps(t.get("shared_skills", []), ensure_ascii=False),
                        json.dumps(t.get("shared_wisdom", []), ensure_ascii=False),
                        t.get("creed", ""),
                        t.get("created_at", ""),
                    )
                    for t in teams if t.get("team_id")
                ],
            )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


# ─────────────────────────────────────────────────────────────────────────────
# JSON 工具（备份 + 旧格式兼容读取）
# ─────────────────────────────────────────────────────────────────────────────

def _load_from_json(experiment_id: str | None) -> dict[str, Any] | None:
    """从 JSON 文件读取（volume 优先，legacy 兜底）。失败返回 None。"""
    path: Path | None = None
    if _STATE_PATH.exists():
        path = _STATE_PATH
    elif _LEGACY_STATE_PATH.exists():
        path = _LEGACY_STATE_PATH
        logger.info("Migrating arena_state.json from legacy path to data volume")

    if path is None:
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as e:
        logger.warning("Failed to load arena_state.json: %s", e)
        return None

    def _int(val: Any, default: int = 0) -> int:
        try:
            return int(val)
        except (TypeError, ValueError):
            return default

    result: dict[str, Any] = {
        "agent_counter":       _int(data.get("agent_counter"), 0),
        "task_counter":        _int(data.get("task_counter"), 0),
        "global_task_counter": _int(data.get("global_task_counter"), 0),
        "agents": [],
        "teams":  data.get("teams") if isinstance(data.get("teams"), list) else [],
    }
    if "experiment_id" in data:
        result["experiment_id"] = data["experiment_id"]
    elif experiment_id:
        result["experiment_id"] = experiment_id

    for raw in data.get("agents", []):
        if not isinstance(raw, dict):
            logger.warning("Skipping non-dict agent entry: %s", raw)
            continue
        agent_id = raw.get("id")
        if not agent_id:
            logger.warning("Skipping agent entry with missing id: %s", raw)
            continue
        try:
            result["agents"].append({
                "id":              str(agent_id),
                "display_name":    str(raw.get("display_name", "") or ""),
                "balance":         _int(raw.get("balance"), 100),
                "status":          str(raw.get("status", "active") or "active"),
                "soul_type":       str(raw.get("soul_type", "balanced") or "balanced"),
                "team_id":         raw.get("team_id"),
                "rescue_given":    _int(raw.get("rescue_given"), 0),
                "rescue_received": _int(raw.get("rescue_received"), 0),
                "solo_preference": bool(raw.get("solo_preference", False)),
                "evolution_focus": str(raw.get("evolution_focus", "") or ""),
                "loyalty":         _int(raw.get("loyalty"), 100),
            })
        except Exception as e:
            logger.warning("Skipping agent %s due to parse error: %s", agent_id, e)

    return result


def _save_to_json_backup(
    agent_counter: int,
    agents: list[dict[str, Any]],
    experiment_id: str | None,
    task_counter: int | None,
    global_task_counter: int,
    teams: list[dict[str, Any]] | None,
) -> None:
    """备份到 JSON（atomic tmp→rename，人类可读，可手动回滚）。"""
    payload: dict[str, Any] = {
        "agent_counter":       agent_counter,
        "task_counter":        task_counter or 0,
        "global_task_counter": global_task_counter,
        "agents": [
            {
                "id":              a.get("id"),
                "display_name":    a.get("display_name", ""),
                "balance":         a.get("balance", 100),
                "status":          a.get("status", "active"),
                "soul_type":       a.get("soul_type", "balanced"),
                "team_id":         a.get("team_id"),
                "rescue_given":    a.get("rescue_given", 0),
                "rescue_received": a.get("rescue_received", 0),
                "solo_preference": a.get("solo_preference", False),
                "evolution_focus": a.get("evolution_focus", ""),
                "loyalty":         a.get("loyalty", 100),
            }
            for a in agents
        ],
        "teams": teams or [],
    }
    if experiment_id:
        payload["experiment_id"] = experiment_id
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = _STATE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.rename(_STATE_PATH)
    except OSError as e:
        logger.warning("Failed to write JSON backup: %s", e)


# ─────────────────────────────────────────────────────────────────────────────
# Public API（签名与旧版完全兼容）
# ─────────────────────────────────────────────────────────────────────────────

def load_state(experiment_id: str | None = None) -> dict[str, Any]:
    """加载竞技场状态。SQLite 优先，自动从 JSON 迁移（首次启动）。"""
    empty: dict[str, Any] = {
        "agent_counter": 0, "task_counter": 0, "global_task_counter": 0,
        "agents": [], "teams": [], "experiment_id": experiment_id,
    }
    conn = _ensure_conn()

    # 1. SQLite 有数据 → 直接读取
    if _sqlite_has_data(conn):
        try:
            state = _load_from_sqlite(conn, experiment_id)
            logger.info(
                "Loaded arena state from SQLite: %d agents, %d teams",
                len(state["agents"]), len(state["teams"]),
            )
            return state
        except Exception as e:
            logger.warning("SQLite load failed, falling back to JSON: %s", e)

    # 2. SQLite 为空 → 尝试从 JSON 加载并迁移
    json_state = _load_from_json(experiment_id)
    if json_state is None:
        logger.info("No existing state found, starting fresh")
        return empty

    if json_state["agents"]:
        logger.info("Migrating %d agents from JSON → SQLite", len(json_state["agents"]))
        try:
            _save_to_sqlite(
                conn,
                agent_counter=json_state["agent_counter"],
                agents=json_state["agents"],
                experiment_id=json_state.get("experiment_id", experiment_id),
                task_counter=json_state.get("task_counter"),
                global_task_counter=json_state.get("global_task_counter", 0),
                teams=json_state.get("teams", []),
            )
            logger.info("Migration complete: JSON → SQLite")
        except Exception as e:
            logger.warning("Migration to SQLite failed (will retry next save): %s", e)

    return json_state


def save_state(
    agent_counter: int,
    agents: list[dict[str, Any]],
    experiment_id: str | None = None,
    task_counter: int | None = None,
    global_task_counter: int = 0,
    teams: list[dict[str, Any]] | None = None,
) -> None:
    """保存竞技场状态：SQLite 主写（WAL 事务）+ JSON 原子备份。"""
    conn = _ensure_conn()

    # ── 主写：SQLite（单事务，WAL crash-safe）──────────────────────────────
    try:
        _save_to_sqlite(
            conn,
            agent_counter=agent_counter,
            agents=agents,
            experiment_id=experiment_id,
            task_counter=task_counter,
            global_task_counter=global_task_counter,
            teams=teams,
        )
    except Exception as e:
        logger.error("SQLite save failed: %s", e)

    # ── 备份：JSON（tmp→rename 原子写）────────────────────────────────────
    _save_to_json_backup(
        agent_counter=agent_counter,
        agents=agents,
        experiment_id=experiment_id,
        task_counter=task_counter,
        global_task_counter=global_task_counter,
        teams=teams,
    )
