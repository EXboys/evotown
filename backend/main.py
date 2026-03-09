"""Evotown FastAPI 后端 — 进化竞技场入口"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

# 加载 .env 文件（本地开发时生效；Docker 生产环境由 docker-compose 注入）
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(dotenv_path=_env_path, override=True)  # override=True: evotown/.env 优先，避免 shell 旧 API_KEY 覆盖
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.callbacks import (
    broadcast_evolution_event,
    broadcast_preview_and_assign,
    check_task_timeouts,
    get_idle_agents,
    on_agent_event,
    on_process_exit,
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
from api.routers import teams
from api.routers import chronicle as chronicle_router
from api.routers import snapshot as snapshot_router
from log_watcher import start_watching

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("evotown.main")

from core.auth import admin_token_status  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    deps.experiment_id = get_or_create_experiment_id()

    # 启动 Replay 录制 session（以实验 ID 命名，重启后开新 session）
    from infra.replay import start_session as _start_replay
    _start_replay(deps.experiment_id)

    state = load_state(experiment_id=deps.experiment_id)
    arena.restore_counter(state.get("agent_counter", 0))
    arena.restore_task_counter(state.get("task_counter", 0))
    arena.restore_global_task_counter(state.get("global_task_counter", 0))
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
            # 优先使用持久化的展示名；若为空或与 agent_id 相同（英文备用名），重新分配三国武将名
            display_name_raw = a.get("display_name", "")
            display_name = (display_name_raw if (display_name_raw and display_name_raw != agent_id)
                            else arena.assign_display_name())
            record = AgentRecord(
                agent_id=agent_id,
                agent_home=agent_home,
                chat_dir=chat_root,
                balance=a.get("balance", cfg["initial_balance"]),
                status=a.get("status", "active"),
                in_task=False,
                soul_type=a.get("soul_type", "balanced"),
                display_name=display_name,
                solo_preference=a.get("solo_preference", False),
                evolution_focus=a.get("evolution_focus", ""),
                loyalty=a.get("loyalty", 100),
            )
            record._observer = observer
            arena.add_agent(record)
            logger.info("[%s] restored from disk (display_name=%s)", agent_id, display_name)
        except Exception as e:
            logger.warning("[%s] restore failed: %s", agent_id, e)

    if arena.agents:
        logger.info(
            "Restored %d agents, counter=%d, global_task_counter=%d",
            len(arena.agents), arena.agent_counter, arena.global_task_counter,
        )

        # ── 恢复队伍结构（从持久化的 teams 字段）────────────────────────────────
        saved_teams = state.get("teams", [])
        if saved_teams:
            arena.restore_teams(saved_teams)
            logger.info("Restored %d teams from disk", len(arena.list_teams()))
        else:
            logger.info("No saved teams found in state")

        # ── 自动结阵：若无队伍且 agent 数 >= 2，自动分成 2 队 ──────────────────
        if not arena.list_teams() and len(arena.agents) >= 2:
            try:
                teams = arena.assign_teams(2)
                logger.info(
                    "Auto-assigned %d agents into %d teams: %s",
                    len(arena.agents),
                    len(teams),
                    [t.name for t in teams],
                )
            except Exception as e:
                logger.warning("Auto team assignment failed: %s", e)

        # 启动后立即持久化（含队伍结构 + global_task_counter）
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
    process_mgr.set_on_process_exit(on_process_exit)
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

    async def _checkpoint_loop() -> None:
        """每 5 分钟将 ArenaState 持久化到磁盘，防止进程意外崩溃导致数据全丢"""
        interval = int(os.environ.get("CHECKPOINT_INTERVAL_SEC", "300"))  # 默认 5 分钟
        try:
            while True:
                await asyncio.sleep(interval)
                try:
                    arena.persist(experiment_id=deps.experiment_id)
                    logger.debug("[checkpoint] arena state saved (interval=%ds)", interval)
                except Exception as e:
                    logger.error("[checkpoint] persist failed: %s", e)
        except asyncio.CancelledError:
            pass

    async def _memory_watchdog() -> None:
        """每 5 分钟检查各 agent 子进程 RSS，超过 300 MB 时触发受控软重启。

        soft restart → _drain_stdout 快速路径（1 s 延迟，不计崩溃次数）→
        新进程从零开始，消除 LLM 消息列表无限增长问题。
        """
        try:
            import psutil as _psutil
        except ImportError:
            logger.warning("[watchdog] psutil not installed — memory watchdog disabled")
            return
        _MEM_THRESHOLD = int(os.environ.get("AGENT_MEM_THRESHOLD_MB", "300")) * 1024 * 1024
        _INTERVAL = int(os.environ.get("MEM_WATCHDOG_INTERVAL_SEC", "300"))
        logger.info("[watchdog] started (threshold=%d MB, interval=%ds)", _MEM_THRESHOLD // 1024 // 1024, _INTERVAL)
        try:
            while True:
                await asyncio.sleep(_INTERVAL)
                for aid, proc in list(process_mgr._processes.items()):
                    pid = getattr(proc, "pid", None)
                    if pid is None:
                        continue
                    try:
                        rss = _psutil.Process(pid).memory_info().rss
                        if rss > _MEM_THRESHOLD:
                            logger.warning(
                                "[watchdog] agent %s RSS=%.0f MB > %d MB — triggering soft restart",
                                aid, rss / 1024 / 1024, _MEM_THRESHOLD // 1024 // 1024,
                            )
                            await process_mgr._soft_restart_for_memory(aid)
                    except (_psutil.NoSuchProcess, _psutil.AccessDenied):
                        pass
                    except Exception as exc:
                        logger.error("[watchdog] error checking agent %s: %s", aid, exc)
        except asyncio.CancelledError:
            pass

    async def _chronicle_loop() -> None:
        """每 CHRONICLE_INTERVAL_HOURS 小时（默认 5h）自动生成下一回章回战报。"""
        from services.chronicle import generate_chronicle
        from core.deps import ws as _ws
        interval_hours = float(os.environ.get("CHRONICLE_INTERVAL_HOURS", "5"))
        interval_secs = interval_hours * 3600
        logger.info("[chronicle] loop started — interval=%.1fh", interval_hours)
        try:
            while True:
                await asyncio.sleep(interval_secs)
                try:
                    agent_name_map = {aid: (rec.display_name or aid) for aid, rec in arena.agents.items()}

                    async def _bcast(data: dict) -> None:
                        await _ws.broadcast(data)

                    await generate_chronicle(
                        period_hours=interval_hours,
                        agent_name_map=agent_name_map,
                        broadcast_fn=_bcast,
                    )
                except Exception as e:
                    logger.error("[chronicle] generation failed: %s", e)
        except asyncio.CancelledError:
            pass

    _timeout_task = asyncio.create_task(_timeout_loop())
    _checkpoint_task = asyncio.create_task(_checkpoint_loop())
    _chronicle_task = asyncio.create_task(_chronicle_loop())
    _watchdog_task = asyncio.create_task(_memory_watchdog())

    yield

    _timeout_task.cancel()
    _checkpoint_task.cancel()
    _chronicle_task.cancel()
    _watchdog_task.cancel()
    for _t in (_timeout_task, _checkpoint_task, _chronicle_task, _watchdog_task):
        try:
            await _t
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


_cors_origins_raw = os.environ.get("CORS_ORIGINS", "").strip()
_cors_origins: list[str] = (
    [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
    if _cors_origins_raw
    else ["*"]
)

logger.info("── Security ──────────────────────────────────────────")
logger.info("  ADMIN_TOKEN : %s", admin_token_status())
logger.info("  CORS origins: %s", _cors_origins)
logger.info("─────────────────────────────────────────────────────")

app = FastAPI(
    title="Evotown",
    description="进化测试实现 — 将进化引擎置于可控环境中做进化效果验证",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-Admin-Token"],
)

app.include_router(agents.router)
app.include_router(tasks.router)
app.include_router(config.router)
app.include_router(dispatcher.router)
app.include_router(monitor.router)
app.include_router(websocket.router)
app.include_router(replay.router)
app.include_router(teams.router)
app.include_router(chronicle_router.router)
app.include_router(snapshot_router.router)
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
