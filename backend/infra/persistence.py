"""竞技场状态持久化"""
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("evotown.persistence")

# 主路径（volume 挂载，跨容器重建持久化）
_STATE_PATH = Path("/app/data/arena_state.json")
# 兼容旧镜像路径（镜像内 bake 的初始状态，升级时自动迁移一次）
_LEGACY_STATE_PATH = Path(__file__).parent.parent / "arena_state.json"


def load_state(experiment_id: str | None = None) -> dict[str, Any]:
    # 确定要读取的路径：优先从 volume 读取，否则从镜像内 legacy 路径迁移
    path_to_read: Path | None = None
    if _STATE_PATH.exists():
        path_to_read = _STATE_PATH
    elif _LEGACY_STATE_PATH.exists():
        path_to_read = _LEGACY_STATE_PATH
        logger.info("Migrating arena_state.json from legacy path to data volume")

    if path_to_read is None:
        return {"agent_counter": 0, "task_counter": 0, "agents": [], "experiment_id": experiment_id}
    try:
        data = json.loads(path_to_read.read_text(encoding="utf-8"))
        result: dict[str, Any] = {
            "agent_counter": int(data.get("agent_counter", 0)),
            "task_counter": int(data.get("task_counter", 0)),
            "agents": data.get("agents", []),
        }
        if "experiment_id" in data:
            result["experiment_id"] = data["experiment_id"]
        elif experiment_id:
            result["experiment_id"] = experiment_id
        return result
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to load arena state: %s", e)
        return {"agent_counter": 0, "task_counter": 0, "agents": [], "experiment_id": experiment_id}


def save_state(
    agent_counter: int,
    agents: list[dict[str, Any]],
    experiment_id: str | None = None,
    task_counter: int | None = None,
) -> None:
    payload: dict[str, Any] = {
        "agent_counter": agent_counter,
        "agents": [
            {
                "id": a.get("id"),
                "display_name": a.get("display_name", ""),
                "balance": a.get("balance", 100),
                "status": a.get("status", "active"),
                "soul_type": a.get("soul_type", "balanced"),
            }
            for a in agents
        ],
    }
    if experiment_id:
        payload["experiment_id"] = experiment_id
    if task_counter is not None:
        payload["task_counter"] = task_counter
    try:
        _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _STATE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.rename(_STATE_PATH)
    except OSError as e:
        logger.warning("Failed to save arena state: %s", e)
