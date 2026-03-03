"""依赖容器 — 共享实例"""
from domain.arena import ArenaState, AgentRecord
from arena_monitor import ArenaMonitor
from process_manager import ProcessManager
from task_dispatcher import TaskDispatcher
from ws_dispatcher import ConnectionManager, WsDispatcher, WsIncomingDispatcher

arena = ArenaState()
manager = ConnectionManager()
ws = WsDispatcher(manager)
incoming_ws = WsIncomingDispatcher()
process_mgr = ProcessManager()
monitor = ArenaMonitor()
task_dispatcher = TaskDispatcher()

# 实验 ID，由 main lifespan 在启动时设置
experiment_id: str = ""
