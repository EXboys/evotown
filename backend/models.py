"""Evotown Pydantic 数据模型"""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class AgentCreate(BaseModel):
    """创建 Agent 实例"""
    chat_dir: str | None = None  # 不指定则自动生成 ~/.skilllite/arena/agent_N


class AgentInfo(BaseModel):
    """Agent 实例信息"""
    id: str
    chat_dir: str
    balance: int = 100
    status: Literal["active", "stopped", "eliminated"] = "active"


class TaskInject(BaseModel):
    """任务注入请求"""
    agent_id: str
    task: str


class TaskBatch(BaseModel):
    """批量任务注入"""
    agent_id: str | Literal["all"] = "all"
    tasks: list[str]


# WebSocket 事件类型
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


class MetricsUpdateEvent(BaseModel):
    type: Literal["metrics_update"] = "metrics_update"
    agent_id: str
    egl: float
    first_success_rate: float
    avg_replans: float


class SpriteMoveEvent(BaseModel):
    type: Literal["sprite_move"] = "sprite_move"
    agent_id: str
    from_: str = Field(alias="from")
    to: str
    reason: str
