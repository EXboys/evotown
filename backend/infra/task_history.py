"""任务/评分历史持久化 — 支持长期分析"""
import json
import logging
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("evotown.task_history")

_HISTORY_PATH = Path(__file__).parent.parent / "task_history.jsonl"


def append_task_record(
    experiment_id: str,
    task_id: str,
    agent_id: str,
    task: str,
    difficulty: str,
    judge_result: dict[str, Any],
    elapsed_ms: float,
    success: bool,
    timeout: bool = False,
    refusal_count: int = 0,
) -> None:
    """追加一条任务完成记录（JSONL 格式）。claimed_by=认领者，refusal_count=认领前被拒绝次数"""
    record = {
        "experiment_id": experiment_id,
        "task_id": task_id,
        "agent_id": agent_id,
        "claimed_by": agent_id,
        "task": task[:500],
        "difficulty": difficulty,
        "outcome": "claimed",
        "judge": judge_result,
        "elapsed_ms": round(elapsed_ms),
        "success": success,
        "timeout": timeout,
        "refusal_count": refusal_count,
        "ts": time.time(),
    }
    try:
        with open(_HISTORY_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as e:
        logger.warning("Failed to append task record: %s", e)


def load_task_history(
    experiment_id: str | None = None,
    agent_id: str | None = None,
    outcome: str | None = None,
    limit: int = 1000,
) -> list[dict[str, Any]]:
    """加载任务历史，支持按 experiment_id、agent_id 过滤"""
    if not _HISTORY_PATH.exists():
        return []
    records: list[dict[str, Any]] = []
    try:
        with open(_HISTORY_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    if experiment_id and r.get("experiment_id") != experiment_id:
                        continue
                    if agent_id and r.get("agent_id") != agent_id:
                        continue
                    if outcome:
                        rec_outcome = r.get("outcome") or ("claimed" if r.get("agent_id") else "dropped")
                        if rec_outcome != outcome:
                            continue
                    records.append(r)
                except json.JSONDecodeError:
                    continue
        return records[-limit:] if limit else records
    except OSError as e:
        logger.warning("Failed to load task history: %s", e)
        return []


def append_task_dropped(
    experiment_id: str,
    task: str,
    difficulty: str,
    refusal_count: int,
) -> None:
    """记录任务被永久丢弃（无人认领、被多次拒绝后移出池）"""
    record = {
        "experiment_id": experiment_id,
        "task": task[:500],
        "difficulty": difficulty,
        "outcome": "dropped",
        "refusal_count": refusal_count,
        "ts": time.time(),
    }
    try:
        with open(_HISTORY_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as e:
        logger.warning("Failed to append task dropped: %s", e)
