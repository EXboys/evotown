"""WebSocket 路由"""
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.deps import arena, manager, task_dispatcher, ws, incoming_ws
from ws_messages import StateSnapshotAgent

logger = logging.getLogger("evotown.ws")
router = APIRouter(tags=["websocket"])


@router.websocket("/ws")
async def websocket_endpoint(ws_conn: WebSocket):
    await manager.connect(ws_conn)
    # 新连接必须直接发送 state_snapshot，确保客户端收到 agent 列表（broadcast 可能有时序问题）
    snapshot_agents: list[StateSnapshotAgent] = [
        {"agent_id": rec.agent_id, "balance": rec.balance, "in_task": rec.in_task}
        for rec in arena.agents.values()
    ]
    try:
        await ws_conn.send_json(ws.state_snapshot(snapshot_agents))
    except Exception as e:
        logger.warning("Failed to send state_snapshot to new client: %s", e)
    for t in task_dispatcher.get_available_tasks():
        try:
            await ws_conn.send_json(
                ws.task_available(
                    t["task_id"], t["task"], t["difficulty"], t["created_at"]
                )
            )
        except Exception as e:
            logger.warning("Failed to send task_available to new client: %s", e)
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
