"""兼容层 — 转发到 domain.models"""
from domain.models import (
    AgentCreate,
    AgentInfo,
    TaskInject,
    TaskBatch,
    EvolutionEvent,
    TaskCompleteEvent,
    SpriteMoveEvent,
)

__all__ = [
    "AgentCreate",
    "AgentInfo",
    "TaskInject",
    "TaskBatch",
    "EvolutionEvent",
    "TaskCompleteEvent",
    "SpriteMoveEvent",
]
