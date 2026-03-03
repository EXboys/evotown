"""WebSocket 路由"""
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.deps import arena, manager, ws, incoming_ws
from ws_messages import StateSnapshotAgent

logger = logging.getLogger("evotown.ws")
router = APIRouter(tags=["websocket"])


@router.websocket("/ws")
async def websocket_endpoint(ws_conn: WebSocket):
    await manager.connect(ws_conn)
    if arena.agents:
        snapshot_agents: list[StateSnapshotAgent] = [
            {"agent_id": rec.agent_id, "balance": rec.balance, "in_task": rec.in_task}
            for rec in arena.agents.values()
        ]
        try:
            await ws.send_state_snapshot(snapshot_agents)
        except Exception as e:
            logger.warning("Failed to send state_snapshot to new client: %s", e)
    try:
        while True:
            data = await ws_conn.receive_text()
            handled = await incoming_ws.dispatch(data)
            if not handled:
                try:
                    msg = json.loads(data)
                    if msg.get("type") == "ping":
                        await ws_conn.send_json(ws.pong())
                except json.JSONDecodeError:
                    pass
    except WebSocketDisconnect:
        manager.disconnect(ws_conn)
