"""WebSocket 消息类型定义 — 服务端广播与客户端请求"""
from typing import Any, Literal, TypedDict


# ── 服务端广播消息（Server → Client）────────────────────────────────────────────

class StateSnapshotAgent(TypedDict):
    agent_id: str
    balance: int
    in_task: bool


class StateSnapshotMsg(TypedDict):
    type: Literal["state_snapshot"]
    agents: list[StateSnapshotAgent]


class SpriteMoveMsg(TypedDict):
    type: Literal["sprite_move"]
    agent_id: str
    to: str
    reason: str
    # 构建时 "from" 键单独传入（Python 保留字）


class TaskCompleteMsg(TypedDict, total=False):
    type: Literal["task_complete"]
    agent_id: str
    success: bool
    balance: int
    judge: dict[str, Any]
    task: str
    difficulty: str


class TaskDispatchedMsg(TypedDict):
    type: Literal["task_dispatched"]
    agent_id: str
    task: str


class TaskAvailableMsg(TypedDict):
    type: Literal["task_available"]
    task_id: str
    task: str
    difficulty: str
    created_at: str


class TaskTakenMsg(TypedDict):
    type: Literal["task_taken"]
    task_id: str
    agent_id: str
    task: str


class TaskExpiredMsg(TypedDict):
    type: Literal["task_expired"]
    task_id: str
    task: str


class AgentEliminatedMsg(TypedDict):
    type: Literal["agent_eliminated"]
    agent_id: str
    reason: str


class AgentCreatedMsg(TypedDict):
    type: Literal["agent_created"]
    agent_id: str
    balance: int


class EvolutionEventMsg(TypedDict, total=False):
    type: Literal["evolution_event"]
    agent_id: str
    timestamp: str
    event_type: str
    target_id: str
    reason: str
    version: str


class PongMsg(TypedDict):
    type: Literal["pong"]
    ts: str


# 服务端可广播的消息类型
WsOutgoingMsg = (
    StateSnapshotMsg
    | SpriteMoveMsg
    | TaskCompleteMsg
    | TaskDispatchedMsg
    | TaskAvailableMsg
    | TaskTakenMsg
    | TaskExpiredMsg
    | AgentEliminatedMsg
    | AgentCreatedMsg
    | EvolutionEventMsg
    | PongMsg
)


# ── 客户端请求消息（Client → Server）────────────────────────────────────────────

class PingMsg(TypedDict):
    type: Literal["ping"]


WsIncomingMsg = PingMsg
