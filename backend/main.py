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

from fastapi import FastAPI, HTTPException
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
from api.routers import (
    agents,
    accounts,
    agent_skills,
    agent_dispatch,
    audit,
    config,
    coding_agent,
    dispatcher,
    engine_ingest,
    gateway,
    gateway_models,
    gateway_routes,
    integrations,
    monitor,
    tasks,
    websocket,
    replay,
)
from api.routers import skill_market, skill_catalog, console_auth, market, knowledge, databases
from api.routers import policies, assets, mcp_services, agent_templates, mcp_bridge
from api.routers import teams
from api.routers import chronicle as chronicle_router
from api.routers import snapshot as snapshot_router
from api.routers import system_config as system_config_router
from infra import system_config as system_config_infra
from fastapi.responses import FileResponse
from log_watcher import start_watching

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("evotown.main")

from core.auth import admin_token_status, security_status  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    deps.experiment_id = get_or_create_experiment_id()

    # ── Initialize MCP registry (seeds system MCPs, runs migrations) ──
    from infra.mcp_registry import _ensure_conn
    _ensure_conn()
    logger.info("MCP registry initialized")

    # ── System config: sync DB → env on startup ──
    system_config_infra.sync_env_on_startup()
    logger.info("system_config env sync completed")

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
                evolution_division=a.get("evolution_division", "all"),
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
        # 兼容旧数据：老 agent 恢复时缺 evolution_division 已用 "all"，此处写回磁盘即完成升级
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

    # 注意：内存看门狗已移至 ProcessManager 内部，由 process_mgr.spawn() 自动启动
    # 如需停止，调用 await process_mgr.stop_memory_watchdog()

    async def _chronicle_loop() -> None:
        """每 CHRONICLE_INTERVAL_HOURS 小时（默认 5h）自动生成下一期运行日报。"""
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

    from infra import hosted_agent_engines
    from services.hosted_dispatch_worker import hosted_dispatch_loop

    try:
        synced = hosted_agent_engines.sync_all_active_agents()
        if synced:
            logger.info("[hosted-dispatch] synced %d active agent fleet engines", synced)
    except Exception as exc:
        logger.warning("[hosted-dispatch] agent fleet sync failed: %s", exc)

    _timeout_task = asyncio.create_task(_timeout_loop())
    _checkpoint_task = asyncio.create_task(_checkpoint_loop())
    _chronicle_task = asyncio.create_task(_chronicle_loop())
    _hosted_dispatch_task = asyncio.create_task(hosted_dispatch_loop())
    from services.claude_code_runner import stale_run_watchdog_loop
    from pathlib import Path as _P_import
    import os as _os_import

    _claude_watchdog_task = asyncio.create_task(stale_run_watchdog_loop())

    # Ensure shared MCP dev directory on startup
    from infra.agents import _copy_mcp_system_files
    _dev_dir = _P_import(_os_import.environ.get("EVOTOWN_MCP_DEV_DIR", "/app/data/mcp-dev"))
    _dev_dir.mkdir(parents=True, exist_ok=True)
    _copy_mcp_system_files(_dev_dir)
    # 注意：内存看门狗在 ProcessManager 内部自动启动（spawn 时调用 _start_memory_watchdog）

    yield

    _timeout_task.cancel()
    _checkpoint_task.cancel()
    _chronicle_task.cancel()
    _hosted_dispatch_task.cancel()
    _claude_watchdog_task.cancel()
    for _t in (_timeout_task, _checkpoint_task, _chronicle_task, _hosted_dispatch_task, _claude_watchdog_task):
        try:
            await _t
        except asyncio.CancelledError:
            pass
    # 停止内存看门狗
    await process_mgr.stop_memory_watchdog()
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

_sec = security_status()
logger.info("── Security ──────────────────────────────────────────")
logger.info("  ADMIN_TOKEN      : %s", _sec["admin_token"])
logger.info("  Engine ingest    : %s", _sec["engine_ingest_token"])
logger.info("  Legacy GW keys   : %s", _sec["legacy_gateway_keys"])
logger.info("  Dev GW+admin     : %s", _sec["dev_admin_as_gateway"])
logger.info("  Dev ingest fall. : %s", _sec["dev_ingest_fallback"])
if _sec["warnings"] != "none":
    logger.warning("  Security notes   : %s", _sec["warnings"])
_cors_warn = "*" in _cors_origins or (len(_cors_origins) == 1 and _cors_origins[0] == "*")
if _cors_warn:
    logger.warning("  CORS origins     : %s (set CORS_ORIGINS to explicit domains in production)", _cors_origins)
else:
    logger.info("  CORS origins     : %s", _cors_origins)
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
app.include_router(engine_ingest.router)
app.include_router(policies.router)
app.include_router(assets.router)
app.include_router(agent_dispatch.router)
app.include_router(audit.router)
app.include_router(coding_agent.router)
app.include_router(accounts.router)
app.include_router(agent_skills.router)
app.include_router(console_auth.router)
app.include_router(gateway.router)
app.include_router(gateway.anthropic_router)
app.include_router(gateway.anthropic_api_router)
app.include_router(gateway_routes.router)
app.include_router(gateway_models.router)
app.include_router(integrations.router)
app.include_router(skill_market.router)
app.include_router(skill_catalog.router)
app.include_router(market.router)
app.include_router(knowledge.router)
app.include_router(databases.router)
app.include_router(monitor.router)
app.include_router(websocket.router)
app.include_router(replay.router)
app.include_router(teams.router)
app.include_router(mcp_bridge.router)
app.include_router(mcp_services.router)
app.include_router(agent_templates.router)
app.include_router(chronicle_router.router)
app.include_router(snapshot_router.router)
app.include_router(system_config_router.router)
# 兼容前端可能使用的 /api 前缀（解决 /config/experiment、/monitor/task_history、/chronicle 404）
app.include_router(config.router, prefix="/api")
app.include_router(monitor.router, prefix="/api")
app.include_router(chronicle_router.router, prefix="/api")


@app.get("/health")
async def health():
    """健康检查，用于验证服务与路由是否正常"""
    return {"status": "ok"}


@app.get("/system/{filename:path}")
async def serve_system_file(filename: str):
    """Serve static system files (logo, etc.) directly by filename."""
    system_dir = system_config_infra.system_dir()
    file_path = system_dir / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(404, "File not found")
    # Prevent path traversal
    resolved = file_path.resolve()
    if not str(resolved).startswith(str(system_dir.resolve())):
        raise HTTPException(404, "File not found")
    return FileResponse(resolved)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
