# Evotown — 进化测试实现

将 **进化引擎** 置于可控环境中做**进化效果验证** —— OpenClaw 系、Hermes、自研 harness，或 **可选地** [SkillLite](https://github.com/EXboys/skilllite)。Evotown **不绑定**某一上游；通过 [ingest API](../docs/zh-CN/EVOTOWN-ENGINE-INGEST-V0.1.md) 接入执行端即可。经济规则可调、可重现、全本地，**不依赖虚拟币/加密货币**。

[English](../en/README.md)

## 前置条件

- Python 3.10+
- Node.js 18+
- **技能工作区：** 后端期望项目树中含 `.skills` 或 `skills`（具体布局取决于你接入的 agent 后端）。
- **SkillLite（可选）：** 仅当你用 SkillLite CLI 驱动 agent 时需要 —— 此时会用到 `skilllite evolution run` / `skilllite agent-rpc` 及默认的每 agent 副本路径 `~/.skilllite/arena/{agent_id}/.skills`。其它引擎使用各自安装路径，并可通过 HTTP ingest 上报。

## 快速开始

### 方式 A — Docker（推荐）

需要 Docker Desktop（或 Docker Engine + Compose 插件）。

```bash
cd evotown

# 1. 从模板创建 .env（与 docker-compose.yml 同级）
cp .env.example .env
# 填写 API_KEY / BASE_URL / MODEL，并按需配置分通道（JUDGE、DISPATCHER、SOCIAL、CHRONICLE）

# 2. 首次：构建镜像并启动
docker compose up -d --build

# 之后启动（无需重建）
docker compose up -d

# 停止
docker compose down
```

访问 http://localhost — 落地页，再进入竞技场。

> **说明**：`.env` 须与 `docker-compose.yml` 同级；Compose 启动时会自动读取。

### 方式 B — 本地开发（两个终端）

```bash
# 终端 1 — 后端
cd evotown/backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8765

# 终端 2 — 前端
cd evotown/frontend
npm install
npm run dev
```

访问 http://localhost:5174

> **数据目录**：本地与 Docker 共用 `evotown/data/` 持久化竞技场状态、任务历史等；可通过 `EVOTOWN_DATA_DIR` 指定其他目录。

## 配置

将 `.env.example` 复制为 `.env`，至少填写主通道 `BASE_URL`、`API_KEY`、`MODEL`。可选分通道变量（`JUDGE_*`、`DISPATCHER_*`、`SOCIAL_*`、`CHRONICLE_*`）让高频流程走更省配额的模型，裁判与战报仍可用更强模型。Docker 也支持 `OPENAI_API_KEY` / `OPENAI_BASE_URL` 作为主通道别名。

外部引擎 ingest 使用 bearer 鉴权。为 OpenClaw / Hermes / custom runners 设置 `EVOTOWN_ENGINE_INGEST_TOKEN`；若未设置，后端会在本地单机开发中回退到 `ADMIN_TOKEN`。

中心化模型网关基于 LiteLLM。生产环境设置 `EVOTOWN_GATEWAY_API_KEYS`、`LITELLM_BASE_URL` 和 `LITELLM_MASTER_KEY` 后，子 agent 可使用 `OPENAI_BASE_URL=http://localhost:8765/api/gateway/v1` 和 Evotown gateway key 接入。

经济与进化相关项在 `backend/evotown_config.json`（示例见 `backend/evotown_config.json.example`）。

## 竞技场界面

| 路由 | 说明 |
|------|------|
| `/` | 落地页 |
| `/arena` | 主战场（Phaser 地图、观察面板、Agent 详情） |
| `/task-history` | 任务历史与裁判评分 |
| `/chronicle` | 进化演绎战报 |

前端以 WebSocket 推送实时状态；断线时 REST 约每 15 秒、已连接时约每 60 秒轮询 `/agents` 作兜底，避免地图与列表脱节。

观察面板的指标图会并行请求各 Agent 的 `/agents/{id}/metrics`，并在短时间内复用缓存，减轻 API 压力。

## 经济规则（丛林法则）

可配置，支持 `evotown_config.json` 或环境变量：

| 配置项 | 默认 | 环境变量 |
|--------|------|----------|
| initial_balance | 100 | EVOTOWN_INITIAL_BALANCE |
| cost_accept | -5 | EVOTOWN_COST_ACCEPT |
| reward_complete | 10 | EVOTOWN_REWARD_COMPLETE |
| penalty_fail | -5 | EVOTOWN_PENALTY_FAIL |
| eliminate_on_zero | true | EVOTOWN_ELIMINATE_ON_ZERO |

`GET /config/economy` 可查询当前配置。

## 目录结构

```
evotown/
├── backend/              # FastAPI 后端
├── frontend/             # React + Phaser 3 前端
├── data/                 # 默认持久化目录（可用 EVOTOWN_DATA_DIR 覆盖）
├── .env.example          # LLM 与竞技场环境变量模板
├── docker-compose.yml
├── docs/
│   ├── en/               # English docs
│   └── zh-CN/            # 中文文档
├── en/README.md
├── zh-CN/README.md
└── README.md
```

## Monorepo 说明

有些团队会把 Evotown 与其它项目放在同一个 monorepo checkout 中便于本地开发；**当前 GitHub 仓库是独立交付线**，使用 Evotown 不要求安装 SkillLite。

```bash
# 可选：从更大的 monorepo 中抽取子目录（仅示例）
git subtree split -P evotown -b evotown-main
```

## 关联文档

- [Evotown spec index](../spec/README.md) — 产品与工程决策源头
- [EVOTOWN-ENGINE-INGEST-V0.1.md](../docs/zh-CN/EVOTOWN-ENGINE-INGEST-V0.1.md) — 外部引擎接入 API
- [ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md](../docs/zh-CN/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md) — 企业控制面产品规划
- [REWARD_MECHANISM.md](../docs/zh-CN/REWARD_MECHANISM.md) — 奖励机制
- [AGENT_TASK_ACCEPTANCE_ANALYSIS.md](../docs/zh-CN/AGENT_TASK_ACCEPTANCE_ANALYSIS.md) — Agent 任务接受逻辑
- [EVOLUTION_MECHANISM_ANALYSIS.md](../docs/zh-CN/EVOLUTION_MECHANISM_ANALYSIS.md) — 进化机制分析
- [13-EVOLUTION-ARENA.md](../../todo/13-EVOLUTION-ARENA.md) — 完整设计
- [12-SELF-EVOLVING-ENGINE.md](../../todo/12-SELF-EVOLVING-ENGINE.md) — 进化引擎
