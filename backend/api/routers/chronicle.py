"""组织运行日报路由

POST /chronicle/generate          手动触发，生成下一期
POST /chronicle/{chapter}/regenerate  重新生成指定期次正文与标题
GET  /chronicle/                  列出所有已生成期次（倒序）
GET  /chronicle/current           当前最新期次信息
GET  /chronicle/{chapter}         按期次（整数）获取完整日报
"""
import os

from fastapi import APIRouter, Depends, HTTPException

from core.auth import require_admin
from core.deps import arena, ws
from services.chronicle import (
    current_chapter,
    generate_chronicle,
    list_chronicles,
    load_chronicle,
    regenerate_chronicle,
)

router = APIRouter(prefix="/chronicle", tags=["chronicle"], redirect_slashes=False)


@router.post("/generate", dependencies=[Depends(require_admin)])
async def api_generate_chronicle():
    """手动触发运行日报生成，自动取下一期序号。"""
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
    """列出所有已生成期次（倒序）。"""
    return list_chronicles()


@router.post("/{chapter}/regenerate", dependencies=[Depends(require_admin)])
async def api_regenerate_chronicle(chapter: int):
    """重新生成指定期次的日报正文与标题，从 task_history 实时拉取数据。"""
    async def _broadcast(data: dict) -> None:
        await ws.broadcast(data)

    period_hours = float(os.environ.get("CHRONICLE_INTERVAL_HOURS", "5"))
    agent_name_map = {aid: (rec.display_name or aid) for aid, rec in arena.agents.items()}

    record = await regenerate_chronicle(
        chapter_n=chapter,
        period_hours=period_hours,
        agent_name_map=agent_name_map,
        broadcast_fn=_broadcast,
    )
    if record is None:
        raise HTTPException(status_code=404, detail=f"Chronicle chapter {chapter} not found")
    return {
        "ok": True,
        "chapter": record["chapter"],
        "chapter_label": record["chapter_label"],
        "virtual_date": record["virtual_date"],
        "title": record.get("title", ""),
        "generated_at": record["generated_at"],
        "preview": (record.get("text") or "")[:300],
    }


@router.get("/current")
async def api_current_chapter():
    """返回当前最新期次（0 表示尚未生成任何日报）。"""
    return {"current_chapter": current_chapter()}


@router.get("/{chapter}")
async def api_get_chronicle(chapter: int):
    """获取指定期次的完整日报，不存在返回 404。"""
    data = load_chronicle(chapter)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Chronicle chapter {chapter} not found")
    return data
