# Agent 派活与协作（v1.0）

Evotown 通过 **任务队列 + 本机 Connector + Runtime Gateway** 实现：

- 控制中心向 OpenClaw / Hermes **派活**
- 局域网内 Agent **handoff / 协作**（经 Evotown 队列，不直连对方电脑）

## 架构

```text
控制台 / Agent A  →  POST /api/v1/jobs  →  Evotown 队列（SQLite）
                                              ↑
员工机 Connector  →  GET /api/v1/jobs/lease?timeout=25（长轮询）
                 →  POST 本机 OpenClaw /hooks/agent 或 Hermes webhook
                 →  POST /api/v1/events + /jobs/{id}/complete
```

## 员工机部署（最终态）

```bash
# 1. 配置 ~/.config/evotown/evotown.agent.env
EVOTOWN_URL=https://evotown.company.internal
EVOTOWN_API_KEY=evk_...
EVOTOWN_INGEST_TOKEN=...          # IT 下发
EVOTOWN_ENGINE_ID=openclaw-alice
EVOTOWN_TEAM_ID=sales
OPENCLAW_HOOK_TOKEN=随机串        # 与 openclaw hooks.token 一致

# 2. OpenClaw：合并 docs/templates/openclaw.evotown.yaml（含 hooks）

# 3. 注册 + 常驻 Connector
evotown-agent-setup.py register
evotown-agent-setup.py connector --poll 15 --long-poll 25
```

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
| POST | `/api/v1/jobs/{id}/cancel` | Admin | 取消 |
| POST | `/api/v1/engines/{id}/heartbeat` | Ingest | 在线心跳 |
| GET | `/api/v1/engines/fleet` | Admin | Fleet + `online` |

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

## 运维说明

- **leased** 超时 5 分钟自动回队列；**running** 超时 1 小时自动回队列
- Connector 循环错误不会退出进程（日志 `! connector loop error`）
- OpenClaw hook 响应体会写入 `result_summary`（截断 2000 字符）
