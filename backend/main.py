"""Evotown FastAPI 后端 — 进化测试实现"""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
import json

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from economy_config import load_economy_config
from models import AgentCreate, AgentInfo, TaskInject, TaskBatch
from process_manager import ProcessManager
from sqlite_reader import get_decisions, get_metrics, get_rules
from log_watcher import start_watching


# WebSocket 连接池
class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict) -> None:
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                pass


manager = ConnectionManager()
process_mgr = ProcessManager()

# 内存中的 Agent 状态（余额等）
agents: dict[str, dict] = {}


def _economy() -> dict:
    return load_economy_config()


async def _on_task_done(agent_id: str, success: bool) -> None:
    """任务完成回调：更新余额，余额≤0 则淘汰"""
    if agent_id not in agents:
        return
    cfg = _economy()
    reward = cfg["reward_complete"] if success else cfg["penalty_fail"]
    agents[agent_id]["balance"] = agents[agent_id].get("balance", cfg["initial_balance"]) + reward
    await manager.broadcast({
        "type": "task_complete",
        "agent_id": agent_id,
        "success": success,
        "balance": agents[agent_id]["balance"],
    })
    if cfg["eliminate_on_zero"] and agents[agent_id]["balance"] <= 0:
        a = agents.pop(agent_id, None)
        if a and (obs := a.get("_observer")):
            obs.stop()
            await asyncio.to_thread(obs.join, 2)
        await process_mgr.kill(agent_id)
        await manager.broadcast({
            "type": "agent_eliminated",
            "agent_id": agent_id,
            "reason": "balance_zero",
        })


@asynccontextmanager
async def lifespan(app: FastAPI):
    process_mgr.set_on_task_done(_on_task_done)
    yield
    for aid in list(agents.keys()):
        obs = agents.get(aid, {}).get("_observer")
        if obs:
            obs.stop()
            obs.join(timeout=2)
        await process_mgr.kill(aid)


app = FastAPI(
    title="Evotown",
    description="进化测试实现 — 将进化引擎置于可控环境中做进化效果验证",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/agents")
async def list_agents():
    """列出所有角色实例及状态"""
    return [
        AgentInfo(
            id=aid,
            chat_dir=a.get("chat_dir", ""),
            balance=a.get("balance", 100),
            status=a.get("status", "active"),
        )
        for aid, a in agents.items()
    ]


async def _broadcast_evolution_event(data: dict) -> None:
    """evolution.log 事件 → WS 广播"""
    await manager.broadcast({"type": "evolution_event", **data})


@app.post("/agents")
async def create_agent(body: AgentCreate):
    """创建新角色实例"""
    cfg = _economy()
    agent_id = f"agent_{len(agents) + 1}"
    agent_home, chat_root = await process_mgr.spawn(agent_id, body.chat_dir)
    loop = asyncio.get_event_loop()
    observer = start_watching(chat_root, agent_id, _broadcast_evolution_event, loop)
    balance = cfg["initial_balance"]
    agents[agent_id] = {
        "agent_home": agent_home,
        "chat_dir": chat_root,
        "balance": balance,
        "status": "active",
        "_observer": observer,
    }
    return AgentInfo(id=agent_id, chat_dir=chat_root, balance=balance, status="active")


@app.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """停止并清理角色实例"""
    a = agents.pop(agent_id, None)
    if a and (obs := a.get("_observer")):
        obs.stop()
        obs.join(timeout=2)
    await process_mgr.kill(agent_id)
    return {"ok": True}


@app.post("/tasks/inject")
async def inject_task(body: TaskInject):
    """向单个角色注入任务"""
    cfg = _economy()
    ok = await process_mgr.inject_task(body.agent_id, body.task)
    if ok and body.agent_id in agents:
        agents[body.agent_id]["balance"] = agents[body.agent_id].get("balance", cfg["initial_balance"]) + cfg["cost_accept"]
    await manager.broadcast({
        "type": "sprite_move",
        "agent_id": body.agent_id,
        "from": "广场",
        "to": "任务中心",
        "reason": "task",
    })
    return {"ok": ok}


@app.post("/tasks/batch")
async def batch_inject(body: TaskBatch):
    """批量注入任务"""
    cfg = _economy()
    target_ids = (
        [body.agent_id] if body.agent_id in agents else []
    ) if body.agent_id != "all" else list(agents.keys())
    if not target_ids:
        return {"ok": False, "count": 0, "error": "no agents"}
    injected = 0
    for task in body.tasks:
        for aid in target_ids:
            if await process_mgr.inject_task(aid, task):
                injected += 1
                agents[aid]["balance"] = agents[aid].get("balance", cfg["initial_balance"]) + cfg["cost_accept"]
                await manager.broadcast({
                    "type": "sprite_move",
                    "agent_id": aid,
                    "from": "广场",
                    "to": "任务中心",
                    "reason": "task",
                })
    return {"ok": True, "count": injected}


@app.post("/agents/{agent_id}/evolve")
async def trigger_evolve(agent_id: str):
    """主动触发进化"""
    if agent_id not in agents:
        return {"ok": False, "error": "agent not found"}
    agent_home = agents[agent_id].get("agent_home", agents[agent_id]["chat_dir"])
    ok = await process_mgr.trigger_evolve(agent_id, agent_home)
    await manager.broadcast({
        "type": "sprite_move",
        "agent_id": agent_id,
        "from": "广场",
        "to": "进化神殿",
        "reason": "forced_evolution",
    })
    return {"ok": ok}


@app.get("/agents/{agent_id}/metrics")
async def get_agent_metrics(agent_id: str, limit: int = 100):
    """查询 evolution_metrics 表（EGL 曲线）"""
    if agent_id not in agents:
        return []
    return await get_metrics(agents[agent_id]["chat_dir"], limit)


@app.get("/agents/{agent_id}/decisions")
async def get_agent_decisions(agent_id: str, limit: int = 50):
    """最近 N 条 decisions 记录"""
    if agent_id not in agents:
        return []
    return await get_decisions(agents[agent_id]["chat_dir"], limit)


@app.get("/config/economy")
async def get_economy_config():
    """获取当前经济规则配置"""
    return _economy()


@app.get("/agents/{agent_id}/rules")
async def get_agent_rules(agent_id: str):
    """读取 rules.json（规则热力图数据）"""
    if agent_id not in agents:
        return []
    return await get_rules(agents[agent_id]["chat_dir"])


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """实时事件流"""
    await manager.connect(ws)
    try:
        while True:
            data = await ws.receive_text()
            # 可支持客户端发来的控制消息
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await ws.send_json({"type": "pong", "ts": datetime.now().isoformat()})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
