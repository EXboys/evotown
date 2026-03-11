"""Evotown API 数据模型（Pydantic）"""
from typing import Any, Literal
from pydantic import BaseModel, Field


# 社会分工：进化方向（对应 SKILLLITE_EVOLUTION）
EvolutionDivision = Literal["all", "prompts", "skills", "memory"]


class AgentCreate(BaseModel):
    chat_dir: str | None = None
    soul_type: Literal["conservative", "aggressive", "balanced"] = "balanced"
    """社会分工：进化方向。不传则可由后端用大模型推断或系统分配，默认 all"""
    evolution_division: EvolutionDivision | None = None


class AgentInfo(BaseModel):
    id: str
    display_name: str = ""
    chat_dir: str
    balance: int = 100
    status: Literal["active", "stopped", "eliminated"] = "active"
    in_task: bool = False
    soul_type: str = "balanced"
    task_count: int = 0
    success_count: int = 0
    evolution_count: int = 0
    evolution_success_count: int = 0
    team_id: str | None = None
    team_name: str | None = None
    """社会分工：进化方向（规则与示例 / 技能 / 记忆 / 全能）"""
    evolution_division: str = "all"


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


class RepairSkillsBody(BaseModel):
    """仅修复指定技能时传 skill_names；不传或空数组则修复全部失败技能。"""
    skill_names: list[str] = []
