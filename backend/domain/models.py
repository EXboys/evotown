"""Evotown API 数据模型（Pydantic）"""
from typing import Any, Literal
from pydantic import BaseModel, Field


class AgentCreate(BaseModel):
    chat_dir: str | None = None
    soul_type: Literal["conservative", "aggressive", "balanced"] = "balanced"


class AgentInfo(BaseModel):
    id: str
    chat_dir: str
    balance: int = 100
    status: Literal["active", "stopped", "eliminated"] = "active"
    in_task: bool = False
    soul_type: str = "balanced"


class TaskInject(BaseModel):
    agent_id: str
    task: str


class TaskBatch(BaseModel):
    agent_id: str | Literal["all"] = "all"
    tasks: list[str]


class EvolutionEvent(BaseModel):
    type: Literal["evolution_event"] = "evolution_event"
    agent_id: str
    timestamp: str
    detail: dict[str, Any]


class TaskCompleteEvent(BaseModel):
    type: Literal["task_complete"] = "task_complete"
    agent_id: str
    success: bool
    elapsed_ms: int
    replans: int


class SpriteMoveEvent(BaseModel):
    type: Literal["sprite_move"] = "sprite_move"
    agent_id: str
    from_: str = Field(alias="from")
    to: str
    reason: str
