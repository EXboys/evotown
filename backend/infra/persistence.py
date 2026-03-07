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

    empty: dict[str, Any] = {
        "agent_counter": 0, "task_counter": 0, "global_task_counter": 0,
        "agents": [], "teams": [], "experiment_id": experiment_id,
    }
    if path_to_read is None:
        return empty
    try:
        data = json.loads(path_to_read.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as e:
        logger.warning("Failed to load arena state: %s", e)
        return empty

    # ── 顶层计数器：类型异常时降级为 0 ──────────────────────────────────────
    def _int(val: Any, default: int = 0) -> int:
        try:
            return int(val)
        except (TypeError, ValueError):
            return default

    result: dict[str, Any] = {
        "agent_counter": _int(data.get("agent_counter"), 0),
        "task_counter": _int(data.get("task_counter"), 0),
        "global_task_counter": _int(data.get("global_task_counter"), 0),
        "agents": [],
        "teams": data.get("teams") if isinstance(data.get("teams"), list) else [],
    }
    if "experiment_id" in data:
        result["experiment_id"] = data["experiment_id"]
    elif experiment_id:
        result["experiment_id"] = experiment_id

    # ── 逐个 agent 容错：字段缺失或类型错误时用默认值，不让单个 agent 拖垮整体启动 ──
    for raw in data.get("agents", []):
        if not isinstance(raw, dict):
            logger.warning("Skipping non-dict agent entry: %s", raw)
            continue
        agent_id = raw.get("id")
        if not agent_id:
            logger.warning("Skipping agent entry with missing id: %s", raw)
            continue
        try:
            agent: dict[str, Any] = {
                "id": str(agent_id),
                "display_name": str(raw.get("display_name", "") or ""),
                "balance": _int(raw.get("balance"), 100),
                "status": str(raw.get("status", "active") or "active"),
                "soul_type": str(raw.get("soul_type", "balanced") or "balanced"),
                "team_id": raw.get("team_id"),  # None is valid
                "rescue_given": _int(raw.get("rescue_given"), 0),
                "rescue_received": _int(raw.get("rescue_received"), 0),
                "solo_preference": bool(raw.get("solo_preference", False)),
                "evolution_focus": str(raw.get("evolution_focus", "") or ""),
            }
            result["agents"].append(agent)
        except Exception as e:
            logger.warning("Skipping agent %s due to parse error: %s", agent_id, e)

    return result


def save_state(
    agent_counter: int,
    agents: list[dict[str, Any]],
    experiment_id: str | None = None,
    task_counter: int | None = None,
    global_task_counter: int = 0,
    teams: list[dict[str, Any]] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "agent_counter": agent_counter,
        "global_task_counter": global_task_counter,
        "agents": [
            {
                "id": a.get("id"),
                "display_name": a.get("display_name", ""),
                "balance": a.get("balance", 100),
                "status": a.get("status", "active"),
                "soul_type": a.get("soul_type", "balanced"),
                "team_id": a.get("team_id"),
                "rescue_given": a.get("rescue_given", 0),
                "rescue_received": a.get("rescue_received", 0),
                "solo_preference": a.get("solo_preference", False),
                "evolution_focus": a.get("evolution_focus", ""),
            }
            for a in agents
        ],
        "teams": teams or [],
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
