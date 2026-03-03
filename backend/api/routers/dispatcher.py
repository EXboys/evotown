"""分发器路由"""
from fastapi import APIRouter

from core.deps import task_dispatcher

router = APIRouter(prefix="/dispatcher", tags=["dispatcher"])


@router.post("/start")
async def start_dispatcher(interval: float = 30.0):
    task_dispatcher._interval = interval
    await task_dispatcher.start()
    return {"ok": True, "interval": interval, "pool_size": task_dispatcher.pool_size}


@router.post("/stop")
async def stop_dispatcher():
    await task_dispatcher.stop()
    return {"ok": True}


@router.get("/status")
async def dispatcher_status():
    return {
        "running": task_dispatcher.is_running,
        "pool_size": task_dispatcher.pool_size,
        "interval": task_dispatcher._interval,
    }


@router.post("/generate")
async def generate_tasks(count: int = 5):
    tasks = await task_dispatcher.generate_tasks(count)
    return {"ok": True, "generated": len(tasks), "tasks": tasks, "pool_size": task_dispatcher.pool_size}
