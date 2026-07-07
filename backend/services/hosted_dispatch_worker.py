"""Background worker: dispatch queue → hosted Coding Agent agent runs."""
from __future__ import annotations

import asyncio
import logging
import os

from domain.models import DispatchJobAck, DispatchJobComplete
from infra import agent_dispatch, claude_agent_runs, hosted_agent_engines, agents
from infra.dispatch_notify import broadcast_dispatch_job
from services import claude_code_runner

logger = logging.getLogger("evotown.hosted_dispatch")


def _poll_interval_sec() -> float:
    raw = os.environ.get("EVOTOWN_HOSTED_DISPATCH_POLL_SEC", "2").strip()
    try:
        return max(0.5, float(raw))
    except ValueError:
        return 2.0


def _max_active_runs_per_account() -> int:
    raw = os.environ.get("EVOTOWN_CLAUDE_MAX_ACTIVE_RUNS_PER_ACCOUNT", "2").strip()
    try:
        return int(raw)
    except ValueError:
        return 2


async def process_next_hosted_job() -> bool:
    """Process one hosted dispatch job if queued. Returns True when a job was handled."""
    job = agent_dispatch.claim_next_hosted_job()
    if job is None:
        return False

    job_id = job["job_id"]
    engine_id = job["target_engine_id"]
    agent_id = hosted_agent_engines.agent_id_from_engine(engine_id)
    if not agent_id:
        agent_dispatch.fail_job(job_id, summary="invalid hosted engine id")
        return True

    agent = agents.get_agent(agent_id)
    if agent is None or agent.get("status") != agents.AGENT_STATUS_ACTIVE:
        failed = agent_dispatch.fail_job(job_id, summary="hosted agent is not available")
        if failed:
            broadcast_dispatch_job(failed, action="completed")
        return True

    acked = agent_dispatch.ack_job(job_id, DispatchJobAck(engine_id=engine_id))
    if acked:
        broadcast_dispatch_job(acked, action="acked")

    account_id = str(agents.get_agent_owner(agent_id) or "")
    max_active = _max_active_runs_per_account()
    if max_active > 0 and claude_agent_runs.active_run_count(account_id) >= max_active:
        failed = agent_dispatch.fail_job(job_id, summary="too many active hosted agent runs for agent owner")
        if failed:
            broadcast_dispatch_job(failed, action="completed")
        return True

    payload = job.get("payload") or {}
    if not isinstance(payload, dict):
        payload = {}
    model = claude_code_runner.resolve_run_model(str(payload.get("model") or ""))
    skills = list(payload.get("skills") or [])
    mcp = list(payload.get("mcp") or [])

    run = claude_agent_runs.create_run(
        agent_id=agent_id,
        account_id=account_id,
        prompt=job["message"],
        tenant_id=str(agent.get("tenant_id") or ""),
        team_id=str(agent.get("team_id") or ""),
        model=model,
        signals={
            "agent_name": agent.get("name", ""),
            "dispatch_job_id": job_id,
            "dispatch_title": job.get("title", ""),
            "selected_skills": skills,
            "selected_mcp": mcp,
            "source": "dispatch",
        },
    )

    try:
        updated = await claude_code_runner.run_claude_agent(run["run_id"])
    except Exception as exc:
        logger.exception("hosted dispatch run failed: job_id=%s run_id=%s", job_id, run["run_id"])
        completed, follow_up = agent_dispatch.complete_job(
            job_id,
            DispatchJobComplete(
                engine_id=engine_id,
                status="failed",
                exit_code=1,
                log_excerpt=str(exc),
                result_summary=f"hosted dispatch failed: {exc}",
                run_id=run["run_id"],
            ),
        )
        if completed:
            broadcast_dispatch_job(completed, action="completed")
        if follow_up:
            broadcast_dispatch_job(follow_up, action="created")
        return True

    terminal = "succeeded" if updated.get("status") == "succeeded" else "failed"
    completed, follow_up = agent_dispatch.complete_job(
        job_id,
        DispatchJobComplete(
            engine_id=engine_id,
            status=terminal,
            exit_code=0 if terminal == "succeeded" else 1,
            log_excerpt=str(updated.get("log_excerpt") or ""),
            result_summary=str(updated.get("result_summary") or ""),
            run_id=run["run_id"],
        ),
    )
    if completed:
        broadcast_dispatch_job(completed, action="completed")
    if follow_up:
        broadcast_dispatch_job(follow_up, action="created")
    return True


async def hosted_dispatch_loop() -> None:
    interval = _poll_interval_sec()
    logger.info("[hosted-dispatch] worker started — poll_interval=%.1fs", interval)
    try:
        while True:
            try:
                handled = await process_next_hosted_job()
                if not handled:
                    await asyncio.sleep(interval)
            except Exception as exc:
                logger.exception("[hosted-dispatch] loop error: %s", exc)
                await asyncio.sleep(interval)
    except asyncio.CancelledError:
        pass
