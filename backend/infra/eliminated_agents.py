"""消失的智能体归档 — 淘汰/删除时记录，供墓园查看

路径：使用 EVOTOWN_DATA_DIR，确保容器重启后不丢失。
"""
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("evotown.eliminated")

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"
_DATA_DIR = Path(os.environ.get("EVOTOWN_DATA_DIR", _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"))
_PATH = _DATA_DIR / "eliminated_agents.jsonl"
_LEGACY_PATH = Path(__file__).parent.parent / "eliminated_agents.jsonl"
_migration_done = False


def _ensure_migrated() -> None:
    global _migration_done
    if _migration_done:
        return
    _migration_done = True
    if _PATH.exists() or not _LEGACY_PATH.exists():
        return
    try:
        import shutil
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(_LEGACY_PATH, _PATH)
        logger.info("Migrated eliminated_agents.jsonl from legacy path to %s", _PATH)
    except OSError as e:
        logger.warning("Legacy eliminated_agents migration failed: %s", e)


def append_eliminated(
    agent_id: str,
    reason: str,
    final_balance: int = 0,
    soul_type: str = "balanced",
    display_name: str = "",
) -> None:
    """记录一个被淘汰/删除的 agent"""
    _ensure_migrated()
    record = {
        "agent_id": agent_id,
        "reason": reason,
        "final_balance": final_balance,
        "soul_type": soul_type,
        "display_name": display_name or agent_id,
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
    _ensure_migrated()
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
