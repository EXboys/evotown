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
    """进化触发配置。默认关闭自动进化，协作地图以观测为主；可在 evotown_config.json 或环境变量开启。"""
    data = _load_json()
    evo = data.get("evolution", {})
    rewards = evo.get("rewards") or {}
    defaults = {
        "auto_trigger": evo.get("auto_trigger", False),
        "interval_tasks": int(evo.get("interval_tasks", 2)),
        "on_failure": evo.get("on_failure", False),
        "failure_cooldown": int(evo.get("failure_cooldown", 2)),
        "rewards": {
            "rule_added": int(rewards.get("rule_added", 5)),
            "example_added": int(rewards.get("example_added", 3)),
            "skill_confirmed": int(rewards.get("skill_confirmed", 12)),
            "skill_refined": int(rewards.get("skill_refined", 5)),
            "skill_pending": int(rewards.get("skill_pending", 4)),
        },
    }
    env_map = {
        "EVOTOWN_EVOLUTION_AUTO_TRIGGER": ("auto_trigger", lambda x: x.lower() in ("1", "true", "yes")),
        "EVOTOWN_EVOLUTION_ON_FAILURE": ("on_failure", lambda x: x.lower() in ("1", "true", "yes")),
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
        "cost_stay": int(team.get("cost_stay", 5)),
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


def load_dispatch_config() -> dict[str, Any]:
    """Dispatch / handoff policy: env EVOTOWN_DISPATCH_TEAM_PAIRS overrides evotown_config.json."""
    data = _load_json()
    dispatch = data.get("dispatch", {})
    team_pairs = dispatch.get("team_pairs", "*")
    if team_pairs is None:
        team_pairs = "*"
    team_pairs = str(team_pairs).strip() or "*"
    env_pairs = os.environ.get("EVOTOWN_DISPATCH_TEAM_PAIRS")
    if env_pairs is not None:
        team_pairs = env_pairs.strip() or "*"
    return {"team_pairs": team_pairs}


def save_dispatch_team_pairs(team_pairs: str) -> dict[str, Any]:
    """Persist handoff team pairs to evotown_config.json (env still overrides at runtime)."""
    raw = (team_pairs or "*").strip() or "*"
    data = _load_json()
    data.setdefault("dispatch", {})["team_pairs"] = raw
    _CONFIG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return load_dispatch_config()


def load_display_config() -> dict[str, Any]:
    """界面显示时区（IANA）。env EVOTOWN_DISPLAY_TIMEZONE 覆盖 evotown_config.json。"""
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    data = _load_json()
    display = data.get("display", {})
    tz = str(display.get("timezone", "Asia/Shanghai")).strip() or "Asia/Shanghai"
    env_tz = os.environ.get("EVOTOWN_DISPLAY_TIMEZONE")
    if env_tz is not None:
        tz = env_tz.strip() or tz
    try:
        ZoneInfo(tz)
    except ZoneInfoNotFoundError:
        tz = "UTC"
    return {"timezone": tz}


def save_display_timezone(timezone: str) -> dict[str, Any]:
    """持久化显示时区到 evotown_config.json（env 仍在运行时覆盖）。"""
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    raw = (timezone or "").strip()
    if not raw:
        raise ValueError("timezone is required")
    try:
        ZoneInfo(raw)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"invalid timezone: {raw}") from exc
    data = _load_json()
    data.setdefault("display", {})["timezone"] = raw
    _CONFIG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return load_display_config()


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
