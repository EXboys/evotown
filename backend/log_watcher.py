"""watchdog 监听 evolution.log，推送实时事件到 WebSocket"""
import asyncio
import json
from pathlib import Path
from typing import Callable, Awaitable

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent


class EvolutionLogHandler(FileSystemEventHandler):
    """evolution.log 文件追加时解析新行并回调"""

    def __init__(
        self,
        log_path: Path,
        agent_id: str,
        on_event: Callable[[dict], Awaitable[None]],
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        self.log_path = log_path
        self.agent_id = agent_id
        self.on_event = on_event
        self.loop = loop
        self._last_size = log_path.stat().st_size if log_path.exists() else 0

    def on_modified(self, event: FileModifiedEvent) -> None:
        if event.src_path != str(self.log_path):
            return
        if not self.log_path.exists():
            return
        try:
            with open(self.log_path, "r", encoding="utf-8") as f:
                f.seek(self._last_size)
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        data["agent_id"] = self.agent_id
                        data["event_type"] = data.get("type", "evolution")
                        data["type"] = "evolution_event"
                        asyncio.run_coroutine_threadsafe(
                            self.on_event(data), self.loop
                        )
                    except json.JSONDecodeError:
                        pass
                self._last_size = f.tell()
        except OSError:
            pass


def start_watching(
    chat_root: str,
    agent_id: str,
    on_event: Callable[[dict], Awaitable[None]],
    loop: asyncio.AbstractEventLoop,
) -> Observer:
    """启动 evolution.log 监听，返回 Observer 实例（需在 shutdown 时 stop）"""
    log_path = Path(chat_root) / "evolution.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    if not log_path.exists():
        log_path.touch()
    handler = EvolutionLogHandler(log_path, agent_id, on_event, loop)
    observer = Observer()
    observer.schedule(handler, str(log_path.parent), recursive=False)
    observer.start()
    return observer
