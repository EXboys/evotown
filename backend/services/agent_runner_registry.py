"""Agent runner registry — 注册 + 工厂，替代硬编码 engine 分发。

编排层通过 `registry.get(engine)` 获取 runner 实例，不感知具体
runner 类型。每个 engine 注册后对应的 runner 类按需实例化。
"""
from __future__ import annotations

from typing import Any

from services.agent_runner_base import AgentRunner

_registry: dict[str, type] = {}
_instances: dict[str, AgentRunner] = {}


def register(engine: str, runner_cls: type) -> None:
    """注册一个 engine → runner 映射。

    runner_cls 必须符合 AgentRunner Protocol（duck-typing，不做运行时校验）。
    """
    engine_key = engine.strip().lower()
    if not engine_key:
        raise ValueError("engine cannot be empty")
    _registry[engine_key] = runner_cls
    _instances.pop(engine_key, None)  # 清除旧实例，下次 get 时重建


def get(engine: str) -> AgentRunner | None:
    """获取 engine 对应的 runner 实例（单例缓存）。

    返回 None 表示 engine 未注册。
    """
    engine_key = engine.strip().lower()
    if engine_key not in _registry:
        return None
    if engine_key not in _instances:
        _instances[engine_key] = _registry[engine_key]()
    return _instances[engine_key]


def is_registered(engine: str) -> bool:
    return engine.strip().lower() in _registry


def list_engines() -> list[str]:
    return sorted(_registry.keys())


# ── 启动时自动注册 ────────────────────────────────────────────────


def _auto_register() -> None:
    """启动时注册所有已知 runner。

    延迟导入避免循环依赖；import 失败时静默跳过（runner 不可用）。
    """
    try:
        from services import claude_agent_sdk_runner
        register("claude", claude_agent_sdk_runner.ClaudeCodeRunner)
    except Exception:
        pass


_auto_register()
