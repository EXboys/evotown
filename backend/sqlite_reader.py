"""读取 decisions / evolution_log / evolution_metrics 表 + rules.json"""
import json
from pathlib import Path
from typing import Any

import aiosqlite


def _db_path(chat_root: str) -> Path:
    return Path(chat_root) / "memory" / "default.sqlite"


def _rules_path(chat_root: str) -> Path:
    return Path(chat_root) / "prompts" / "rules.json"


async def get_metrics(chat_root: str, limit: int = 100) -> list[dict[str, Any]]:
    """查询 evolution_metrics 表（EGL 曲线）"""
    db = _db_path(chat_root)
    if not db.exists():
        return []
    async with aiosqlite.connect(str(db)) as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            "SELECT * FROM evolution_metrics ORDER BY date DESC LIMIT ?", (limit,)
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def get_decisions(chat_root: str, limit: int = 50) -> list[dict[str, Any]]:
    """最近 N 条 decisions 记录"""
    db = _db_path(chat_root)
    if not db.exists():
        return []
    async with aiosqlite.connect(str(db)) as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            "SELECT * FROM decisions ORDER BY id DESC LIMIT ?", (limit,)
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def get_evolution_log(chat_root: str, limit: int = 100) -> list[dict[str, Any]]:
    """evolution_log 表"""
    db = _db_path(chat_root)
    if not db.exists():
        return []
    async with aiosqlite.connect(str(db)) as conn:
        conn.row_factory = aiosqlite.Row
        async with conn.execute(
            "SELECT * FROM evolution_log ORDER BY id DESC LIMIT ?", (limit,)
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def get_rules(chat_root: str) -> list[dict[str, Any]]:
    """读取 rules.json（规则热力图数据）"""
    path = _rules_path(chat_root)
    if not path.exists():
        return []
    try:
        content = path.read_text(encoding="utf-8")
        data = json.loads(content)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "rules" in data:
            return data["rules"]
        return []
    except (json.JSONDecodeError, OSError):
        return []
