"""Evotown FastAPI 后端 — 进化竞技场"""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
import json
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("evotown.main")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from economy_config import load_economy_config
from models import AgentCreate, AgentInfo, TaskInject, TaskBatch
from process_manager import ProcessManager
from sqlite_reader import get_decisions, get_evolution_log, get_metrics, get_rules, get_skills
from log_watcher import start_watching
from arena_monitor import ArenaMonitor
from judge import judge_task
from task_dispatcher import TaskDispatcher


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
monitor = ArenaMonitor()
dispatcher = TaskDispatcher()

# 内存中的 Agent 状态（余额等）
agents: dict[str, dict] = {}
# agent_id → 当前任务描述（用于裁判评分）
_pending_tasks: dict[str, str] = {}


def _economy() -> dict:
    return load_economy_config()


def _on_agent_event(agent_id: str, event: str, data: dict) -> None:
    """事件流回调 — 转发给 monitor 跟踪"""
    monitor.process_event(agent_id, event, data)


async def _on_task_done(agent_id: str, success: bool, done_data: dict) -> None:
    """任务完成回调：监控 → 裁判评分 → 更新余额 → 广播"""
    if agent_id not in agents:
        return

    # 结束监控，获取完整执行上下文
    exe = monitor.end_task(agent_id)
    task_text = _pending_tasks.pop(agent_id, "")
    response = done_data.get("response", "")
    tool_total = exe.tool_total if exe else 0
    tool_failed = exe.tool_failed if exe else 0

    # LLM 裁判评分
    judge_result = await judge_task(task_text, response, tool_total, tool_failed)
    logger.info("[%s] judge: score=%d reward=%d reason=%s",
                agent_id, judge_result.total_score, judge_result.reward, judge_result.reason)

    # 用裁判的 reward 替代简单的 pass/fail
    cfg = _economy()
    reward = judge_result.reward
    agents[agent_id]["balance"] = agents[agent_id].get("balance", cfg["initial_balance"]) + reward
    agents[agent_id]["in_task"] = False

    await manager.broadcast({
        "type": "task_complete",
        "agent_id": agent_id,
        "success": judge_result.completion >= 5,
        "balance": agents[agent_id]["balance"],
        "judge": judge_result.to_dict(),
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


def _get_idle_agents() -> list[str]:
    """获取空闲 agent 列表（未在执行任务的 active agent）"""
    return [aid for aid, a in agents.items()
            if a.get("status") == "active" and not a.get("in_task")]


async def _dispatch_inject(agent_id: str, task: str) -> bool:
    """分发器注入任务的回调"""
    cfg = _economy()
    ok = await process_mgr.inject_task(agent_id, task)
    if ok and agent_id in agents:
        agents[agent_id]["balance"] = agents[agent_id].get("balance", cfg["initial_balance"]) + cfg["cost_accept"]
        agents[agent_id]["in_task"] = True
        _pending_tasks[agent_id] = task
        monitor.begin_task(agent_id, task)
        await manager.broadcast({
            "type": "sprite_move",
            "agent_id": agent_id,
            "from": "广场",
            "to": "任务中心",
            "reason": "auto_dispatch",
        })
    return ok


async def _on_dispatched(agent_id: str, task: str) -> None:
    """分发完成后的回调 — 广播事件给前端"""
    await manager.broadcast({
        "type": "task_dispatched",
        "agent_id": agent_id,
        "task": task[:200],
    })


@asynccontextmanager
async def lifespan(app: FastAPI):
    process_mgr.set_on_task_done(_on_task_done)
    process_mgr.set_on_event(_on_agent_event)
    dispatcher.configure(
        inject_fn=_dispatch_inject,
        get_idle_agents=_get_idle_agents,
        on_dispatched=_on_dispatched,
        interval=30.0,
    )
    yield
    await dispatcher.stop()
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
            in_task=a.get("in_task", False),
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
    await manager.broadcast({
        "type": "agent_created",
        "agent_id": agent_id,
        "balance": balance,
    })
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
    if not ok:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "agent not found or process dead"},
        )
    if body.agent_id in agents:
        agents[body.agent_id]["balance"] = agents[body.agent_id].get("balance", cfg["initial_balance"]) + cfg["cost_accept"]
        agents[body.agent_id]["in_task"] = True
        _pending_tasks[body.agent_id] = body.task
        monitor.begin_task(body.agent_id, body.task)
    await manager.broadcast({
        "type": "sprite_move",
        "agent_id": body.agent_id,
        "from": "广场",
        "to": "任务中心",
        "reason": "task",
    })
    return {"ok": True}


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
                agents[aid]["in_task"] = True
                _pending_tasks[aid] = task
                monitor.begin_task(aid, task)
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


@app.get("/agents/{agent_id}/evolution_log")
async def get_agent_evolution_log(agent_id: str, limit: int = 100):
    """evolution_log 表（进化时间线）"""
    if agent_id not in agents:
        return []
    rows = await get_evolution_log(agents[agent_id]["chat_dir"], limit)
    return list(reversed(rows))  # 时间正序


@app.get("/agents/{agent_id}/skills")
async def get_agent_skills(agent_id: str):
    """列出 _evolved 技能文件"""
    if agent_id not in agents:
        return []
    return await get_skills(agents[agent_id]["agent_home"])


# ── 分发器控制 ──────────────────────────────────────────────────────────────────

@app.post("/dispatcher/start")
async def start_dispatcher(interval: float = 30.0):
    """启动自动任务分发"""
    dispatcher._interval = interval
    await dispatcher.start()
    return {"ok": True, "interval": interval, "pool_size": dispatcher.pool_size}


@app.post("/dispatcher/stop")
async def stop_dispatcher():
    """停止自动任务分发"""
    await dispatcher.stop()
    return {"ok": True}


@app.get("/dispatcher/status")
async def dispatcher_status():
    """分发器状态"""
    return {
        "running": dispatcher.is_running,
        "pool_size": dispatcher.pool_size,
        "interval": dispatcher._interval,
    }


@app.post("/dispatcher/generate")
async def generate_tasks(count: int = 5):
    """手动触发 LLM 生成任务"""
    tasks = await dispatcher.generate_tasks(count)
    return {"ok": True, "generated": len(tasks), "tasks": tasks, "pool_size": dispatcher.pool_size}


# ── 监控 ────────────────────────────────────────────────────────────────────────

@app.get("/monitor/active")
async def monitor_active():
    """当前正在执行的任务"""
    return monitor.active_tasks


@app.get("/monitor/history")
async def monitor_history(limit: int = 50):
    """历史任务记录"""
    return monitor.history[-limit:]


@app.get("/monitor/stats")
async def monitor_stats():
    """竞技场统计"""
    return monitor.stats()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """实时事件流"""
    await manager.connect(ws)
    # 新客户端连接时，推送当前所有 agent 快照，防止刷新后错过事件
    if agents:
        snapshot = {
            "type": "state_snapshot",
            "agents": [
                {
                    "agent_id": aid,
                    "balance": a.get("balance", 100),
                    "in_task": a.get("in_task", False),
                }
                for aid, a in agents.items()
            ],
        }
        try:
            await ws.send_json(snapshot)
        except Exception:
            pass
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
