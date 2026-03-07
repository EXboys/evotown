"""分享卡片路由 — Phase 0: Pillow /snapshot/card

GET /snapshot/card?agent_id=xxx   生成并返回武将战报 PNG 卡片
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from core.deps import arena
from infra.task_history import load_task_history
from services.snapshot import generate_card

router = APIRouter(prefix="/snapshot", tags=["snapshot"])


@router.get(
    "/card",
    response_class=Response,
    responses={
        200: {"content": {"image/png": {}}, "description": "武将战报 PNG 卡片"},
        404: {"description": "agent not found"},
    },
)
async def get_snapshot_card(agent_id: str = Query(..., description="Agent ID")):
    """生成指定 agent 的三国武将战报分享卡片（PNG），可直接下载或嵌入分享链接。"""
    rec = arena.get_agent(agent_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    # ── 从任务历史统计告捷/兵败数 ───────────────────────────────────────────
    history = load_task_history(agent_id=agent_id, outcome="claimed", limit=10000)
    completed = sum(1 for r in history if r.get("success") is True)
    failed    = sum(1 for r in history if r.get("success") is False)

    # ── 查找队伍名 ──────────────────────────────────────────────────────────
    team_name = ""
    if rec.team_id:
        team = arena.get_team(rec.team_id)
        if team:
            team_name = team.name

    agent_data = {
        "agent_id":        agent_id,
        "display_name":    rec.display_name or agent_id,
        "balance":         rec.balance,
        "soul_type":       rec.soul_type,
        "evolution_focus": getattr(rec, "evolution_focus", ""),
        "team_name":       team_name,
        "completed":       completed,
        "failed":          failed,
    }

    png_bytes = generate_card(agent_data)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Content-Disposition": f'attachment; filename="card_{agent_id}.png"',
            "Cache-Control": "no-cache",
        },
    )

