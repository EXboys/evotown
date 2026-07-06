"""System MCP: task_submit — submit a task to the task pool.

Agent calls:
    submit_task(title="知识库检索太慢", description="检索3秒才返回，需要优化", target_agent_id="ws_xxx")

Flow:
    1. Validate args
    2. Call infra/task_pool.create_task()
    3. Return task_id
"""

from __future__ import annotations

from typing import Any


def process(args: dict, permissions: dict) -> dict[str, Any]:
    title = (args.get("title", "") or "").strip()
    description = (args.get("description", "") or "").strip()
    target_agent_id = (args.get("target_agent_id", "") or "").strip() or None

    if not title:
        return {"ok": False, "data": None, "error": "title 不能为空"}
    if not description:
        return {"ok": False, "data": None, "error": "description 不能为空"}

    from infra import task_pool

    agent_id = permissions.get("agent_id", "")
    account = permissions.get("account", "")

    task = task_pool.create_task(
        title=title,
        description=description,
        submitter_type="agent",
        submitter_id=agent_id,
        source=task_pool.SOURCE_MCP,
        target_agent_id=target_agent_id,
    )

    return {
        "ok": True,
        "data": {
            "task_id": task.get("id", ""),
            "title": title,
            "message": f"任务 '{title}' 已提交到任务池",
        },
    }
