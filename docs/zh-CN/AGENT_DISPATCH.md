# Agent 派活与协作（v1.0）

Evotown 通过 **任务队列 + 本机 Connector + Runtime Gateway** 实现：

- 控制中心向 OpenClaw / Hermes **派活**
- 局域网内 Agent **handoff / 协作**（经 Evotown 队列，不直连对方电脑）

## 架构

```text
控制台 / Agent A  →  POST /api/v1/jobs  →  Evotown 队列（SQLite）
                                              ↑
员工机 Connector  →  GET /api/v1/jobs/lease?timeout=25（长轮询）
                 →  ack + run.started
                 →  后台 POST 本机 OpenClaw /hooks/agent（触发，不单独算完成）
                 →  轮询 GET /runs/{run_id}/status 或 Agent 上报 run.completed
                 →  POST /jobs/{id}/complete（仅真实终态）
```

## 员工机部署（最终态）

```bash
# 1. 配置 ~/.config/evotown/evotown.agent.env
EVOTOWN_URL=https://evotown.company.internal
EVOTOWN_API_KEY=evk_...
EVOTOWN_ENGINE_ID=openclaw-alice
EVOTOWN_TEAM_ID=sales
OPENCLAW_HOOK_TOKEN=随机串        # 与 openclaw hooks.token 一致

# 2. IT 一次性 bootstrap（仅 register 用，可不进员工文件）
export EVOTOWN_INGEST_TOKEN=<服务器 .env 中 EVOTOWN_ENGINE_INGEST_TOKEN>

# 3. 注册并保存本机 evi_ token（只显示一次）
evotown-agent-setup.py register --save-token
# 写入 EVOTOWN_ENGINE_INGEST_TOKEN=evi_...

# 4. OpenClaw：合并 docs/templates/openclaw.evotown.yaml（含 hooks）

# 5. 常驻 Connector（必须用 evi_，不能用 IT bootstrap token）
evotown-agent-setup.py connector --poll 15 --long-poll 25

# 可选：Agent 跑完后自行结案（与 Connector 轮询二选一或并存）
evotown-agent-setup.py complete --job-id job_xxx --status succeeded --summary "done"
```

默认 **`EVOTOWN_DISPATCH_COMPLETION=poll_run`**：hook 在后台执行，Connector 等到 **run 终态**（ingest 事件）或 **hook 阻塞返回** 后才 `complete`；hook 仅返回 HTTP 2xx 不会立刻结案。

| 变量 | 默认 | 说明 |
|------|------|------|
| `EVOTOWN_DISPATCH_COMPLETION` | `poll_run` | `hook_only` = 仅等 hook（旧行为） |
| `EVOTOWN_DISPATCH_TIMEOUT` | `300` | 最长等待秒数 |
| `EVOTOWN_DISPATCH_POLL_SEC` | `5` | 轮询 run 状态间隔 |

### 两类 Token

| Token | 前缀 | 用途 |
|-------|------|------|
| IT bootstrap | 任意（env） | 仅 `engines/register`、管理员轮换 |
| Per-engine | `evi_` | 本机 connector / events / handoff（绑定 `engine_id`） |

员工机 **不能** 用 `evi_` 冒充其他 `engine_id` 发起 handoff。

Hermes：合并 `docs/templates/hermes.evotown.yaml` 中的 webhook 路由，设置 `HERMES_HOOK_URL`。

### Agent 主动 handoff（CLI）

```bash
evotown-agent-setup.py handoff \
  --to-team finance \
  --title "报销复核" \
  --message "请审核附件摘要：……"
```

## 控制台

- **`/dispatch`**：派发任务、Fleet 在线状态、任务详情、取消排队任务
- **`/engines`**：引擎卡片显示在线/离线

## API

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/v1/jobs` | Admin | 中心派活；`payload.on_success_handoff` 可链式交接 |
| POST | `/api/v1/jobs/from-engine` | Ingest | Agent→Agent / Agent→团队 |
| GET | `/api/v1/jobs/lease?engine_id=&timeout=` | Ingest | 领任务（`timeout`≤60 服务端长轮询） |
| GET | `/api/v1/runs/lease` | Ingest | 同上（兼容 ingest 规范） |
| POST | `/api/v1/jobs/{id}/ack` | Ingest | 开始执行 |
| POST | `/api/v1/jobs/{id}/complete` | Ingest | 完成；可返回 `follow_up_job` |
| GET | `/api/v1/runs/{run_id}/status?engine_id=` | `evi_` | Connector 轮询 run 终态 |
| POST | `/api/v1/jobs/{id}/cancel` | Admin | 取消 |
| POST | `/api/v1/engines/register` | Admin 或 IT bootstrap | 返回一次性 `ingest_token`（`evi_`） |
| POST | `/api/v1/engines/{id}/rotate-ingest-token` | Admin | 轮换 `evi_` |
| POST | `/api/v1/engines/{id}/heartbeat` | `evi_`（本机） | 在线心跳 |
| GET | `/api/v1/engines/fleet` | Admin | Fleet + `online` + `ingest_token_prefix` |

## 策略

环境变量 **`EVOTOWN_DISPATCH_TEAM_PAIRS`**（仅 `from-engine` handoff）：

- `*`（默认）：允许任意团队交接
- `sales:finance,it:finance`：仅允许列出的 `源团队:目标团队`

禁止 `source_engine_id` 与 `target_engine_id` 相同。

## 链式协作示例

中心派发时 payload：

```json
{
  "on_success_handoff": {
    "target_team_id": "finance",
    "title": "接续",
    "message": "请根据上一步结果完成复核"
  }
}
```

第一个 Agent 成功 `complete` 后，Evotown 自动创建子任务给 `finance` 团队队列。

## notify 任务

`kind=notify`：Connector **触发本机 hook 后立即** `complete`（不进入 `poll_run` 长等待）。适用于仅通知、无需等待 Agent 长任务的场景。

## 运维说明

- **leased** 超时 5 分钟自动回队列；**running** 超时 1 小时自动回队列
- Connector 循环错误不会退出进程（日志 `! connector loop error`）
- OpenClaw hook 阻塞返回或 Agent `complete` / `run.completed` 事件后写入 `result_summary`
- 遗留 `hook_only`：设置 `EVOTOWN_DISPATCH_COMPLETION=hook_only` 恢复「仅等 hook」语义
