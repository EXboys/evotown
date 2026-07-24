"""Agent Doctor node WebSocket — presence, inventory, and job dispatch (protocol v1)."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status

from core.auth import require_admin
from domain.models import DispatchJobAck, DispatchJobComplete
from infra import agent_dispatch, doctor_nodes, engine_ingest
from infra.dispatch_notify import broadcast_dispatch_job

logger = logging.getLogger("evotown.doctor_ws")
router = APIRouter(tags=["doctor-node"])


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _extract_bearer(websocket: WebSocket) -> str | None:
    auth = websocket.headers.get("authorization") or websocket.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    token = websocket.query_params.get("token")
    if token:
        return token.strip()
    return None


@router.websocket("/api/v1/doctor/ws")
async def doctor_node_ws(websocket: WebSocket):
    raw = _extract_bearer(websocket)
    if not raw:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="missing bearer token")
        return
    engine_id = engine_ingest.lookup_engine_id_for_ingest_token(raw)
    if not engine_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="invalid evi_ token")
        return
    if engine_ingest.get_engine(engine_id) is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="engine not registered")
        return

    await websocket.accept()
    outbound: asyncio.Queue = asyncio.Queue()
    doctor_nodes.register_outbound(engine_id, outbound)
    doctor_nodes.connect_session(engine_id)
    try:
        await websocket.send_json(
            {
                "type": "welcome",
                "protocol_version": doctor_nodes.PROTOCOL_VERSION,
                "engine_id": engine_id,
                "server_time": _utc_now(),
                "capabilities": ["presence", "inventory", "job.assign"],
            }
        )
        recv_task = asyncio.create_task(websocket.receive_json())
        out_task = asyncio.create_task(outbound.get())
        try:
            while True:
                done, _pending = await asyncio.wait(
                    {recv_task, out_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if out_task in done:
                    message = out_task.result()
                    await websocket.send_json(message)
                    out_task = asyncio.create_task(outbound.get())
                if recv_task in done:
                    try:
                        raw_msg = recv_task.result()
                    except WebSocketDisconnect:
                        raise
                    if not isinstance(raw_msg, dict):
                        await websocket.send_json(
                            {"type": "error", "detail": "message must be a JSON object"}
                        )
                    else:
                        await _handle_client_message(websocket, engine_id, raw_msg)
                    recv_task = asyncio.create_task(websocket.receive_json())
        finally:
            for task in (recv_task, out_task):
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
    except WebSocketDisconnect:
        logger.info("doctor ws client disconnected engine_id=%s", engine_id)
    except Exception:
        logger.exception("doctor ws error engine_id=%s", engine_id)
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except Exception:
            pass
    finally:
        doctor_nodes.unregister_outbound(engine_id, outbound)
        doctor_nodes.disconnect_session(engine_id)


async def _handle_client_message(websocket: WebSocket, engine_id: str, msg: dict[str, Any]) -> None:
    msg_type = str(msg.get("type") or "")
    if msg_type == "hello":
        claimed = str(msg.get("engine_id") or "").strip()
        if claimed and claimed != engine_id:
            await websocket.send_json(
                {
                    "type": "error",
                    "detail": f"engine_id mismatch: token is for '{engine_id}'",
                }
            )
            return
        inventory = msg.get("inventory") if isinstance(msg.get("inventory"), dict) else {}
        doctor_nodes.touch_session(
            engine_id,
            inventory=inventory,
            doctor_version=str(msg.get("doctor_version") or ""),
            node_id=str(msg.get("node_id") or engine_id),
        )
        drained = doctor_nodes.drain_queued_jobs_to_doctor(engine_id)
        await websocket.send_json(
            {
                "type": "ack",
                "of": "hello",
                "engine_id": engine_id,
                "server_time": _utc_now(),
                "drained_jobs": drained,
            }
        )
        return

    if msg_type == "inventory":
        inventory = msg.get("inventory") if isinstance(msg.get("inventory"), dict) else {}
        doctor_nodes.touch_session(engine_id, inventory=inventory)
        await websocket.send_json({"type": "ack", "of": "inventory", "server_time": _utc_now()})
        return

    if msg_type == "heartbeat":
        doctor_nodes.touch_session(engine_id)
        await websocket.send_json({"type": "ack", "of": "heartbeat", "server_time": _utc_now()})
        return

    if msg_type == "pong":
        doctor_nodes.touch_session(engine_id)
        return

    if msg_type == "ping":
        await websocket.send_json({"type": "pong", "ts": msg.get("ts") or _utc_now()})
        doctor_nodes.touch_session(engine_id)
        return

    if msg_type == "job.ack":
        job_id = str(msg.get("job_id") or "").strip()
        if not job_id:
            await websocket.send_json({"type": "error", "detail": "job.ack requires job_id"})
            return
        job = agent_dispatch.ack_job(job_id, DispatchJobAck(engine_id=engine_id))
        if job is None:
            await websocket.send_json(
                {"type": "error", "detail": f"cannot ack job_id={job_id}", "job_id": job_id}
            )
            return
        broadcast_dispatch_job(job, action="acked")
        await websocket.send_json(
            {"type": "ack", "of": "job.ack", "job_id": job_id, "server_time": _utc_now()}
        )
        return

    if msg_type == "job.event":
        # Soft telemetry — store in online_meta-style signals only for now
        doctor_nodes.touch_session(engine_id)
        await websocket.send_json(
            {
                "type": "ack",
                "of": "job.event",
                "job_id": msg.get("job_id"),
                "server_time": _utc_now(),
            }
        )
        return

    if msg_type == "job.complete":
        job_id = str(msg.get("job_id") or "").strip()
        if not job_id:
            await websocket.send_json({"type": "error", "detail": "job.complete requires job_id"})
            return
        status_raw = str(msg.get("status") or "succeeded").strip()
        if status_raw not in {"succeeded", "failed", "cancelled"}:
            status_raw = "failed"
        body = DispatchJobComplete(
            engine_id=engine_id,
            status=status_raw,  # type: ignore[arg-type]
            exit_code=int(msg.get("exit_code") or (0 if status_raw == "succeeded" else 1)),
            log_excerpt=str(msg.get("log_excerpt") or "")[:65536],
            result_summary=str(msg.get("result_summary") or msg.get("summary") or "")[:8000],
            run_id=str(msg.get("run_id") or "") or None,
            signals=msg.get("signals") if isinstance(msg.get("signals"), dict) else {},
        )
        job, follow_up = agent_dispatch.complete_job(job_id, body)
        if job is None:
            await websocket.send_json(
                {"type": "error", "detail": f"cannot complete job_id={job_id}", "job_id": job_id}
            )
            return
        broadcast_dispatch_job(job, action="completed")
        if follow_up:
            broadcast_dispatch_job(follow_up, action="created")
            doctor_nodes.offer_job_to_doctor(follow_up)
        await websocket.send_json(
            {
                "type": "ack",
                "of": "job.complete",
                "job_id": job_id,
                "status": job.get("status"),
                "server_time": _utc_now(),
            }
        )
        return

    await websocket.send_json(
        {
            "type": "error",
            "detail": f"unknown type '{msg_type}' (protocol v{doctor_nodes.PROTOCOL_VERSION})",
        }
    )


@router.get("/api/v1/doctor/nodes", dependencies=[Depends(require_admin)])
async def list_doctor_nodes():
    """Live Doctor WS sessions (also reflected on /engines/fleet online_meta)."""
    return {
        "protocol_version": doctor_nodes.PROTOCOL_VERSION,
        "nodes": doctor_nodes.list_live_sessions(),
    }
