"""In-memory Agent Doctor WebSocket presence + outbound job push.

Connected Doctor nodes mark their engine online for Fleet and receive
``job.assign`` pushes when the control plane enqueues work for them.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from infra import agent_dispatch, engine_ingest

logger = logging.getLogger("evotown.doctor_nodes")

PROTOCOL_VERSION = 1


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class DoctorSession:
    engine_id: str
    doctor_version: str = ""
    node_id: str = ""
    connected_at: str = field(default_factory=_utc_now)
    last_seen_at: str = field(default_factory=_utc_now)
    inventory: dict[str, Any] = field(default_factory=dict)


_lock = threading.RLock()
_sessions: dict[str, DoctorSession] = {}
# engine_id → asyncio.Queue of outbound JSON dicts (bound to the WS event loop)
_outbound: dict[str, asyncio.Queue] = {}
_loop: asyncio.AbstractEventLoop | None = None


def set_event_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    global _loop
    _loop = loop


def is_doctor_ws_online(engine_id: str) -> bool:
    with _lock:
        return engine_id in _sessions


def get_session(engine_id: str) -> DoctorSession | None:
    with _lock:
        return _sessions.get(engine_id)


def list_live_sessions() -> list[dict[str, Any]]:
    with _lock:
        return [
            {
                "engine_id": s.engine_id,
                "node_id": s.node_id,
                "doctor_version": s.doctor_version,
                "connected_at": s.connected_at,
                "last_seen_at": s.last_seen_at,
                "inventory_summary": _inventory_summary(s.inventory),
            }
            for s in _sessions.values()
        ]


def _inventory_summary(inventory: dict[str, Any]) -> dict[str, Any]:
    runtimes = inventory.get("runtimes") or []
    installed = [
        {
            "id": r.get("id"),
            "installed": bool(r.get("installed")),
            "version": r.get("version"),
        }
        for r in runtimes
        if isinstance(r, dict)
    ]
    return {
        "runtime_count": len(installed),
        "installed": [r["id"] for r in installed if r.get("installed")],
        "runtimes": installed,
    }


def _meta_for(session: DoctorSession, *, connected: bool) -> dict[str, Any]:
    return {
        "channel": "doctor_ws",
        "doctor_ws_connected": connected,
        "doctor_version": session.doctor_version,
        "node_id": session.node_id,
        "protocol_version": PROTOCOL_VERSION,
        "inventory_summary": _inventory_summary(session.inventory),
        "connected_at": session.connected_at,
        "last_ws_at": session.last_seen_at,
        "capabilities": ["presence", "inventory", "job.assign"],
    }


def register_outbound(engine_id: str, queue: asyncio.Queue) -> None:
    with _lock:
        _outbound[engine_id] = queue
        try:
            set_event_loop(asyncio.get_running_loop())
        except RuntimeError:
            pass


def unregister_outbound(engine_id: str, queue: asyncio.Queue | None = None) -> None:
    with _lock:
        current = _outbound.get(engine_id)
        if queue is None or current is queue:
            _outbound.pop(engine_id, None)


def connect_session(
    engine_id: str,
    *,
    doctor_version: str = "",
    node_id: str = "",
    inventory: dict[str, Any] | None = None,
) -> DoctorSession:
    inv = inventory or {}
    session = DoctorSession(
        engine_id=engine_id,
        doctor_version=doctor_version,
        node_id=node_id or engine_id,
        inventory=inv,
    )
    with _lock:
        _sessions[engine_id] = session
    if engine_ingest.get_engine(engine_id) is not None:
        agent_dispatch.mark_engine_presence(
            engine_id,
            online=True,
            connector_version=f"doctor-ws/v{PROTOCOL_VERSION}",
            engine_version=doctor_version or None,
            meta=_meta_for(session, connected=True),
        )
    logger.info("doctor ws connected engine_id=%s node_id=%s", engine_id, session.node_id)
    return session


def touch_session(
    engine_id: str,
    *,
    inventory: dict[str, Any] | None = None,
    doctor_version: str | None = None,
    node_id: str | None = None,
) -> DoctorSession | None:
    with _lock:
        session = _sessions.get(engine_id)
        if session is None:
            return None
        session.last_seen_at = _utc_now()
        if inventory is not None:
            session.inventory = inventory
        if doctor_version is not None:
            session.doctor_version = doctor_version
        if node_id is not None:
            session.node_id = node_id
        snapshot = DoctorSession(
            engine_id=session.engine_id,
            doctor_version=session.doctor_version,
            node_id=session.node_id,
            connected_at=session.connected_at,
            last_seen_at=session.last_seen_at,
            inventory=dict(session.inventory),
        )
    if engine_ingest.get_engine(engine_id) is not None:
        agent_dispatch.mark_engine_presence(
            engine_id,
            online=True,
            connector_version=f"doctor-ws/v{PROTOCOL_VERSION}",
            engine_version=snapshot.doctor_version or None,
            meta=_meta_for(snapshot, connected=True),
        )
    return snapshot


def disconnect_session(engine_id: str) -> None:
    with _lock:
        session = _sessions.pop(engine_id, None)
        _outbound.pop(engine_id, None)
    if session is None:
        return
    session.last_seen_at = _utc_now()
    if engine_ingest.get_engine(engine_id) is not None:
        agent_dispatch.mark_engine_presence(
            engine_id,
            online=False,
            connector_version=f"doctor-ws/v{PROTOCOL_VERSION}",
            engine_version=session.doctor_version or None,
            meta=_meta_for(session, connected=False),
        )
    logger.info("doctor ws disconnected engine_id=%s", engine_id)


def job_assign_message(leased: dict[str, Any]) -> dict[str, Any]:
    payload = leased.get("payload") or {}
    runtime = (
        payload.get("runtime")
        or payload.get("runtime_hint")
        or payload.get("runtime_target")
        or ""
    )
    cwd = payload.get("cwd") or payload.get("workdir") or ""
    timeout_sec = payload.get("timeout_sec") or payload.get("timeout") or 600
    return {
        "type": "job.assign",
        "job": {
            "job_id": leased.get("job_id"),
            "run_id": leased.get("run_id") or leased.get("job_id"),
            "kind": leased.get("kind"),
            "title": leased.get("title") or "",
            "message": leased.get("message") or "",
            "payload": payload,
            "refs": leased.get("refs") or {},
            "source_engine_id": leased.get("source_engine_id") or "",
            "lease_expires_at": leased.get("lease_expires_at"),
            "runtime": runtime,
            "cwd": cwd,
            "timeout_sec": timeout_sec,
        },
        "server_time": _utc_now(),
    }


def enqueue_outbound(engine_id: str, message: dict[str, Any]) -> bool:
    """Put a message on the Doctor's outbound queue (thread-safe)."""
    with _lock:
        queue = _outbound.get(engine_id)
        loop = _loop
    if queue is None:
        return False
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is not None and running is loop:
        queue.put_nowait(message)
        return True
    if loop is not None and loop.is_running():
        loop.call_soon_threadsafe(queue.put_nowait, message)
        return True
    try:
        queue.put_nowait(message)
        return True
    except Exception:
        logger.exception("failed to enqueue outbound for %s", engine_id)
        return False


def offer_job_to_doctor(job: dict[str, Any]) -> dict[str, Any] | None:
    """If the target engine has a live Doctor WS, lease and push job.assign.

    Returns the leased job envelope on success, else None (caller keeps job queued
    for connector lease / later Doctor reconnect drain).
    """
    engine_id = (job.get("target_engine_id") or "").strip()
    if not engine_id:
        # Team-targeted: try each live doctor whose owner_team matches
        team = (job.get("target_team_id") or "").strip()
        if not team:
            return None
        with _lock:
            candidates = list(_sessions.keys())
        for eid in candidates:
            eng = engine_ingest.get_engine(eid)
            if eng and (eng.get("owner_team") or "") == team:
                engine_id = eid
                break
        if not engine_id:
            return None

    if not is_doctor_ws_online(engine_id):
        return None

    leased = agent_dispatch.lease_job_by_id(job["job_id"], engine_id)
    if leased is None:
        return None
    msg = job_assign_message(leased)
    if not enqueue_outbound(engine_id, msg):
        # Push failed — requeue so connector/Doctor can pick up later
        agent_dispatch.requeue_job(job["job_id"], reason="doctor_ws_push_failed")
        return None
    logger.info(
        "doctor job.assign pushed engine_id=%s job_id=%s",
        engine_id,
        leased.get("job_id"),
    )
    return leased


def drain_queued_jobs_to_doctor(engine_id: str, limit: int = 5) -> int:
    """On Doctor hello/reconnect, push up to ``limit`` queued jobs."""
    if not is_doctor_ws_online(engine_id):
        return 0
    sent = 0
    for _ in range(max(1, min(limit, 20))):
        leased = agent_dispatch.lease_job(engine_id)
        if leased is None:
            break
        if not enqueue_outbound(engine_id, job_assign_message(leased)):
            agent_dispatch.requeue_job(leased["job_id"], reason="doctor_ws_push_failed")
            break
        sent += 1
    return sent


def clear_all_sessions_for_tests() -> None:
    with _lock:
        _sessions.clear()
        _outbound.clear()
        global _loop
        _loop = None
