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
    """停止任务分发。已接任务的 agent 会继续执行直至完成，仅停止向任务板添加新任务。"""
    await task_dispatcher.stop()
    return {"ok": True, "message": "分发已停止，进行中的任务将继续完成"}


@router.get("/status")
async def dispatcher_status():
    from task_dispatcher import MAX_AVAILABLE_TASKS  # noqa: PLC0415
    return {
        "running": task_dispatcher.is_running,
        "pool_size": task_dispatcher.pool_size,
        "available_tasks_count": len(task_dispatcher._available_tasks),
        "max_available_tasks": MAX_AVAILABLE_TASKS,
        "interval": task_dispatcher._interval,
    }


@router.post("/generate")
async def generate_tasks(count: int = 5):
    tasks = await task_dispatcher.generate_tasks(count)
    return {"ok": True, "generated": len(tasks), "tasks": tasks, "pool_size": task_dispatcher.pool_size}
