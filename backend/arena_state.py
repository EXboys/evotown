"""Evotown 竞技场状态落盘 — 重启后恢复 agent 列表与 counter"""
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("evotown.state")

_STATE_PATH = Path(__file__).parent / "arena_state.json"


def load_state() -> dict[str, Any]:
    """加载落盘状态"""
    if not _STATE_PATH.exists():
        return {"agent_counter": 0, "agents": []}
    try:
        data = json.loads(_STATE_PATH.read_text(encoding="utf-8"))
        return {
            "agent_counter": int(data.get("agent_counter", 0)),
            "agents": data.get("agents", []),
        }
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to load arena state: %s", e)
        return {"agent_counter": 0, "agents": []}


def save_state(agent_counter: int, agents: list[dict[str, Any]]) -> None:
    """保存状态到磁盘（仅可序列化字段）"""
    payload = {
        "agent_counter": agent_counter,
        "agents": [
            {
                "id": a.get("id"),
                "balance": a.get("balance", 100),
                "status": a.get("status", "active"),
            }
            for a in agents
        ],
    }
    try:
        _STATE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as e:
        logger.warning("Failed to save arena state: %s", e)
