"""实验 ID 与配置快照 — 支持可复现、可追溯

路径：使用 EVOTOWN_DATA_DIR，确保容器重启后 experiment_id 不变，任务历史可正确过滤。
"""
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.config import load_economy_config, load_evolution_config, load_timeout_config

logger = logging.getLogger("evotown.experiment")

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"
_DATA_DIR = Path(os.environ.get("EVOTOWN_DATA_DIR", _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"))
_META_PATH = _DATA_DIR / "experiment_meta.json"
_LEGACY_META_PATH = Path(__file__).parent.parent / "experiment_meta.json"


def generate_experiment_id() -> str:
    """生成实验 ID（UUID 短格式）"""
    return f"exp_{uuid.uuid4().hex[:12]}"


def _migrate_experiment_meta() -> None:
    """若新路径无文件但旧路径有，则迁移"""
    if _META_PATH.exists() or not _LEGACY_META_PATH.exists():
        return
    try:
        import shutil
        _META_PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(_LEGACY_META_PATH, _META_PATH)
        logger.info("Migrated experiment_meta.json from legacy path to %s", _META_PATH)
    except OSError as e:
        logger.warning("Legacy experiment_meta migration failed: %s", e)


def load_experiment_id() -> str | None:
    """从已有 meta 文件加载 experiment_id（恢复时使用）"""
    _migrate_experiment_meta()
    if not _META_PATH.exists():
        return None
    try:
        data = json.loads(_META_PATH.read_text(encoding="utf-8"))
        return data.get("experiment_id")
    except (json.JSONDecodeError, OSError):
        return None


def save_experiment_snapshot(experiment_id: str) -> None:
    """保存实验配置快照，便于复现与追溯"""
    _META_PATH.parent.mkdir(parents=True, exist_ok=True)
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
