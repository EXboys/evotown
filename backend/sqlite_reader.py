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


def _prompts_dir(chat_root: str) -> Path:
    return Path(chat_root) / "prompts"


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


async def get_egl_rolling(chat_root: str, days: int = 7) -> float:
    """过去 N 天内 (新增进化条数 / 触发数) * 1000"""
    db = _db_path(chat_root)
    if not db.exists():
        return 0.0
    modifier = f"-{days} days"
    async with aiosqlite.connect(str(db)) as conn:
        new_items = 0
        total_triggers = 0
        async with conn.execute(
            "SELECT COUNT(*) FROM evolution_log "
            "WHERE date(ts) >= date('now', ?) AND type IN ('rule_added', 'example_added', 'skill_generated')",
            (modifier,),
        ) as cur:
            row = await cur.fetchone()
            if row:
                new_items = row[0] or 0
        async with conn.execute(
            "SELECT COUNT(*) FROM decisions WHERE date(ts) >= date('now', ?) AND total_tools >= 1",
            (modifier,),
        ) as cur:
            row = await cur.fetchone()
            if row:
                total_triggers = row[0] or 0
        if total_triggers == 0:
            return 0.0
        return (new_items / total_triggers) * 1000.0


async def get_egl_all_time(chat_root: str) -> float:
    """全量 (新增进化条数 / 触发数) * 1000"""
    db = _db_path(chat_root)
    if not db.exists():
        return 0.0
    async with aiosqlite.connect(str(db)) as conn:
        new_items = 0
        total_triggers = 0
        async with conn.execute(
            "SELECT COUNT(*) FROM evolution_log "
            "WHERE type IN ('rule_added', 'example_added', 'skill_generated')",
        ) as cur:
            row = await cur.fetchone()
            if row:
                new_items = row[0] or 0
        async with conn.execute(
            "SELECT COUNT(*) FROM decisions WHERE total_tools >= 1",
        ) as cur:
            row = await cur.fetchone()
            if row:
                total_triggers = row[0] or 0
        if total_triggers == 0:
            return 0.0
        return (new_items / total_triggers) * 1000.0


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


def _parse_all_entries(paths: list[Path]) -> list[dict[str, Any]]:
    """读取多个 transcript 文件并合并为一个条目列表"""
    all_entries: list[dict[str, Any]] = []
    for p in paths:
        try:
            lines = p.read_text(encoding="utf-8").strip().splitlines()
        except OSError:
            continue
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                all_entries.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return all_entries


def _extract_excerpt(entries: list[dict[str, Any]], start_idx: int) -> list[dict[str, Any]]:
    """从 start_idx 处提取一段对话：当前 user 消息 + 后续非 user 消息"""
    excerpt: list[dict[str, Any]] = [entries[start_idx]]
    j = start_idx + 1
    while j < len(entries):
        nxt = entries[j]
        nxt_kind = nxt.get("type", "")
        nxt_role = nxt.get("role", "")
        if nxt_kind == "message" and nxt_role == "user":
            break
        excerpt.append(nxt)
        j += 1
    return excerpt


def get_transcript_excerpt_for_task(
    chat_root: str, session_key: str, task_text: str, ts_hint: float | None = None
) -> list[dict[str, Any]]:
    """获取某任务的完整 transcript 片段：用户消息 + 助手回复 + 工具调用等。

    优先按任务文本精确匹配；若 transcript 已被 compaction 清理导致匹配失败，
    则回退到基于 ts_hint 时间戳的最近邻匹配。
    """
    transcripts_dir = Path(chat_root) / "transcripts"
    paths = _list_transcript_files(transcripts_dir, session_key)
    if not paths:
        return []

    task_clean = (task_text or "").strip()
    if not task_clean:
        return []

    entries = _parse_all_entries(paths)
    if not entries:
        return []

    best_match: tuple[float, list[dict[str, Any]]] | None = None
    # 收集所有 user 消息索引（用于 ts_hint 回退）
    user_msg_indices: list[tuple[int, float]] = []

    i = 0
    while i < len(entries):
        entry = entries[i]
        kind = entry.get("type", "")
        role = entry.get("role", "")
        content = (entry.get("content") or "").strip()

        if kind == "message" and role == "user" and content:
            ts = entry.get("timestamp") or entry.get("ts")
            ts_num = _parse_ts_to_num(ts) if ts else 0

            if _PREVIEW_PREFIX in content:
                # 跳过预览消息，但记录索引用于 ts_hint 回退
                user_msg_indices.append((i, ts_num))
                i += 1
                continue

            # 记录索引
            user_msg_indices.append((i, ts_num))

            if content == task_clean or task_clean in content:
                excerpt = _extract_excerpt(entries, i)

                if ts_hint is not None:
                    score = -abs(ts_num - ts_hint) if ts_num else 0
                else:
                    score = ts_num
                if best_match is None or score > best_match[0]:
                    best_match = (score, excerpt)
                i += len(excerpt)
            else:
                i += 1
        else:
            i += 1

    if best_match:
        return best_match[1]

    # 回退 1：文本匹配失败（可能 compaction 已删除原始消息），
    # 尝试匹配包含任务文本的预览消息（【任务预览】xxx）
    for idx, ts_num in user_msg_indices:
        content = (entries[idx].get("content") or "").strip()
        if _PREVIEW_PREFIX in content and task_clean in content:
            return _extract_excerpt(entries, idx)

    # 回退 2：用 ts_hint 找最近的非预览 user 消息
    if ts_hint is not None and user_msg_indices:
        non_preview = [
            (idx, ts_num) for idx, ts_num in user_msg_indices
            if _PREVIEW_PREFIX not in (entries[idx].get("content") or "")
        ]
        candidates = non_preview if non_preview else user_msg_indices
        best_idx = min(candidates, key=lambda x: abs(x[1] - ts_hint) if x[1] else float("inf"))
        if best_idx[1] and abs(best_idx[1] - ts_hint) < 300:  # 5 分钟以内
            return _extract_excerpt(entries, best_idx[0])

    return []


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


def _scan_skill_dir(directory: Path, status: str, result: list[dict[str, Any]]) -> None:
    """扫描技能目录，追加到 result"""
    if not directory.exists() or not directory.is_dir():
        return
    for f in directory.iterdir():
        if not f.is_dir() or not (f / "SKILL.md").exists():
            continue
        if f.name.startswith("_"):
            continue
        info: dict[str, Any] = {"name": f.name, "status": status}
        meta_path = f / ".meta.json"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                if meta.get("archived"):
                    continue
                info["created_at"] = meta.get("created_at", "")
                info["call_count"] = meta.get("call_count", 0)
                info["success_count"] = meta.get("success_count", 0)
            except (json.JSONDecodeError, OSError):
                pass
        skill_md = f / "SKILL.md"
        try:
            content = skill_md.read_text(encoding="utf-8")
            for line in content.splitlines():
                line = line.strip()
                if line.lower().startswith("# ") or line.lower().startswith("## description"):
                    continue
                if line and not line.startswith("---") and not line.startswith("name:") and not line.startswith("compatibility:"):
                    info.setdefault("description", line[:120])
                    break
        except OSError:
            pass
        result.append(info)


async def get_skills(agent_home: str) -> list[dict[str, Any]]:
    """列出 agent 所有技能：预装（.skills/ 根目录）+ 进化（.skills/_evolved）"""
    skills_base = Path(agent_home) / ".skills"
    if not skills_base.exists() or not skills_base.is_dir():
        return []

    result: list[dict[str, Any]] = []
    seen: set[str] = set()

    # 1. 预装技能（.skills/calculator, .skills/http-request 等，排除 _evolved）
    for sub in skills_base.iterdir():
        if not sub.is_dir() or sub.name.startswith("_"):
            continue
        if (sub / "SKILL.md").exists() and sub.name not in seen:
            seen.add(sub.name)
            info: dict[str, Any] = {"name": sub.name, "status": "installed"}
            try:
                content = (sub / "SKILL.md").read_text(encoding="utf-8")
                for line in content.splitlines():
                    line = line.strip()
                    if line.lower().startswith("description:"):
                        info["description"] = line.split(":", 1)[1].strip()[:120]
                        break
                    if line and not line.startswith("---") and not line.startswith("name:"):
                        info.setdefault("description", line[:120])
                        break
            except OSError:
                pass
            result.append(info)

    # 2. 进化技能（.skills/_evolved 及 _pending）
    evolved_root = skills_base / "_evolved"
    _scan_skill_dir(evolved_root, "confirmed", result)
    _scan_skill_dir(evolved_root / "_pending", "pending", result)

    # 去重：进化技能覆盖同名的预装展示（实际不会重名）
    by_name: dict[str, dict[str, Any]] = {}
    for s in result:
        by_name[s["name"]] = s
    result = list(by_name.values())

    result.sort(key=lambda s: (
        0 if s["status"] == "pending" else (1 if s["status"] == "confirmed" else 2),
        s["name"],
    ))
    return result


async def get_skills_simple(agent_home: str) -> list[str]:
    """向后兼容：仅返回已确认技能名列表"""
    all_skills = await get_skills(agent_home)
    return [s["name"] for s in all_skills if s.get("status") == "confirmed"]


def confirm_skill(agent_home: str, skill_name: str) -> bool:
    """将 pending 技能移至 confirmed（_evolved/ 根目录）"""
    pending = Path(agent_home) / ".skills" / "_evolved" / "_pending" / skill_name
    target = Path(agent_home) / ".skills" / "_evolved" / skill_name
    if not pending.exists() or not pending.is_dir():
        return False
    if target.exists():
        return False
    import shutil
    shutil.move(str(pending), str(target))
    return True


def reject_skill(agent_home: str, skill_name: str) -> bool:
    """拒绝（删除）pending 技能"""
    pending = Path(agent_home) / ".skills" / "_evolved" / "_pending" / skill_name
    if not pending.exists() or not pending.is_dir():
        return False
    import shutil
    shutil.rmtree(str(pending))
    return True


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
    all_skills = await get_skills(agent_home)
    skill_names = {s["name"] for s in all_skills if isinstance(s, dict) and "name" in s}
    available = BUILTIN_TOOL_HINTS | skill_names
    for r in rules:
        hint = r.get("tool_hint")
        r["has_skill"] = not hint or hint in available  # 无 tool_hint 或拥有对应技能
    return rules


def _evolved_prompt_files(chat_root: str) -> set[str]:
    """从 changelog.jsonl 解析曾被进化修改过的 prompt 文件名"""
    changelog = _prompts_dir(chat_root) / "_versions" / "changelog.jsonl"
    if not changelog.exists():
        return set()
    evolved: set[str] = set()
    try:
        for line in changelog.read_text(encoding="utf-8").strip().splitlines():
            if not line.strip():
                continue
            try:
                data = json.loads(line)
                for f in data.get("files", []):
                    evolved.add(f)
            except json.JSONDecodeError:
                pass
    except OSError:
        pass
    return evolved


def _get_earliest_snapshot_content(chat_root: str, filename: str) -> str | None:
    """从最早的快照目录读取指定文件的原始内容（进化前版本）"""
    versions_dir = _prompts_dir(chat_root) / "_versions"
    if not versions_dir.exists():
        return None
    try:
        txn_dirs = sorted(
            [d for d in versions_dir.iterdir() if d.is_dir()],
            key=lambda d: d.name,
        )
    except OSError:
        return None
    for txn_dir in txn_dirs:
        file_path = txn_dir / filename
        if file_path.exists():
            try:
                return file_path.read_text(encoding="utf-8")
            except OSError:
                pass
    return None


async def get_prompts(chat_root: str) -> list[dict[str, Any]]:
    """读取 prompts 目录下的 planning.md, execution.md, system.md, examples.md，
    标注是否进化过，并为进化过的文件返回 original_content（进化前最早快照）供前端 diff。"""
    prompts_dir = _prompts_dir(chat_root)
    if not prompts_dir.exists():
        return []
    evolved_files = _evolved_prompt_files(chat_root)
    result: list[dict[str, Any]] = []
    for name, filename in [
        ("planning", "planning.md"),
        ("execution", "execution.md"),
        ("system", "system.md"),
        ("examples", "examples.md"),
    ]:
        path = prompts_dir / filename
        content = ""
        if path.exists():
            try:
                content = path.read_text(encoding="utf-8")
            except OSError:
                pass
        is_evolved = filename in evolved_files
        original_content: str | None = None
        if is_evolved:
            original_content = _get_earliest_snapshot_content(chat_root, filename)
            # 历史 changelog.files 记录的是「备份清单」而非「修改清单」。
            # 若快照内容与当前完全相同，该文件只是陪同备份，实际未被改动，不打标签。
            if original_content is not None and original_content == content:
                is_evolved = False
                original_content = None
        result.append({
            "name": name,
            "filename": filename,
            "content": content,
            "evolved": is_evolved,
            "original_content": original_content,
        })
    return result
