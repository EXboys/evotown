"""Replay 路由 — 列出/获取回放 session"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from infra.replay import list_sessions, load_session_events, start_session, stop_session, get_recorder

router = APIRouter(prefix="/replay", tags=["replay"])


@router.get("/sessions")
async def get_sessions():
    """列出所有录制的 replay session（按时间倒序）"""
    return list_sessions()


@router.get("/sessions/active")
async def get_active_session():
    """查询当前正在录制的 session（无则返回 null）"""
    rec = get_recorder()
    if rec is None:
        return {"active": False, "session_id": None}
    return {"active": True, "session_id": rec.session_id}


@router.get("/sessions/{session_id}")
async def get_session_events(session_id: str):
    """获取指定 session 的全部事件（含 replay_ts）"""
    events = load_session_events(session_id)
    if not events:
        # 可能 session_id 不存在
        sessions = {s["session_id"] for s in list_sessions()}
        if session_id not in sessions:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    return events


@router.post("/sessions/start")
async def api_start_session(session_id: str | None = None):
    """手动开始新录制 session（可选指定 session_id）"""
    recorder = start_session(session_id)
    return {"ok": True, "session_id": recorder.session_id}


@router.post("/sessions/stop")
async def api_stop_session():
    """手动停止当前录制 session"""
    rec = get_recorder()
    if rec is None:
        return {"ok": False, "detail": "no active session"}
    sid = rec.session_id
    stop_session()
    return {"ok": True, "session_id": sid}

