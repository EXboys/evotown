"""任务路由"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from domain.models import TaskInject, TaskBatch
from services import task_service

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("/inject")
async def inject_task(body: TaskInject):
    ok, err = await task_service.inject_task(body)
    if not ok:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": err or "inject failed"},
        )
    return {"ok": True}


@router.post("/batch")
async def batch_inject(body: TaskBatch):
    count, err = await task_service.batch_inject(body)
    if err and count == 0:
        return {"ok": False, "count": 0, "error": err}
    return {"ok": True, "count": count}
