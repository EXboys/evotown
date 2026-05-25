# Evotown — 企业 Agent 运行治理与能力资产中台

**Evotown 是企业 Agent 的运行治理与能力资产中台** —— 统一接入多种 Agent runtime，沉淀 Skills 与企业知识，提供观测、审核与私有分发。

执行端仍留在原处（员工笔记本、CI、服务器、容器）；Evotown 是其上层的 **控制面**，不是 IM 套件，也不是面向全员的聊天助手。项目同时包含 **进化竞技场（Arena）**，用于 benchmark、团队学习与可复现实验。

[English](../en/README.md)

## Evotown 是什么

| 层级 | 职责 |
|------|------|
| **Runtime** | OpenClaw / Hermes / SkillLite / 自研 Agent 本地执行 |
| **Evotown（本仓库）** | 引擎注册、Runs、成本/风控；私有 Skills 市场；知识 Connector + Native KB；控制台账号 |
| **业务应用** | 钉钉/飞书 Bot、内部 Copilot、CRM Agent —— 通过 API 消费 skill 与知识 |

**原则：** runtime 中立 · 证据驱动资产晋升 · 可私有化部署 · 控制而不锁定

## 平台入口（MVP）

| 路由 | 说明 |
|------|------|
| `/` | 企业风落地页 |
| `/login` | 控制台注册 / 登录（`evk_` API Key） |
| `/dashboard` … `/risk` | 企业管理后台 |
| `/market` | Skills 市场前台（目录 + 安装指引） |
| `/skills` | 管理端：上传、审核、下线 |
| `/knowledge` | 知识库：飞书/语雀 Connector、Native 目录树、分块检索 |
| `/arena` | 进化竞技场 |
| `/task-history` | 任务历史 |
| `/chronicle` | 组织学习日志 |

规格文档：[spec/README.md](../spec/README.md) · [企业控制面](../spec/enterprise-control-plane.md) · [知识 Connector](../spec/knowledge-connector.md) · [Skills 市场](../spec/skills-market-and-connectors.md)

---

## 进化测试（原有能力）

将 **进化引擎** 置于可控环境中做**进化效果验证** —— OpenClaw 系、Hermes、自研 harness，或 **可选地** [SkillLite](https://github.com/EXboys/skilllite)。Evotown **不绑定**某一上游；通过 [ingest API](../docs/zh-CN/EVOTOWN-ENGINE-INGEST-V0.1.md) 接入执行端即可。经济规则可调、可重现、全本地，**不依赖虚拟币/加密货币**。

## 前置条件

- Python 3.10+
- Node.js 18+
- **技能工作区：** 后端期望项目树中含 `.skills` 或 `skills`（具体布局取决于你接入的 agent 后端）。
- **SkillLite（可选）：** 仅当你用 SkillLite CLI 驱动 agent 时需要。

## 快速开始

### 方式 A — Docker（推荐）

```bash
cd evotown
cp .env.example .env
docker compose up -d --build
```

访问 http://localhost — 可从导航进入控制台、Skills 市场或 Arena。

### 方式 B — 本地开发

```bash
# 终端 1 — 后端
cd evotown/backend && pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8765

# 终端 2 — 前端
cd evotown/frontend && npm install && npm run dev
```

访问 http://localhost:5174

> 数据目录：`evotown/data/`（可用 `EVOTOWN_DATA_DIR` 覆盖）

## 配置要点

- **引擎 ingest：** `EVOTOWN_ENGINE_INGEST_TOKEN`（OpenClaw / Hermes / custom）
- **控制台：** `/login` 注册 `evk_` key，或配置 `ADMIN_TOKEN`
- **Skills 私有化部署：** [PRIVATE_SKILLS_MARKET_DEPLOYMENT.md](../docs/zh-CN/PRIVATE_SKILLS_MARKET_DEPLOYMENT.md)
- **模型网关：** LiteLLM + `OPENAI_BASE_URL=http://localhost:8765/api/gateway/v1`

## 关联文档

- [Evotown spec index](../spec/README.md)
- [引擎接入 API](../docs/zh-CN/EVOTOWN-ENGINE-INGEST-V0.1.md)
- [企业控制面产品规格](../docs/zh-CN/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md)
- [私有 Skills 市场部署](../docs/zh-CN/PRIVATE_SKILLS_MARKET_DEPLOYMENT.md)
- [奖励机制](../docs/zh-CN/REWARD_MECHANISM.md)
- [进化机制分析](../docs/zh-CN/EVOLUTION_MECHANISM_ANALYSIS.md)
