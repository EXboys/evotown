"""消失的智能体归档 — 淘汰/删除时记录，供墓园查看"""
import json
import logging
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("evotown.eliminated")

_PATH = Path(__file__).parent.parent / "eliminated_agents.jsonl"


def append_eliminated(
    agent_id: str,
    reason: str,
    final_balance: int = 0,
    soul_type: str = "balanced",
) -> None:
    """记录一个被淘汰/删除的 agent"""
    record = {
        "agent_id": agent_id,
        "reason": reason,
        "final_balance": final_balance,
        "soul_type": soul_type,
        "ts": time.time(),
    }
    try:
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as e:
        logger.warning("Failed to append eliminated agent: %s", e)


def load_eliminated(limit: int = 200) -> list[dict[str, Any]]:
    """加载已淘汰/删除的 agent 列表，按时间倒序"""
    if not _PATH.exists():
        return []
    records: list[dict[str, Any]] = []
    try:
        with open(_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        records.sort(key=lambda r: r.get("ts", 0), reverse=True)
        return records[:limit]
    except OSError as e:
        logger.warning("Failed to load eliminated agents: %s", e)
        return []
