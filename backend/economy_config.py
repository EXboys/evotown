"""经济规则配置 — 丛林法则可调参
支持 evotown_config.json 或环境变量覆盖
"""
import json
import os
from pathlib import Path
from typing import Any


def _config_path() -> Path:
    return Path(__file__).parent / "evotown_config.json"


def load_economy_config() -> dict[str, Any]:
    """加载经济规则，优先级：env > evotown_config.json > 默认值"""
    defaults = {
        "initial_balance": 100,
        "cost_accept": -5,       # 接任务
        "reward_complete": 10,   # 完成任务
        "penalty_fail": -5,      # 未完成任务（默认 -5）
        "eliminate_on_zero": True,  # 余额≤0 是否淘汰
    }
    path = _config_path()
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            economy = data.get("economy", {})
            defaults.update({k: v for k, v in economy.items() if k in defaults})
        except (json.JSONDecodeError, OSError):
            pass

    # 环境变量覆盖
    env_map = {
        "EVOTOWN_INITIAL_BALANCE": ("initial_balance", int),
        "EVOTOWN_COST_ACCEPT": ("cost_accept", int),
        "EVOTOWN_REWARD_COMPLETE": ("reward_complete", int),
        "EVOTOWN_PENALTY_FAIL": ("penalty_fail", int),
        "EVOTOWN_ELIMINATE_ON_ZERO": ("eliminate_on_zero", lambda x: x.lower() in ("1", "true", "yes")),
    }
    for env_key, (cfg_key, conv) in env_map.items():
        val = os.environ.get(env_key)
        if val is not None:
            try:
                defaults[cfg_key] = conv(val)
            except (ValueError, TypeError):
                pass

    return defaults
