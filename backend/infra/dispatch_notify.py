"""Fire-and-forget WebSocket notifications for dispatch job changes."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger("evotown.dispatch")


def broadcast_dispatch_job(job: dict[str, Any], *, action: str = "updated") -> None:
    payload = {"type": "dispatch_job_updated", "action": action, "job": job}
    try:
        from core.deps import ws

        loop = asyncio.get_running_loop()
        loop.create_task(ws.broadcast(payload))
    except RuntimeError:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.debug("dispatch_job ws broadcast skipped: %s", exc)
