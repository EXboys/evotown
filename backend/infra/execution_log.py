"""任务态度/执行记录 — 接受、拒绝、执行结果（含拒绝任务）

路径：使用 EVOTOWN_DATA_DIR，与 task_history 同目录，确保容器重启后不丢失。
"""
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("evotown.execution_log")

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"
_DATA_DIR = Path(os.environ.get("EVOTOWN_DATA_DIR", _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"))
_LEGACY_PATH = Path(__file__).parent.parent / "execution_log.jsonl"
_migration_done = False


def _path() -> Path:
    global _migration_done
    p = _DATA_DIR / "execution_log.jsonl"
    if not _migration_done:
        _migration_done = True
        if not p.exists() and _LEGACY_PATH.exists():
            try:
                import shutil
                p.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(_LEGACY_PATH, p)
                logger.info("Migrated execution_log.jsonl from legacy path to %s", p)
            except OSError as e:
                logger.warning("Legacy execution_log migration failed: %s", e)
    return p


def append_refusal(
    agent_id: str,
    task: str,
    difficulty: str,
    reason: str = "",
) -> None:
    """记录 agent 拒绝的任务"""
    record = {
        "ts": time.time(),
        "agent_id": agent_id,
        "task": (task or "")[:500],
        "difficulty": difficulty or "medium",
        "status": "refused",
        "refusal_reason": (reason or "")[:300],
    }
    try:
        p = _path()
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as e:
        logger.warning("Failed to append refusal: %s", e)


def count_refusals_by_task() -> dict[str, int]:
    """统计每个任务被拒绝的次数，用于分发时过滤高拒绝率任务"""
    p = _path()
    if not p.exists():
        return {}
    counts: dict[str, int] = {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    if r.get("status") != "refused":
                        continue
                    task = (r.get("task") or "").strip()
                    if not task:
                        continue
                    counts[task] = counts.get(task, 0) + 1
                except json.JSONDecodeError:
                    continue
        return counts
    except OSError as e:
        logger.warning("Failed to load refusal counts: %s", e)
        return {}


def load_all_refusals(limit: int = 500) -> list[dict[str, Any]]:
    """加载所有拒绝记录，用于任务历史展示"""
    p = _path()
    if not p.exists():
        return []
    records: list[dict[str, Any]] = []
    try:
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    if r.get("status") != "refused":
                        continue
                    records.append(r)
                except json.JSONDecodeError:
                    continue
        return records[-limit:] if limit else records
    except OSError as e:
        logger.warning("Failed to load all refusals: %s", e)
        return []


def load_refusals(agent_id: str, limit: int = 100) -> list[dict[str, Any]]:
    """加载某 agent 的拒绝记录"""
    p = _path()
    if not p.exists():
        return []
    records: list[dict[str, Any]] = []
    try:
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    if r.get("agent_id") != agent_id:
                        continue
                    if r.get("status") != "refused":
                        continue
                    records.append(r)
                except json.JSONDecodeError:
                    continue
        return records[-limit:] if limit else records
    except OSError as e:
        logger.warning("Failed to load refusals: %s", e)
        return []
