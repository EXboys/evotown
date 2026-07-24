# Doctor 节点协议（v1）

Agent Doctor 作为本机 **AI 资源代理 / 执行面**：

1. WebSocket 实时在线 + inventory  
2. 接收 `job.assign`，用本机 Claude Code / Codex CLI 或 OpenClaw / Hermes hooks 执行  
3. 回传 `job.ack` / `job.event` / `job.complete`

Evotown 仍持有 **任务队列**（断线补领）；有 Doctor 在线时优先 **push**。

相关 Issue：[evotown#242](https://github.com/EXboys/evotown/issues/242) · [agent-doctor#37](https://github.com/EXboys/agent-doctor/issues/37)

## 职责

| 层 | 产品 | 职责 |
|----|------|------|
| 控制面 | Evotown | 账号、队列、Fleet、handoff、审计、`POST /jobs` |
| 本机代理 | Agent Doctor | 发现 runtime、WS、inventory、**执行 job** |
| Runtime | OpenClaw / Hermes / Claude Code / Codex | 实际跑任务 |

## 连接

```text
wss://<evotown>/api/v1/doctor/ws?token=<evi_>
```

## 消息

### Client → Server

| type | 说明 |
|------|------|
| `hello` | `engine_id`, `node_id`, `doctor_version`, `inventory` |
| `inventory` | 周期性资源快照 |
| `heartbeat` / `ping` / `pong` | 保活 |
| `job.ack` | `{ job_id }` 开始执行 |
| `job.event` | 进度（如 `started`） |
| `job.complete` | `{ job_id, status, exit_code, result_summary, log_excerpt, signals }` |

### Server → Client

| type | 说明 |
|------|------|
| `welcome` | `{ protocol_version: 1, engine_id, capabilities }` |
| `ack` | 对 hello/inventory/heartbeat/job.* 的确认 |
| `job.assign` | 见下 |
| `ping` / `error` | 心跳 / 错误 |

### `job.assign`

```json
{
  "type": "job.assign",
  "job": {
    "job_id": "job_…",
    "run_id": "job_…",
    "kind": "dispatch",
    "title": "…",
    "message": "用户任务正文",
    "payload": {
      "runtime": "claude-code",
      "cwd": "/path/to/project",
      "timeout_sec": 600,
      "dangerously_skip_permissions": false
    },
    "refs": {},
    "runtime": "claude-code",
    "cwd": "/path/to/project",
    "timeout_sec": 600,
    "lease_expires_at": "…"
  }
}
```

`payload.runtime`（或顶层 `runtime`）可选值：

| runtime | 执行方式 |
|---------|----------|
| `claude-code` | `claude -p … --output-format text` |
| `codex` | `codex exec …` |
| `openclaw` | `POST OPENCLAW_HOOK_URL` |
| `hermes` | `POST HERMES_HOOK_URL` |

未指定时：按 inventory 优先选已安装的 claude-code → codex → openclaw → hermes。

## 派活流程

```text
Admin POST /api/v1/jobs  (target_engine_id = 已注册 Doctor 引擎)
        ↓
  队列入库 status=queued
        ↓
  Doctor 在线？ → lease + WS job.assign
        ↓
  Doctor job.ack → running
        ↓
  CLI / hook 执行
        ↓
  Doctor job.complete → completed/failed
        ↓
  可选 on_success_handoff → 再 offer 给下一节点
```

Doctor 重连 `hello` 时会 **drain** 该引擎队列中最多 5 个 queued 任务。

## Fleet

- WS 存活：`online=true`，`online_meta.channel=doctor_ws`
- `GET /api/v1/doctor/nodes` 列出 live sessions

## 员工机

```bash
# env 需含 EVOTOWN_URL / EVOTOWN_ENGINE_ID / EVOTOWN_ENGINE_INGEST_TOKEN=evi_…
# OpenClaw 另需 OPENCLAW_HOOK_TOKEN；可选 EVOTOWN_RUNTIME=claude-code

agent-doctor connect
```

控制台向该 `engine_id` 派发：

```bash
curl -X POST "$EVOTOWN_URL/api/v1/jobs" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target_engine_id": "doctor-laptop-1",
    "title": "修一下 README",
    "message": "把安装步骤改成 agent-doctor connect",
    "payload": { "runtime": "claude-code", "cwd": "/Users/me/proj" }
  }'
```

## 与旧 connector

| | connector | Doctor WS |
|--|-----------|-----------|
| 在线 | HTTP heartbeat | WS 实时 |
| 领任务 | lease 长轮询 | push `job.assign` + reconnect drain |
| Claude/Codex | 无 | CLI |
| OpenClaw/Hermes | hooks | 同 hooks（经 Doctor） |

过渡期可并存；目标态只常驻 `agent-doctor connect`。
