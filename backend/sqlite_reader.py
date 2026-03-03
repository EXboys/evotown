"""读取 decisions / evolution_log / evolution_metrics 表 + rules.json + transcript"""
import json
from pathlib import Path
from typing import Any

import aiosqlite

# 任务预览前缀，需排除
_PREVIEW_PREFIX = "【任务预览】"


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


def _list_transcript_files(transcripts_dir: Path, session_key: str) -> list[Path]:
    """列出 session 的 transcript 文件，按日期升序（旧→新）"""
    if not transcripts_dir.exists():
        return []
    files: list[Path] = []
    legacy = transcripts_dir / f"{session_key}.jsonl"
    if legacy.exists():
        files.append(legacy)
    for p in transcripts_dir.iterdir():
        if not p.is_file() or p.suffix != ".jsonl":
            continue
        name = p.stem
        if name == session_key:
            continue
        if name.startswith(f"{session_key}-"):
            files.append(p)
    files.sort(key=lambda p: p.stem)
    return files


def _parse_ts_to_num(ts: Any) -> float:
    """解析时间戳为 Unix 秒数"""
    if isinstance(ts, (int, float)):
        return float(ts)
    if isinstance(ts, str) and ts:
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00")[:26])
            return dt.timestamp()
        except Exception:
            pass
    return 0.0


def get_transcript_executions(
    chat_root: str, session_key: str, limit: int = 50
) -> list[dict[str, Any]]:
    """从 SkillLite transcript 解析执行记录（含无工具调用的任务）"""
    transcripts_dir = Path(chat_root) / "transcripts"
    paths = _list_transcript_files(transcripts_dir, session_key)
    if not paths:
        return []

    executions: list[dict[str, Any]] = []
    for p in paths:
        try:
            mtime = p.stat().st_mtime
            lines = p.read_text(encoding="utf-8").strip().splitlines()
        except OSError:
            continue

        entries: list[dict[str, Any]] = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                pass

        session_ts: str | None = None
        i = 0
        while i < len(entries):
            entry = entries[i]
            kind = entry.get("type", "")
            role = entry.get("role", "")
            content = (entry.get("content") or "").strip()

            if kind == "session":
                session_ts = entry.get("timestamp")
                i += 1
                continue

            if kind == "message" and role == "user" and content:
                if _PREVIEW_PREFIX in content:
                    i += 1
                    continue
                task = content
                ts = entry.get("timestamp") or entry.get("ts") or session_ts
                ts_num = _parse_ts_to_num(ts) if ts else (mtime + i * 0.001)

                j = i + 1
                response = ""
                while j < len(entries):
                    nxt = entries[j]
                    if nxt.get("type") == "message" and nxt.get("role") == "assistant":
                        response = (nxt.get("content") or "").strip()
                        break
                    if nxt.get("type") == "message" and nxt.get("role") == "user":
                        break
                    j += 1

                executions.append({
                    "ts": ts,
                    "ts_num": ts_num,
                    "task": task[:500],
                    "status": "executed",
                    "task_completed": None,
                    "response": response[:100],
                })
                i = j if j > i else i + 1
            else:
                i += 1

    return executions[-limit:] if limit else executions


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


def _normalize_evolution_row(row: dict[str, Any]) -> dict[str, Any]:
    """统一 evolution_log 行格式，兼容不同 schema"""
    ts = row.get("ts") or row.get("timestamp") or row.get("date") or ""
    type_ = row.get("type") or row.get("event_type") or "evolution"
    target_id = row.get("target_id") or row.get("id") or ""
    reason = row.get("reason") or ""
    return {"ts": str(ts), "type": str(type_), "target_id": str(target_id), "reason": str(reason)}


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
                raw = [dict(r) for r in await cur.fetchall()]
                rows = [_normalize_evolution_row(r) for r in raw]
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
