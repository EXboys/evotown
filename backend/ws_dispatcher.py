"""WebSocket 消息分发器 — 类型安全的广播与入站处理"""
from datetime import datetime
import json
import logging
from typing import Any, Callable, Awaitable

from fastapi import WebSocket

from ws_messages import (
    StateSnapshotAgent,
    StateSnapshotMsg,
    AgentCreatedMsg,
    AgentEliminatedMsg,
    TaskCompleteMsg,
    TaskDispatchedMsg,
    TaskAvailableMsg,
    TaskTakenMsg,
    TaskExpiredMsg,
    EvolutionEventMsg,
    PongMsg,
)

logger = logging.getLogger("evotown.ws")


class ConnectionManager:
    """WebSocket 连接池"""

    def __init__(self) -> None:
        self._connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self._connections:
            self._connections.remove(ws)

    @property
    def active(self) -> list[WebSocket]:
        return list(self._connections)

    async def broadcast(self, data: dict[str, Any]) -> None:
        for ws in self._connections:
            try:
                await ws.send_json(data)
            except Exception as e:
                logger.warning("WebSocket broadcast failed: %s", e)


class WsDispatcher:
    """WebSocket 消息分发器 — 构建并广播类型化消息"""

    def __init__(self, manager: ConnectionManager) -> None:
        self._manager = manager

    async def broadcast(self, data: dict[str, Any]) -> None:
        await self._manager.broadcast(data)

    # ── 出站消息构建器 ─────────────────────────────────────────────────────────

    def state_snapshot(self, agents: list[StateSnapshotAgent]) -> StateSnapshotMsg:
        return {"type": "state_snapshot", "agents": agents}

    def sprite_move(
        self,
        agent_id: str,
        from_place: str,
        to_place: str,
        reason: str,
    ) -> dict[str, Any]:
        return {
            "type": "sprite_move",
            "agent_id": agent_id,
            "from": from_place,
            "to": to_place,
            "reason": reason,
        }

    def task_complete(
        self,
        agent_id: str,
        success: bool,
        balance: int,
        judge: dict[str, Any],
        task: str = "",
        difficulty: str = "medium",
    ) -> TaskCompleteMsg:
        msg: TaskCompleteMsg = {
            "type": "task_complete",
            "agent_id": agent_id,
            "success": success,
            "balance": balance,
            "judge": judge,
        }
        if task:
            msg["task"] = task[:200]
        if difficulty:
            msg["difficulty"] = difficulty
        return msg

    def task_dispatched(self, agent_id: str, task: str) -> TaskDispatchedMsg:
        return {
            "type": "task_dispatched",
            "agent_id": agent_id,
            "task": task[:200],
        }

    def task_available(
        self, task_id: str, task: str, difficulty: str, created_at: str
    ) -> TaskAvailableMsg:
        return {
            "type": "task_available",
            "task_id": task_id,
            "task": task[:200],
            "difficulty": difficulty,
            "created_at": created_at,
        }

    def task_taken(self, task_id: str, agent_id: str, task: str) -> TaskTakenMsg:
        return {
            "type": "task_taken",
            "task_id": task_id,
            "agent_id": agent_id,
            "task": task[:200],
        }

    def task_expired(self, task_id: str, task: str) -> TaskExpiredMsg:
        return {
            "type": "task_expired",
            "task_id": task_id,
            "task": task[:200],
        }

    def agent_eliminated(self, agent_id: str, reason: str) -> AgentEliminatedMsg:
        return {
            "type": "agent_eliminated",
            "agent_id": agent_id,
            "reason": reason,
        }

    def agent_created(self, agent_id: str, balance: int) -> AgentCreatedMsg:
        return {
            "type": "agent_created",
            "agent_id": agent_id,
            "balance": balance,
        }

    def evolution_event(self, **kwargs: Any) -> EvolutionEventMsg:
        return {"type": "evolution_event", **kwargs}

    def pong(self) -> PongMsg:
        return {"type": "pong", "ts": datetime.now().isoformat()}

    # ── 便捷广播方法（构建 + 发送）──────────────────────────────────────────────

    async def send_state_snapshot(self, agents: list[StateSnapshotAgent]) -> None:
        await self.broadcast(self.state_snapshot(agents))

    async def send_sprite_move(
        self, agent_id: str, from_place: str, to_place: str, reason: str
    ) -> None:
        await self.broadcast(
            self.sprite_move(agent_id, from_place, to_place, reason)
        )

    async def send_task_complete(
        self,
        agent_id: str,
        success: bool,
        balance: int,
        judge: dict[str, Any],
        task: str = "",
        difficulty: str = "medium",
    ) -> None:
        await self.broadcast(
            self.task_complete(agent_id, success, balance, judge, task, difficulty)
        )

    async def send_task_dispatched(self, agent_id: str, task: str) -> None:
        await self.broadcast(self.task_dispatched(agent_id, task))

    async def send_task_available(
        self, task_id: str, task: str, difficulty: str, created_at: str
    ) -> None:
        await self.broadcast(
            self.task_available(task_id, task, difficulty, created_at)
        )

    async def send_task_taken(
        self, task_id: str, agent_id: str, task: str
    ) -> None:
        await self.broadcast(self.task_taken(task_id, agent_id, task))

    async def send_task_expired(self, task_id: str, task: str) -> None:
        await self.broadcast(self.task_expired(task_id, task))

    async def send_agent_eliminated(self, agent_id: str, reason: str) -> None:
        await self.broadcast(self.agent_eliminated(agent_id, reason))

    async def send_agent_created(self, agent_id: str, balance: int) -> None:
        await self.broadcast(self.agent_created(agent_id, balance))

    async def send_evolution_event(self, **kwargs: Any) -> None:
        await self.broadcast(self.evolution_event(**kwargs))

    async def send_pong(self) -> None:
        await self.broadcast(self.pong())


# 入站消息处理器类型
IncomingHandler = Callable[[dict[str, Any]], Awaitable[None]]


class WsIncomingDispatcher:
    """客户端消息分发 — 按 type 路由到对应 handler"""

    def __init__(self) -> None:
        self._handlers: dict[str, IncomingHandler] = {}

    def register(self, msg_type: str, handler: IncomingHandler) -> None:
        self._handlers[msg_type] = handler

    async def dispatch(self, raw: str) -> bool:
        """解析并分发，返回是否成功处理"""
        try:
            msg = json.loads(raw)
            if not isinstance(msg, dict):
                return False
            t = msg.get("type")
            if not t or t not in self._handlers:
                return False
            await self._handlers[t](msg)
            return True
        except json.JSONDecodeError:
            return False
