"""章回战报路由

POST /chronicle/generate          手动触发，生成下一回
GET  /chronicle/                  列出所有已生成章回（回数倒序）
GET  /chronicle/current           当前最新回数信息
GET  /chronicle/{chapter}         按回数（整数）获取完整战报
"""
import os

from fastapi import APIRouter, HTTPException

from core.deps import arena, ws
from services.chronicle import (
    current_chapter,
    generate_chronicle,
    list_chronicles,
    load_chronicle,
)

router = APIRouter(prefix="/chronicle", tags=["chronicle"], redirect_slashes=False)


@router.post("/generate")
async def api_generate_chronicle():
    """手动触发章回战报生成，自动取下一回序号，无需传日期。"""
    interval_hours = float(os.environ.get("CHRONICLE_INTERVAL_HOURS", "5"))
    agent_name_map = {aid: (rec.display_name or aid) for aid, rec in arena.agents.items()}

    async def _broadcast(data: dict) -> None:
        await ws.broadcast(data)

    record = await generate_chronicle(
        period_hours=interval_hours,
        agent_name_map=agent_name_map,
        broadcast_fn=_broadcast,
    )
    return {
        "ok": True,
        "chapter": record["chapter"],
        "chapter_label": record["chapter_label"],
        "virtual_date": record["virtual_date"],
        "title": record.get("title", ""),
        "generated_at": record["generated_at"],
        "preview": (record.get("text") or "")[:300],
    }


@router.get("")
async def api_list_chronicles():
    """列出所有已生成章回（回数倒序），含章回号、虚拟纪年、回目、生成时间、任务数、预览前100字。"""
    return list_chronicles()


@router.get("/current")
async def api_current_chapter():
    """返回当前最新章回号（0 表示尚未生成任何章回）。"""
    return {"current_chapter": current_chapter()}


@router.get("/{chapter}")
async def api_get_chronicle(chapter: int):
    """获取指定回数的完整战报，不存在返回 404。"""
    data = load_chronicle(chapter)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Chronicle chapter {chapter} not found")
    return data

