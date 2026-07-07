"""Fleet engine records for centrally hosted Coding Agent agents."""
from __future__ import annotations

from typing import Any

from domain.models import EngineRegister
from infra import engine_ingest, agents

HOSTED_ENGINE_PREFIX = "hosted-ws-"
HOSTED_ENGINE_VERSION = "evotown-hosted-1"


def engine_id_for_agent(agent_id: str) -> str:
    return f"{HOSTED_ENGINE_PREFIX}{agent_id}"


def agent_id_from_engine(engine_id: str) -> str | None:
    if not engine_id.startswith(HOSTED_ENGINE_PREFIX):
        return None
    agent_id = engine_id[len(HOSTED_ENGINE_PREFIX):]
    return agent_id or None


def is_hosted_engine(engine_id: str) -> bool:
    return bool(engine_id) and engine_id.startswith(HOSTED_ENGINE_PREFIX)


def register_agent_engine(agent: dict[str, Any]) -> dict[str, Any]:
    """Upsert a fleet engine row for a coding agent (no ingest token issued)."""
    agent_id = str(agent.get("agent_id") or "")
    if not agent_id:
        raise ValueError("agent_id is required")
    engine_id = engine_id_for_agent(agent_id)
    body = EngineRegister(
        engine_id=engine_id,
        engine_version=HOSTED_ENGINE_VERSION,
        engine_type="hosted_coding",
        display_name=str(agent.get("name") or engine_id),
        owner_team=str(agent.get("team_id") or ""),
        deployment_kind="container",
        capabilities={
            "hosted": True,
            "agent_id": agent_id,
            "agent_status": str(agent.get("status") or agents.AGENT_STATUS_ACTIVE),
        },
    )
    engine, _ = engine_ingest.upsert_engine(body, issue_token=False)
    return engine_ingest.get_engine(engine_id) or engine


def sync_agent_engine(agent: dict[str, Any] | None) -> dict[str, Any] | None:
    if agent is None:
        return None
    return register_agent_engine(agent)


def sync_all_active_agents(limit: int = 5000) -> int:
    """Register fleet engines for all active agents (startup / migration)."""
    count = 0
    for agent in agents.list_agents(status=agents.AGENT_STATUS_ACTIVE, limit=limit):
        register_agent_engine(agent)
        count += 1
    return count


def hosted_agent_available(engine_id: str) -> bool:
    agent_id = agent_id_from_engine(engine_id)
    if not agent_id:
        return False
    agent = agents.get_agent(agent_id)
    return agent is not None and agent.get("status") == agents.AGENT_STATUS_ACTIVE
