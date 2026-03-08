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
    TeamFormedMsg,
    TeamInfo,
    RescueEventMsg,
    RescueNeededMsg,
    TeamReorganizedMsg,
    AgentMessageMsg,
    AgentDecisionMsg,
    AgentLastStandMsg,
    SubtitleBroadcastMsg,
    AgentDefectedMsg,
    TeamCreedGeneratedMsg,
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
        # 同步写入 replay（如果当前有录制 session）
        try:
            from infra.replay import get_recorder
            rec = get_recorder()
            if rec is not None:
                rec.record(data)
        except Exception as _replay_err:  # noqa: BLE001
            logger.debug("replay record error: %s", _replay_err)
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

    def agent_created(self, agent_id: str, balance: int, display_name: str = "") -> AgentCreatedMsg:
        return {
            "type": "agent_created",
            "agent_id": agent_id,
            "display_name": display_name or agent_id,
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

    async def send_agent_created(self, agent_id: str, balance: int, display_name: str = "") -> None:
        await self.broadcast(self.agent_created(agent_id, balance, display_name))

    async def send_evolution_event(self, **kwargs: Any) -> None:
        await self.broadcast(self.evolution_event(**kwargs))

    async def send_pong(self) -> None:
        await self.broadcast(self.pong())

    # ── 结阵消息 ───────────────────────────────────────────────────────────────

    def team_formed(self, teams: list[TeamInfo]) -> TeamFormedMsg:
        return {"type": "team_formed", "teams": teams}

    def rescue_event(
        self,
        donor_id: str,
        donor_display_name: str,
        target_id: str,
        target_display_name: str,
        amount: int,
        donor_balance: int,
        target_balance: int,
        team_id: str,
        team_name: str,
    ) -> RescueEventMsg:
        return {
            "type": "rescue_event",
            "donor_id": donor_id,
            "donor_display_name": donor_display_name,
            "target_id": target_id,
            "target_display_name": target_display_name,
            "amount": amount,
            "donor_balance": donor_balance,
            "target_balance": target_balance,
            "team_id": team_id,
            "team_name": team_name,
        }

    def rescue_needed(
        self,
        agent_id: str,
        display_name: str,
        balance: int,
        team_id: str,
        team_name: str,
    ) -> RescueNeededMsg:
        return {
            "type": "rescue_needed",
            "agent_id": agent_id,
            "display_name": display_name,
            "balance": balance,
            "team_id": team_id,
            "team_name": team_name,
        }

    async def send_team_formed(self, teams: list[TeamInfo]) -> None:
        await self.broadcast(self.team_formed(teams))

    async def send_rescue_event(self, **kwargs: Any) -> None:
        await self.broadcast(self.rescue_event(**kwargs))

    async def send_rescue_needed(
        self,
        agent_id: str,
        display_name: str,
        balance: int,
        team_id: str,
        team_name: str,
    ) -> None:
        await self.broadcast(
            self.rescue_needed(agent_id, display_name, balance, team_id, team_name)
        )

    def team_reorganized(
        self,
        survived_teams: list[str],
        dissolved_teams: list[str],
        dissolved_team_names: list[str],
        refugees: list[str],
        cost_stay: int,
        global_task_count: int,
    ) -> TeamReorganizedMsg:
        return {
            "type": "team_reorganized",
            "survived_teams": survived_teams,
            "dissolved_teams": dissolved_teams,
            "dissolved_team_names": dissolved_team_names,
            "refugees": refugees,
            "cost_stay": cost_stay,
            "global_task_count": global_task_count,
        }

    async def send_team_reorganized(
        self,
        survived_teams: list[str],
        dissolved_teams: list[str],
        dissolved_team_names: list[str],
        refugees: list[str],
        cost_stay: int,
        global_task_count: int,
    ) -> None:
        await self.broadcast(
            self.team_reorganized(
                survived_teams, dissolved_teams, dissolved_team_names,
                refugees, cost_stay, global_task_count,
            )
        )

    # ── Agent 间通信消息 ──────────────────────────────────────────────────────

    def agent_message(
        self,
        from_id: str,
        from_name: str,
        to_id: str,
        to_name: str,
        content: str,
        msg_type: str,
        ts: str,
    ) -> AgentMessageMsg:
        return {
            "type": "agent_message",
            "from_id": from_id,
            "from_name": from_name,
            "to_id": to_id,
            "to_name": to_name,
            "content": content[:200],
            "msg_type": msg_type,
            "ts": ts,
        }

    async def send_agent_message(
        self,
        from_id: str,
        from_name: str,
        to_id: str,
        to_name: str,
        content: str,
        msg_type: str,
        ts: str,
    ) -> None:
        await self.broadcast(
            self.agent_message(from_id, from_name, to_id, to_name, content, msg_type, ts)
        )

    # ── Agent 自主社会决策消息 ────────────────────────────────────────────────

    def agent_decision(
        self,
        agent_id: str,
        display_name: str,
        solo_preference: bool,
        evolution_focus: str,
        prev_evolution_focus: str,
        reason: str,
        ts: str,
    ) -> AgentDecisionMsg:
        return {
            "type": "agent_decision",
            "agent_id": agent_id,
            "display_name": display_name,
            "solo_preference": solo_preference,
            "evolution_focus": evolution_focus,
            "prev_evolution_focus": prev_evolution_focus,
            "reason": reason[:200],
            "ts": ts,
        }

    async def send_agent_decision(
        self,
        agent_id: str,
        display_name: str,
        solo_preference: bool,
        evolution_focus: str,
        prev_evolution_focus: str,
        reason: str,
        ts: str,
    ) -> None:
        await self.broadcast(
            self.agent_decision(
                agent_id, display_name, solo_preference,
                evolution_focus, prev_evolution_focus, reason, ts,
            )
        )

    def agent_last_stand(self, agent_id: str, display_name: str, balance: int) -> AgentLastStandMsg:
        return {"type": "agent_last_stand", "agent_id": agent_id, "display_name": display_name, "balance": balance}

    async def send_agent_last_stand(self, agent_id: str, display_name: str, balance: int) -> None:
        await self.broadcast(self.agent_last_stand(agent_id, display_name, balance))

    def subtitle_broadcast(self, text: str, level: str = "info") -> SubtitleBroadcastMsg:
        return {"type": "subtitle_broadcast", "text": text, "level": level}

    async def send_subtitle_broadcast(self, text: str, level: str = "info") -> None:
        await self.broadcast(self.subtitle_broadcast(text, level))

    def agent_defected(
        self,
        agent_id: str,
        display_name: str,
        old_team_id: str,
        old_team_name: str,
        new_team_id: str,
        new_team_name: str,
    ) -> AgentDefectedMsg:
        return {
            "type": "agent_defected",
            "agent_id": agent_id,
            "display_name": display_name,
            "old_team_id": old_team_id,
            "old_team_name": old_team_name,
            "new_team_id": new_team_id,
            "new_team_name": new_team_name,
        }

    async def send_agent_defected(
        self,
        agent_id: str,
        display_name: str,
        old_team_id: str,
        old_team_name: str,
        new_team_id: str,
        new_team_name: str,
    ) -> None:
        await self.broadcast(
            self.agent_defected(
                agent_id, display_name,
                old_team_id, old_team_name,
                new_team_id, new_team_name,
            )
        )

    def team_creed_generated(
        self,
        team_id: str,
        team_name: str,
        creed: str,
    ) -> TeamCreedGeneratedMsg:
        return {
            "type": "team_creed_generated",
            "team_id": team_id,
            "team_name": team_name,
            "creed": creed,
        }

    async def send_team_creed_generated(
        self,
        team_id: str,
        team_name: str,
        creed: str,
    ) -> None:
        await self.broadcast(self.team_creed_generated(team_id, team_name, creed))


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
