"""Evotown FastAPI 后端 — 进化竞技场入口"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.callbacks import (
    broadcast_evolution_event,
    broadcast_preview_and_assign,
    check_task_timeouts,
    get_idle_agents,
    on_agent_event,
    on_task_available,
    on_task_done,
    on_task_expired,
    on_task_taken,
)
from core import deps
from core.deps import arena, process_mgr, task_dispatcher
from core.config import load_economy_config
from domain.arena import AgentRecord
from infra.experiment import get_or_create_experiment_id
from infra.persistence import load_state
from api.routers import agents, config, dispatcher, monitor, tasks, websocket, replay
from log_watcher import start_watching

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("evotown.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    deps.experiment_id = get_or_create_experiment_id()

    # 启动 Replay 录制 session（以实验 ID 命名，重启后开新 session）
    from infra.replay import start_session as _start_replay
    _start_replay(deps.experiment_id)

    state = load_state(experiment_id=deps.experiment_id)
    arena.restore_counter(state.get("agent_counter", 0))
    arena.restore_task_counter(state.get("task_counter", 0))
    cfg = load_economy_config()
    loop = asyncio.get_event_loop()

    for a in state.get("agents", []):
        agent_id = a.get("id")
        if not agent_id:
            continue
        try:
            soul_type = a.get("soul_type", "balanced")
            agent_home, chat_root = await process_mgr.spawn(agent_id, None, soul_type=soul_type)
            observer = start_watching(chat_root, agent_id, broadcast_evolution_event, loop)
            # 优先使用持久化的展示名，否则重新分配
            display_name = a.get("display_name", "") or arena.assign_display_name()
            record = AgentRecord(
                agent_id=agent_id,
                agent_home=agent_home,
                chat_dir=chat_root,
                balance=a.get("balance", cfg["initial_balance"]),
                status=a.get("status", "active"),
                in_task=False,
                soul_type=a.get("soul_type", "balanced"),
                observer=observer,
                display_name=display_name,
            )
            arena.add_agent(record)
            logger.info("[%s] restored from disk (display_name=%s)", agent_id, display_name)
        except Exception as e:
            logger.warning("[%s] restore failed: %s", agent_id, e)

    if arena.agents:
        logger.info("Restored %d agents, counter=%d", len(arena.agents), arena.agent_counter)
        # 启动后立即持久化到 volume，确保 arena_state.json 保存在 /app/data/（挂载卷）
        arena.persist(experiment_id=deps.experiment_id)
        logger.info("Arena state persisted to data volume")

    # 记录初始状态快照到 replay，供回放时初始化 Phaser 场景中的 agent 精灵
    from infra.replay import get_recorder as _get_replay_recorder
    _replay_rec = _get_replay_recorder()
    if _replay_rec is not None:
        _snapshot_agents = [
            {
                "agent_id": a.agent_id,
                "display_name": a.display_name or a.agent_id,
                "balance": a.balance,
                "in_task": a.in_task,
            }
            for a in arena.agents.values()
        ]
        _replay_rec.record({"type": "state_snapshot", "agents": _snapshot_agents})
        logger.info("[replay] recorded initial state_snapshot with %d agents", len(_snapshot_agents))

    process_mgr.set_on_task_done(on_task_done)
    process_mgr.set_on_event(on_agent_event)
    task_dispatcher.configure(
        broadcast_assign_fn=broadcast_preview_and_assign,
        get_idle_agents=get_idle_agents,
        get_agent_difficulty_counts=arena.get_agent_difficulty_counts,
        on_task_available=on_task_available,
        on_task_taken=on_task_taken,
        on_task_expired=on_task_expired,
        interval=30.0,
    )

    async def _timeout_loop() -> None:
        try:
            while True:
                await asyncio.sleep(30)
                try:
                    await check_task_timeouts()
                except Exception as e:
                    logger.error("Task timeout check error: %s", e)
        except asyncio.CancelledError:
            pass

    _timeout_task = asyncio.create_task(_timeout_loop())

    yield

    _timeout_task.cancel()
    try:
        await _timeout_task
    except asyncio.CancelledError:
        pass
    from infra.replay import stop_session as _stop_replay
    _stop_replay()
    await task_dispatcher.stop()
    for aid in list(arena.agents.keys()):
        rec = arena.get_agent(aid)
        if rec and rec._observer:
            rec._observer.stop()
            rec._observer.join(timeout=2)
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

app.include_router(agents.router)
app.include_router(tasks.router)
app.include_router(config.router)
app.include_router(dispatcher.router)
app.include_router(monitor.router)
app.include_router(websocket.router)
app.include_router(replay.router)
# 兼容前端可能使用的 /api 前缀（解决 /config/experiment、/monitor/task_history 404）
app.include_router(config.router, prefix="/api")
app.include_router(monitor.router, prefix="/api")


@app.get("/health")
async def health():
    """健康检查，用于验证服务与路由是否正常"""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
