"""实验 ID 与配置快照 — 支持可复现、可追溯"""
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.config import load_economy_config, load_evolution_config, load_timeout_config

logger = logging.getLogger("evotown.experiment")

_EXPERIMENT_DIR = Path(__file__).parent.parent
_META_PATH = _EXPERIMENT_DIR / "experiment_meta.json"


def generate_experiment_id() -> str:
    """生成实验 ID（UUID 短格式）"""
    return f"exp_{uuid.uuid4().hex[:12]}"


def load_experiment_id() -> str | None:
    """从已有 meta 文件加载 experiment_id（恢复时使用）"""
    if not _META_PATH.exists():
        return None
    try:
        data = json.loads(_META_PATH.read_text(encoding="utf-8"))
        return data.get("experiment_id")
    except (json.JSONDecodeError, OSError):
        return None


def save_experiment_snapshot(experiment_id: str) -> None:
    """保存实验配置快照，便于复现与追溯"""
    snapshot = {
        "experiment_id": experiment_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "economy": load_economy_config(),
        "evolution": load_evolution_config(),
        "timeouts": load_timeout_config(),
    }
    try:
        tmp = _META_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.rename(_META_PATH)
        logger.info("Experiment snapshot saved: %s", experiment_id)
    except OSError as e:
        logger.warning("Failed to save experiment snapshot: %s", e)


def get_or_create_experiment_id() -> str:
    """获取或创建实验 ID。恢复时沿用已有 ID，新启动时生成新 ID。"""
    existing = load_experiment_id()
    if existing:
        logger.info("Resuming experiment: %s", existing)
        return existing
    exp_id = generate_experiment_id()
    save_experiment_snapshot(exp_id)
    return exp_id
