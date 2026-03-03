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
    """evolution_log 表；若为空则回退到 evolution.log 文件"""
    db = _db_path(chat_root)
    rows: list[dict[str, Any]] = []
    if db.exists():
        async with aiosqlite.connect(str(db)) as conn:
            conn.row_factory = aiosqlite.Row
            async with conn.execute(
                "SELECT * FROM evolution_log ORDER BY id DESC LIMIT ?", (limit,)
            ) as cur:
                rows = [dict(r) for r in await cur.fetchall()]
    if rows:
        return rows
    # 回退：读取 evolution.log JSONL 文件
    log_path = Path(chat_root) / "evolution.log"
    if not log_path.exists():
        return []
    try:
        lines = log_path.read_text(encoding="utf-8").strip().splitlines()
        result = []
        for line in reversed(lines[-limit:]):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                result.append({
                    "ts": data.get("ts", ""),
                    "type": data.get("type", "evolution"),
                    "target_id": data.get("id", ""),
                    "reason": data.get("reason", ""),
                })
            except json.JSONDecodeError:
                pass
        return result
    except OSError:
        return []


async def get_skills(agent_home: str) -> list[str]:
    """列出 agent_home/.skills/_evolved 下的技能（子目录，含 SKILL.md）"""
    evolved = Path(agent_home) / ".skills" / "_evolved"
    if not evolved.exists() or not evolved.is_dir():
        return []
    names = []
    for f in evolved.iterdir():
        if f.is_dir() and (f / "SKILL.md").exists():
            meta = f / ".meta.json"
            if meta.exists():
                try:
                    data = json.loads(meta.read_text(encoding="utf-8"))
                    if data.get("archived"):
                        continue
                except (json.JSONDecodeError, OSError):
                    pass
            names.append(f.name)
    return sorted(names)


# 与 task_planner.rs BUILTIN_HINTS 对齐：无需技能即可使用的 tool_hint
BUILTIN_TOOL_HINTS = frozenset({
    "file_operation", "chat_history", "memory_write", "memory_search", "memory_list", "analysis",
})


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


async def get_rules_with_skill_status(
    chat_root: str, agent_home: str
) -> list[dict[str, Any]]:
    """读取 rules.json，并为每条规则标注 has_skill（该 agent 是否拥有对应技能）"""
    rules = await get_rules(chat_root)
    skills = await get_skills(agent_home)
    available = BUILTIN_TOOL_HINTS | set(skills)
    for r in rules:
        hint = r.get("tool_hint")
        r["has_skill"] = not hint or hint in available  # 无 tool_hint 或拥有对应技能
    return rules
