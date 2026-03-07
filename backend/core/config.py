"""Evotown 配置 — 经济规则、进化触发等"""
import json
import os
from pathlib import Path
from typing import Any

_CONFIG_PATH = Path(__file__).parent.parent / "evotown_config.json"


def _load_json() -> dict[str, Any]:
    if _CONFIG_PATH.exists():
        try:
            return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def load_economy_config() -> dict[str, Any]:
    """经济规则：env > evotown_config.json > 默认"""
    data = _load_json()
    defaults = {
        "initial_balance": 100,
        "cost_accept": -3,
        "reward_complete": 5,
        "penalty_fail": -5,
        "penalty_refuse": -1,
        "eliminate_on_zero": True,
    }
    economy = data.get("economy", {})
    defaults.update({k: v for k, v in economy.items() if k in defaults})

    env_map = {
        "EVOTOWN_INITIAL_BALANCE": ("initial_balance", int),
        "EVOTOWN_COST_ACCEPT": ("cost_accept", int),
        "EVOTOWN_REWARD_COMPLETE": ("reward_complete", int),
        "EVOTOWN_PENALTY_FAIL": ("penalty_fail", int),
        "EVOTOWN_PENALTY_REFUSE": ("penalty_refuse", int),
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


def load_evolution_config() -> dict[str, Any]:
    """进化触发配置。降低默认门槛以促进进化产出。"""
    data = _load_json()
    evo = data.get("evolution", {})
    rewards = evo.get("rewards") or {}
    defaults = {
        "auto_trigger": evo.get("auto_trigger", True),
        "interval_tasks": int(evo.get("interval_tasks", 2)),  # 2: 更频繁触发进化
        "on_failure": evo.get("on_failure", True),
        "failure_cooldown": int(evo.get("failure_cooldown", 2)),  # 2: 失败后更快再触发
        "rewards": {
            "rule_added": int(rewards.get("rule_added", 5)),
            "example_added": int(rewards.get("example_added", 3)),
            "skill_confirmed": int(rewards.get("skill_confirmed", 12)),
            "skill_refined": int(rewards.get("skill_refined", 5)),
            "skill_pending": int(rewards.get("skill_pending", 4)),
        },
    }
    env_map = {
        "EVOTOWN_INTERVAL_TASKS": ("interval_tasks", int),
        "EVOTOWN_FAILURE_COOLDOWN": ("failure_cooldown", int),
    }
    for env_key, (cfg_key, conv) in env_map.items():
        val = os.environ.get(env_key)
        if val is not None:
            try:
                defaults[cfg_key] = conv(val)
            except (ValueError, TypeError):
                pass
    return defaults


def load_team_config() -> dict[str, Any]:
    """团队重组配置：重组间隔任务数、强队维系成本、防垄断上限比"""
    data = _load_json()
    team = data.get("team", {})
    defaults = {
        "reorganize_interval_tasks": int(team.get("reorganize_interval_tasks", 20)),
        "cost_stay": int(team.get("cost_stay", 10)),
        "max_team_ratio": float(team.get("max_team_ratio", 0.4)),
    }
    env_map = {
        "EVOTOWN_REORGANIZE_INTERVAL": ("reorganize_interval_tasks", int),
        "EVOTOWN_COST_STAY": ("cost_stay", int),
        "EVOTOWN_MAX_TEAM_RATIO": ("max_team_ratio", float),
    }
    for env_key, (cfg_key, conv) in env_map.items():
        val = os.environ.get(env_key)
        if val is not None:
            try:
                defaults[cfg_key] = conv(val)
            except (ValueError, TypeError):
                pass
    return defaults


def load_timeout_config() -> dict[str, Any]:
    """超时配置：任务执行超时、Judge LLM 调用超时、单任务最大工具调用步数"""
    data = _load_json()
    timeouts = data.get("timeouts", {})
    defaults = {
        "task_timeout_seconds": 600,  # 10 分钟
        "judge_timeout_seconds": 60,
        "max_tool_calls": 25,         # 单任务最多工具调用步数（P2-9）
    }
    defaults.update({k: v for k, v in timeouts.items() if k in defaults})

    env_map = {
        "EVOTOWN_TASK_TIMEOUT_SECONDS": ("task_timeout_seconds", int),
        "EVOTOWN_JUDGE_TIMEOUT_SECONDS": ("judge_timeout_seconds", int),
        "EVOTOWN_MAX_TOOL_CALLS": ("max_tool_calls", int),
    }
    for env_key, (cfg_key, conv) in env_map.items():
        val = os.environ.get(env_key)
        if val is not None:
            try:
                defaults[cfg_key] = conv(val)
            except (ValueError, TypeError):
                pass
    return defaults
