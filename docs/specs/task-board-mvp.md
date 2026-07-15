# Task Board MVP — REQ-007

Closes the data-model gap between `dispatch_jobs` and `claude_agent_runs` with a unified Kanban view.

## Schema

SQLite database: `{EVOTOWN_DATA_DIR}/task_nodes.db`

```sql
CREATE TABLE task_nodes (
    node_id              TEXT PRIMARY KEY,
    agent_id             TEXT NOT NULL DEFAULT '',
    source_type          TEXT NOT NULL,          -- dispatch_job | hosted_run
    source_id            TEXT NOT NULL,
    title                TEXT NOT NULL DEFAULT '',
    message              TEXT NOT NULL DEFAULT '',
    board_status         TEXT NOT NULL,          -- queued | running | done | failed
    source_status        TEXT NOT NULL DEFAULT '',
    depends_on_node_id   TEXT NOT NULL DEFAULT '',
    sequence             INTEGER NOT NULL DEFAULT 0,
    run_id               TEXT NOT NULL DEFAULT '',
    dispatch_job_id      TEXT NOT NULL DEFAULT '',
    payload_json         TEXT NOT NULL DEFAULT '{}',
    refs_json            TEXT NOT NULL DEFAULT '{}',
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    completed_at         TEXT
);
```

Unique index on `(source_type, source_id)` prevents duplicate cards.

## Status mapping

| Source | Source status | Board column |
|--------|---------------|--------------|
| dispatch_job | queued, leased | queued |
| dispatch_job | running | running |
| dispatch_job | completed | done |
| dispatch_job | failed, cancelled | failed |
| hosted_run | queued | queued |
| hosted_run | running | running |
| hosted_run | succeeded | done |
| hosted_run | failed, cancelled | failed |

When a dispatch job has a linked `run_id`, board status follows the hosted run.

## Sync strategy

1. **Lazy sync on read** — `GET /api/v1/task-board` calls `task_nodes.sync_recent()` to upsert recent dispatch jobs and runs.
2. **Dedup** — Runs with `signals.dispatch_job_id` update the dispatch node instead of creating a second card.
3. **Dependencies** — `refs.parent_job_id` on dispatch jobs maps to `depends_on_node_id` for serial orchestration (display only in MVP).

## API

```
GET /api/v1/task-board?agent_id=<optional>&limit=10
```

Default `limit=10` returns the newest nodes across columns. Increase `limit` to expand.
Response includes `has_more` when older nodes exist.

```json
{
  "agent_id": "ws_abc",
  "columns": {
    "queued": [{ "agent_id": "...", "agent_name": "销售助手", "...": "..." }],
    "running": [...],
    "done": [...],
    "failed": [...]
  },
  "total": 8,
  "limit": 10,
  "has_more": true,
  "board_statuses": ["queued", "running", "done", "failed"]
}
```

Auth: `require_console_read`; non-admin users must have access to the requested agent.

## Frontend

Route: `/console/taskboard` — Kanban + 派活表单合一（Agent Center）。

- 顶部：选引擎 / 写任务 / 派发（原 `DispatchPanel` 能力）
- 下方：四列看板；订阅 `dispatch_job_updated` 刷新
- `/dispatch` 重定向到 `/console/taskboard`
- MVP 看板为 **只读列**（无拖拽改状态）

## Future work

- Push sync hooks on dispatch/run mutations (avoid full resync)
- WebSocket `task_node_updated` events
- Drag-and-drop status PATCH
- Serial trigger worker: enqueue next node when `depends_on_node_id` reaches `done`
