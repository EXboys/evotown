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


def compute_stats_from_history(
    experiment_id: str | None = None,
    limit: int = 10000,
) -> dict[str, Any]:
    """从持久化的 task_history 计算竞技场统计与裁判评分，用于后台重启后恢复历史数据。
    返回格式与 ArenaMonitor.stats() 一致，并扩展裁判评分字段。"""
    records = load_task_history(experiment_id=experiment_id, outcome="claimed", limit=limit)
    completed = [r for r in records if r.get("success") is True]
    failed = [r for r in records if r.get("success") is False]
    total = len(records)
    elapsed_list = [r.get("elapsed_ms", 0) for r in records if isinstance(r.get("elapsed_ms"), (int, float))]
    avg_elapsed = sum(elapsed_list) / max(len(elapsed_list), 1)

    # 裁判评分：从 judge 字段聚合
    rewards: list[int | float] = []
    total_scores: list[int | float] = []
    completions: list[int | float] = []
    qualities: list[int | float] = []
    efficiencies: list[int | float] = []
    for r in records:
        j = r.get("judge") or {}
        if isinstance(j, dict):
            if "reward" in j and isinstance(j["reward"], (int, float)):
                rewards.append(j["reward"])
            if "total_score" in j and isinstance(j["total_score"], (int, float)):
                total_scores.append(j["total_score"])
            if "completion" in j and isinstance(j["completion"], (int, float)):
                completions.append(j["completion"])
            if "quality" in j and isinstance(j["quality"], (int, float)):
                qualities.append(j["quality"])
            if "efficiency" in j and isinstance(j["efficiency"], (int, float)):
                efficiencies.append(j["efficiency"])

    return {
        "active_tasks": 0,  # 持久化数据无法反映当前进行中任务，由调用方合并
        "total_completed": total,
        "success_count": len(completed),
        "fail_count": len(failed),
        "success_rate": len(completed) / max(total, 1),
        "avg_elapsed_ms": round(avg_elapsed, 1),
        # 裁判评分
        "total_reward": sum(rewards),
        "avg_reward": round(sum(rewards) / max(len(rewards), 1), 1),
        "avg_total_score": round(sum(total_scores) / max(len(total_scores), 1), 1),
        "avg_completion": round(sum(completions) / max(len(completions), 1), 1),
        "avg_quality": round(sum(qualities) / max(len(qualities), 1), 1),
        "avg_efficiency": round(sum(efficiencies) / max(len(efficiencies), 1), 1),
    }


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
