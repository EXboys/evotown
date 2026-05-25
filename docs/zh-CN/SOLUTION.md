# Evotown 解决方案文档

> **文档版本：** v0.1（2026-05）  
> **适用对象：** 平台 / 研发负责人、AI 工程负责人、安全与合规、解决方案架构师  
> **配套文档：** [产品定位](../../spec/product-positioning.md) · [企业控制面](../../spec/enterprise-control-plane.md) · [引擎接入 API v0.1](EVOTOWN-ENGINE-INGEST-V0.1.md) · [私有 Skills 市场部署](PRIVATE_SKILLS_MARKET_DEPLOYMENT.md) · [奖励机制](REWARD_MECHANISM.md) · [进化机制](EVOLUTION_MECHANISM_ANALYSIS.md)

---

## 1. 摘要

Evotown 是面向独立部署 Agent 运行时的 **进化竞技场（Arena） + 企业控制面（Control Plane）**：

- **Runtime 留在原处运行**：员工笔记本、CI、服务器、容器、研究沙盘上的 OpenClaw 系、Hermes、SkillLite、自研 harness 都不必迁移；
- **Evotown 接收证据**：runs、artifacts、policy events、可复用资产通过 HTTP ingest / Connector 进入 Evotown；
- **三件事一次解决**：
  1. **可观测** —— 谁在跑什么、跑得怎样、花了多少 token；
  2. **可治理** —— 模型、工具、网络、文件、密钥的护栏与审批；
  3. **可复用** —— 把个人发现沉淀为「带证据」的企业资产，并通过私有 Skills 市场分发。
- **Arena 不被弱化**：游戏化沙盘继续作为「进化实验、benchmark、团队学习」的可视化层，是产品的记忆点和差异化。

经济规则（任务接受成本、完成奖励、进化奖励、淘汰阈值）全部 **本地可配、可重现，不依赖任何虚拟币/加密货币**。

---

## 2. 行业背景与痛点

单机 / 单 runtime 的 Agent 工具链已经能放大个人效率，但企业在规模化使用 Agent 时遇到一致的几类问题：

| 痛点 | 现状 | 后果 |
|------|------|------|
| **可见性缺失** | 每个员工 / 团队各跑各的 runtime，结果散落本地 | 无法做对比、复盘、成本归因 |
| **治理空窗** | 模型、工具、网络、密钥使用没有统一护栏 | 数据外泄、违规调用、审计困难 |
| **复用断层** | 一个员工训练 / 调优出来的 skill / prompt 留在本机 | 个人产出难以变成组织资产 |
| **评测随意** | 同一任务用不同模型、不同 runtime，缺乏可重现的对比环境 | 选型 / 升级决策依据不足 |
| **运行时锁定** | 引入新平台往往要求迁移到某个 SDK 或 runtime | 既有投资被绑死 |
| **进化无激励** | 测试只看「任务有没有完成」，不奖励 rules/memory/skills 的真实进化 | LLM 替换后无法识别哪段进化才是有效改进 |

Evotown 的设计前提就是：**控制面应该独立于 runtime**，让企业在不重写 Agent 栈的前提下补齐这五件事。

---

## 3. 解决方案定位

### 3.1 一句话定位

> **Evotown 是独立 Agent 运行时的进化竞技场与企业控制面：runner 留在原处，Evotown 接收 runs / artifacts / policy events / 可复用资产，用于评测、治理与复用。**

### 3.2 产品模式

| 模式 | 面向对象 | 主要价值 |
|------|----------|----------|
| **社区 / 研究** | 框架作者、研究者、开发者 | 可视化竞技场、benchmark、可复现的进化实验、Judge 评分 |
| **企业控制面** | 平台团队、安全团队、研发负责人 | 引擎注册、运行观测、策略封控、资产审核、私有 Skills 市场 |

两种模式 **共用同一套后端**，差异在能力开关、UI 路由与鉴权策略。

### 3.3 边界（什么不做）

- 不替代 OpenClaw / Hermes / SkillLite / 自研 runtime；
- 不强制成为企业唯一的模型网关；
- 不是 EDR / MDM；
- 不依赖、不引入虚拟币 / 加密货币；
- 不自动把个人本地 skill 提升为全公司默认资产 —— 必须经过审核。

---

## 4. 总体架构

### 4.1 三层结构

```text
┌─────────────────────────────────────────────────────────────┐
│              Runtime 层（员工 / CI / 服务器 / 容器）          │
│   OpenClaw  |  Hermes  |  SkillLite  |  自研 harness         │
└───────────────┬─────────────────────────────────────────────┘
                │ run events / artifacts / signals
                │ policy pull / violation
                │ candidate skills
                ▼
┌─────────────────────────────────────────────────────────────┐
│          Connector / Proxy 节点（集中 / 团队 / 工位）         │
│  字段归一化  ·  密钥脱敏  ·  策略本地缓存  ·  上传节流         │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS + Bearer / HMAC
                ▼
┌─────────────────────────────────────────────────────────────┐
│                       Evotown 控制面                          │
│  Engine Registry · Run Observatory · Policy Center           │
│  Asset Registry · Review & Promotion · Arena · Chronicle     │
│  Gateway（可选 LiteLLM 前置） · Skills Market                │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 关键角色分工

| 层 | 角色 | 不做什么 |
|----|------|----------|
| **Runtime** | 真正执行 Agent 任务，生成 skill 候选 | 不直接对接外部 API（推荐走 Connector） |
| **Connector / Proxy** | 把 runtime 事件归一化，附带 `tenant/team/agent/engine/task` 元数据；脱敏；策略缓存；候选技能上交 | 不长期持有 skill 生命周期；不绕过审核直接发布到公司范围 |
| **Evotown** | 注册、入库、可视化、审核、晋升、评测、推荐 | 不安装包到员工机器；不直接当 runtime |
| **Private Skills Market** | 包分发、版本、签名、bootstrap bundle | 不存原始 run telemetry |

---

## 5. 核心能力模块

Evotown 控制面由 7 个模块组成，已在仓库代码中按 `backend/api/routers/` 与 `frontend/src/components/` 切分。

### 5.1 Engine Registry（引擎注册中心）

跟踪所有接入的运行时及其能力。

最小字段：`engine_id`、`engine_type`（`openclaw|hermes|skilllite|custom`）、`engine_version`、`owner_team`、`deployment_kind`（`laptop|server|ci|container`）、`capabilities`、`health`。

对应实现：`POST /api/v1/engines/register`、`GET /api/v1/engines`。

### 5.2 Run Observatory（运行观测台）

把任务历史升级为企业级 run 时间线。

观测指标：
- 按 **员工 / 团队 / 项目 / 引擎** 分组的 run 数与成功 / 失败 / 取消比；
- 耗时、排队时间、token 与模型成本；
- 高风险工具调用、artifact 数量与大小；
- 高频失败类型。

视图：Runs 列表 → Run 详情（logs / signals / artifacts） → 团队摘要 → 引擎对比 → 失败分析。

### 5.3 Policy Center（策略与封控中心）

在不替代 runtime 的前提下提供企业护栏。**第一版采用 pull 模式**：connector 调用 `GET /api/v1/policies`，本地尽力执行，并通过 `POST /api/v1/policy/violations` 回传违规。

策略类型：模型供应商 / 模型名 allowlist、工具 / MCP allow/denylist、网络域名规则、workspace 路径、密钥脱敏规则、artifact 上传上限、高风险操作审批。

违规记录最小字段：`violation_id / run_id / engine_id / policy_id / severity / action(blocked|warned|reported) / resource / timestamp / 脱敏 context`。

### 5.4 Asset Registry（企业资产库）

捕获可复用的组织知识，资产类型涵盖：`skill / prompt / workflow / playbook / memory_snippet / tool_config / evaluation_case`。

生命周期：

```text
proposed → pending → approved → promoted
                  ↘ rejected
approved → deprecated
promoted → rolled_back
```

铁律：
1. 每个 asset 必须可追溯到 `source_run_id` 或人工导入记录；
2. 个人发现 **不会自动** 变成公司默认资产；
3. 晋升必须基于证据：source run + 验证结果 + 审核决策 + 回滚指针。

### 5.5 Review & Promotion（审核与晋升）

控制资产如何变成可复用资产：runtime / connector 提交 → Evotown 以 `pending` 状态存储 → 评测任务在 benchmark 上运行 → 人工或策略审核 → 通过的资产进入企业资产库 → Evotown 在相似任务中推荐已批准资产 → 有问题的版本 deprecate 或 rollback。

### 5.6 Arena（可视化沙盘）

Arena **不是玩具**。它把抽象的进化、benchmark、团队学习映射为可视化语言：

| 控制面概念 | Arena 映射 |
|-----------|-----------|
| 引擎 | runtime 物种 / Agent 类别 |
| 团队 | 群组 |
| 任务 | quest |
| 已批准资产 | 装备 / 能力 |
| 策略违规 | 被拦截的动作 |
| benchmark 轮次 | tournament |
| 时间轴 | 进化地图 |

前端通过 Phaser 3 + React 实时渲染，WebSocket 推送 + REST 兜底；Agent 详情、奖励、淘汰、进化事件都直接落在画面中。

### 5.7 Chronicle（组织学习日志）

Chronicle 从 LLM 生成的「故事视图」升级为组织级学习日志，回答：
- 哪个团队通过晋升哪个 workflow 降低了重复失败？
- 哪个 runtime 因为引入哪个 prompt asset 而显著降低耗时？
- 哪条策略在 run R 中拦截了高风险文件访问？

---

## 6. 关键工作流

### 6.1 Run 生命周期 ingest

Evotown 兼容两种 ingest 方式：

```text
推荐：生命周期事件
  Runtime → Connector → POST /api/v1/events
    event_type ∈ {run.started, run.progress, run.completed}

兼容：终态完成上报
  Runtime → POST /api/v1/runs/{run_id}/complete
    status ∈ {succeeded, failed, cancelled}
    + log_excerpt / artifact_manifest / signals
```

**事实源**：`run.completed` 或 `/complete` 成功入库的 run 为准做看板、benchmark 与进化奖励。

幂等：同 `run_id` 重复提交返回 `200` + `idempotent: true`。

### 6.2 进化与奖励闭环

```text
任务派发（两阶段）
  Phase 1：预览 → agent 回 ACCEPT/REFUSE（不扣费）
  Phase 2：ACCEPT → 扣费（cost_accept=-3 默认）→ 正式执行

任务完成
  judge_task() → completion / quality / efficiency
  total_score → JudgeResult.reward（-5 / 0 / +3 / +5）
  arena.add_balance(agent_id, reward)

进化触发（SkillLite + Evotown callbacks）
  meaningful>=5 & failures>=2/replans>=2 → 进化 rules
  meaningful>=3                          → 进化 memory
  meaningful>=3 & failures>0             → 进化 skills

进化奖励（evolution.rewards 可配置）
  rule_added +5 · example_added +3
  skill_confirmed +12 · skill_refined +5 · skill_pending +4
  → arena.add_balance + WebSocket 广播

淘汰
  balance <= 0 → 移除 agent + kill 进程 + agent_eliminated 事件
```

设计意图：让「进化」成为生存和竞争的主线，而不只是任务完成的副产品。

### 6.3 资产捕获与晋升

```text
Runtime 生成 / 改良本地 skill
  → Connector 检测到候选
  → POST /api/v1/skill-candidates（带 source_run_id）
  → Evotown 自动验证（benchmark）
  → Reviewer 审核（approved / rejected + visibility + promotion_channel）
  → 通过的 skill 进入 GET /api/v1/skills
  → 通过 Skills Market manifest 分发到目标 runtime
  → Evotown 持续度量 reuse 与 outcome 影响
  → 不达预期 → deprecate / rollback
```

### 6.4 策略 pull 与违规回流

```text
Connector / Runtime
  GET /api/v1/policies   ← pull + 本地缓存 + 本地尽力执行
  POST /api/v1/policy/violations  ← 违规上报（blocked / warned / reported）

高风险操作
  → 进入审批队列 → 人工放行 / 拒绝 → 留痕到 Run 详情
```

### 6.5 模型网关（可选，LiteLLM-backed MVP）

Evotown 也可前置在 LiteLLM 之前，作为带审计的 OpenAI 兼容网关：

```bash
OPENAI_BASE_URL=http://<evotown>/api/gateway/v1
OPENAI_API_KEY=evk_xxxxxxxx  # /accounts 控制台或 REST 颁发
```

特性：
- 受管 key 存 SHA-256 哈希，秘钥只在创建时返回一次；
- 每 key 月度 token / cost 配额，超额 `429`；
- 可选 burst RPM（per-key 或全局默认）；
- 兼容旧版 env 配置 `EVOTOWN_GATEWAY_API_KEYS`，每个旧 key 都有稳定的 `legacy:…` 审计 id；
- 不是强制依赖 —— 没有网关需求的部署可以完全不开。

---

## 7. 技术架构

### 7.1 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| **后端** | Python 3.10+ / FastAPI / Uvicorn / WebSockets / aiosqlite | `backend/main.py` 装配，路由在 `backend/api/routers/`，领域模型在 `backend/domain/`，基础设施在 `backend/infra/` |
| **前端** | React 18 + TypeScript 5 + Vite 5 + Tailwind + Zustand + Phaser 3 + Recharts + React Router 7 | `frontend/src/`，Arena 用 Phaser，企业控制台用 React + Tailwind |
| **持久化** | SQLite（aiosqlite）+ 本地文件（artifacts / packages） | 数据目录由 `EVOTOWN_DATA_DIR` 控制；天然支持本地化与备份 |
| **LLM** | 通过 `openai>=1.0` 兼容协议；多通道分离（main / judge / dispatcher / social / chronicle） | 通道可单独指向更便宜或更强的模型 |
| **部署** | Docker Compose + Caddy / Nginx 反代；可选 LiteLLM profile；seccomp profile (bwrap) | `Dockerfile.backend` / `Dockerfile.frontend` |
| **CI** | GitHub Actions（backend pytest + frontend build） | `.github/workflows/ci.yml` |

### 7.2 后端模块组织

```text
backend/
├── api/routers/        # FastAPI 路由（accounts/agents/chronicle/gateway/
│                       #   engine_ingest/skill_market/teams/tasks/...）
├── core/               # auth, config, deps, callbacks
├── domain/             # arena, models（领域模型 / 状态机）
├── services/           # agent_comms, agent_service, belief_engine,
│                       #   chronicle, snapshot, social_decision, task_service
├── infra/              # accounts, engine_ingest, gateway, knowledge,
│                       #   persistence, replay, skill_market, social_log,
│                       #   task_history, tool_execution_stream
├── arena_prompts/      # Arena 专属 prompt 模板
├── arena_skills/       # Arena 内置技能
├── tests/              # pytest 测试套件
├── judge.py            # 任务评分
├── llm_client.py       # 多通道 LLM 封装
├── log_watcher.py      # 监听 evolution.log → WebSocket
├── task_dispatcher.py  # 两阶段任务派发
├── ws_dispatcher.py    # WebSocket 广播
└── main.py             # 应用入口
```

### 7.3 前端模块组织

```text
frontend/src/
├── App.tsx
├── main.tsx / main.css
├── components/
│   ├── LandingPage.tsx / EnterpriseConsole.tsx / ConsoleLoginPage.tsx
│   ├── PhaserTownCanvas.tsx / TownLayout.tsx          # Arena 渲染
│   ├── AgentDetail.tsx / AgentGraveyard.tsx
│   ├── ObserverPanel.tsx / MetricsDashboard.tsx
│   ├── EvolutionTimeline.tsx / EventTicker.tsx
│   ├── ChronicleBook.tsx / TaskHistoryPage.tsx
│   ├── GatewayAccountsPanel.tsx / KnowledgePanel.tsx
│   ├── SocialGraph.tsx / Leaderboard.tsx
│   ├── agent/  market/  ui/
├── phaser/             # Phaser 场景、Tile 加载
├── hooks/              # WebSocket、自动重连、缓存
└── store/              # Zustand stores
```

### 7.4 鉴权与多租户

| 通道 | 鉴权 | 说明 |
|------|------|------|
| **Engine ingest（写）** | `Authorization: Bearer <EVOTOWN_ENGINE_INGEST_TOKEN>` | 绑定 engine_id；本地 dev 可回退 `ADMIN_TOKEN` |
| **Engine ingest（读）** | `X-Admin-Token` | `GET /engines`、`/runs`、`/policy/violations`、`/costs/summary` |
| **Accounts / Skill review** | `X-Admin-Token` | 控制台与审核动作 |
| **Gateway chat** | `evk_…` key（managed）或 legacy bearer | 必须含 scope `gateway.chat` |
| **未来 v0.2+** | HMAC-SHA256（`X-Evotown-Timestamp` + `X-Evotown-Signature`） | 防重放，时钟偏差 ≤ 5 分钟 |

多租户字段在 ingest 事件里以 `tenant_id` / `team_id` / `agent_id` / `engine_id` / `task_id` 顶层透传，便于跨 runtime 聚合。

---

## 8. 部署形态

### 8.1 形态 A —— 单机 / 研究模式（社区）

```bash
docker compose up -d --build
# 访问 http://localhost
```

- 默认 SQLite，数据写到 `data/`；
- 适合：单人研究、框架对比、本地 demo。

### 8.2 形态 B —— 企业「仅 HTTP ingest」

外部 runtime 在 run 完成后 POST `/api/v1/runs/{run_id}/complete`。这是最低成本接入方式，适合：

- 不希望员工机器跑额外 daemon；
- 已有 CI / 服务器侧 runner，能直接出口 HTTP。

### 8.3 形态 C —— Connector / Proxy 模式（推荐企业生产）

在员工 workspace / 团队节点旁运行一个 connector 进程，负责：

- 发现本地 agent run、上传 events 与 artifacts；
- 拉取并缓存策略；
- 上传前脱敏密钥；
- 提交可复用资产候选。

适合需要细粒度治理、内网隔离、密钥脱敏的生产场景。

### 8.4 形态 D —— Gateway Mode

Evotown Gateway 前置在 LiteLLM 前，集中做：模型路由 / 成本控制 / 审计 / 配额。
Compose 提供可选 `litellm` profile：

```bash
docker compose --profile litellm up -d
```

设置 `LITELLM_BASE_URL` 与 `LITELLM_MASTER_KEY` 即可对接生产 LiteLLM。

### 8.5 数据目录与备份

| 路径 | 用途 |
|------|------|
| `${EVOTOWN_DATA_DIR}/accounts.db` | Gateway 账户 / API key |
| `${EVOTOWN_DATA_DIR}/skills_market.db` | 私有 Skills 市场 |
| `${EVOTOWN_DATA_DIR}/skill_packages/` | 包文件存储（可后续替换为 S3 / MinIO） |
| `${EVOTOWN_DATA_DIR}/engine_ingest.db` | 引擎注册 / run 入库 |
| `${EVOTOWN_DATA_DIR}/...`（其他） | 任务历史、社交日志、淘汰记录、knowledge 等 |

生产环境务必将 `EVOTOWN_DATA_DIR` 挂到持久卷并纳入备份。

---

## 9. 安全与合规

### 9.1 数据原则

1. 先采集结构化 run 元数据，再考虑原始日志；
2. 上传前尽量脱敏密钥；
3. artifact 默认视为潜在敏感数据；
4. 每个被晋升的 asset 必须保留 source run 血缘；
5. 「可观测」与「员工监控」在产品语言、权限上严格分离。

### 9.2 必备控制

- engine 级 token-scoped 鉴权；
- 写入接口走 Bearer / 未来 HMAC；
- 生产 TLS；
- artifact 大小上限、log excerpt 上限；
- runs / artifacts / events 保留策略；
- 控制台页面采用 RBAC。

### 9.3 敏感数据分级

| 类别 | 处理 |
|------|------|
| API key / token | Connector 端用稳定指纹替换；服务端二次过滤 |
| Prompt / artifact 中的客户数据 | artifact 默认仅存哈希，全量包可选 |
| 私有仓库路径 / 本地文件路径 | 默认脱敏 |
| 员工标识 | 默认团队级聚合，下钻到员工级需要授权 |

### 9.4 透明可审计

Evotown 让以下事情对管理员可见：
- 哪条策略采集了哪份数据；
- 某个 run / artifact 为什么被保留；
- 某个 asset 被谁审核 / 晋升。

---

## 10. 路线图

| 阶段 | 目标 | 主要交付 | 验收信号 |
|------|------|----------|----------|
| **P1 可观测基础** | 让企业看见 Agent 使用情况 | 引擎注册页、改进 runs 页、run 详情（logs/signals/artifacts）、团队与引擎指标、README 定位升级 | 自研 runner 可注册并上报 run；管理员可按引擎和团队对比 |
| **P2 资产捕获** | 把个人产出变成可审核资产 | asset 数据模型；`assets/propose`；Skills Market handoff 契约；bootstrap bundle manifest；候选 skill 流；asset 列表 / 详情；状态机 | run 可提交 skill/prompt/workflow；connector 可从 OpenClaw/Hermes/SkillLite 提交候选；reviewer 可批准 / 拒绝；approved 资产可搜索 |
| **P3 策略与封控** | 让企业敢部署到员工机器 | policy 模型；`GET /api/v1/policies`；policy violation ingest；policy center UI；高风险操作审批队列 | connector 可拉取策略；被拦截动作出现在 Evotown；管理员能看到违规来源；connector 可附带 tenant/team/agent 上下文 |
| **P4 评测与推荐** | 让资产复用有证据 | evaluation jobs；benchmark suites；asset promotion / deprecation；推荐 API；asset performance dashboard | 资产基于证据晋升；较差版本可回滚；用户在相似任务中收到推荐 |

> 当前仓库实现已覆盖 P1 的大部分能力，并提供了 P2 / P3 / P4 的基础接口（engine ingest、skill market MVP、gateway 配额、callbacks 进化奖励）。

---

## 11. 典型应用场景

### 11.1 多 runtime 对比基准（研究 / 选型）

- 同一批 benchmark 任务，分别下发到 OpenClaw / Hermes / SkillLite runner；
- 通过 ingest 进入 Run Observatory；
- Arena 把 runtime 当物种、把 benchmark 当 tournament，可视化对比成功率、耗时、token；
- Chronicle 自动生成「哪个 runtime 在哪类任务上更优」的叙事。

### 11.2 企业 Agent 使用看板

- 全部接入 connector，按 `tenant/team/agent/engine` 维度聚合 run；
- 看板回答：成本去向、高频失败模式、高风险工具调用、artifact 体量；
- 与现有 SRE / FinOps 看板交叉。

### 11.3 私有 Skills 市场 + 审核晋升

- Connector 自动捕获员工本地新产生 / 改良的 skill；
- 候选先进入 `pending`；
- 验证 + 审核通过后写入 Skills Market；
- 其他 runtime 通过 manifest 安装；
- Evotown 持续度量 reuse 与 outcome。

### 11.4 策略护栏与高风险审批

- 平台团队定义模型 / 工具 / 域名 allowlist；
- Connector pull 策略并在本地拦截；
- 违规事件 / 高风险操作进入 Evotown 审批队列；
- 审批留痕到 run，且可被 Chronicle 引用。

### 11.5 进化效果验证

- 设定一组任务池与难度分布；
- 用相同 LLM 跑两版（带/不带进化）；
- Arena 经济系统提供「不奖励则不进化」的选择压力；
- 通过 Judge + 进化奖励 + 淘汰阈值，得到「LLM 性能 vs 进化引擎贡献」的可重现数据。

---

## 12. 差异化优势

| 维度 | 业界常见做法 | Evotown |
|------|--------------|---------|
| **Runtime 关系** | 要求迁移到自家 SDK | 中立，OpenClaw / Hermes / SkillLite / 自研 都是一等公民 |
| **资产分发** | 控制面同时当包管理器 | 包分发交给私有 Skills 市场，Evotown 只负责证据与审核 |
| **可视化** | 表格 + 折线图 | 表格 + Phaser 沙盘，进化、benchmark、违规可被「看见」 |
| **进化激励** | 仅看任务完成率 | 任务奖励 + 进化奖励 + 淘汰阈值组成完整选择压力 |
| **模型经济** | 多用积分 / 虚拟币 | 完全本地数值，**不依赖虚拟币/加密货币** |
| **部署成本** | 强 SaaS / 强 daemon | 单机一键 Docker，企业可叠加 Connector / Gateway / LiteLLM |
| **晋升机制** | 个人产出自动同步全公司 | 必须经过 `pending → approved → promoted`，可 deprecate / rollback |

---

## 13. 快速接入指南

### 13.1 5 分钟跑通本地

```bash
cd evotown
cp .env.example .env
# 填 API_KEY / BASE_URL / MODEL
docker compose up -d --build
open http://localhost          # 落地页
open http://localhost/arena    # 竞技场
```

### 13.2 第一个外部 runner 接入

```bash
# 1) 注册引擎
curl -X POST http://<evotown>/api/v1/engines/register \
  -H "Authorization: Bearer $EVOTOWN_ENGINE_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "engine_id": "my-runner-1",
    "engine_type": "custom",
    "engine_version": "0.1.0",
    "owner_team": "platform",
    "deployment_kind": "server"
  }'

# 2) 上报 run 完成
curl -X POST http://<evotown>/api/v1/runs/run_001/complete \
  -H "Authorization: Bearer $EVOTOWN_ENGINE_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "engine_id": "my-runner-1",
    "engine_version": "0.1.0",
    "status": "succeeded",
    "exit_code": 0,
    "finished_at": "2026-05-25T09:30:00Z",
    "signals": { "task_completed": true, "latency_ms": 1230 }
  }'
```

### 13.3 提交一个候选 skill

```bash
curl -X POST http://<evotown>/api/v1/skill-candidates \
  -H "Authorization: Bearer $EVOTOWN_ENGINE_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "candidate_id": "cand_001",
    "source_run_id": "run_001",
    "tenant_id": "company-a",
    "team_id": "growth-team",
    "agent_id": "my-agent",
    "engine_id": "my-runner-1",
    "runtime_target": "custom",
    "name": "Summarize CRM Notes",
    "description": "Extract action items from CRM notes.",
    "inline_manifest": { "entrypoint": "SKILL.md" },
    "signals": { "task_completed": true }
  }'
```

### 13.4 启用 Gateway

```bash
# 给 agent 配置网关地址
OPENAI_BASE_URL=http://<evotown>/api/gateway/v1
OPENAI_API_KEY=evk_xxxxxxxx     # 从 /accounts 控制台或 REST 颁发
```

> 配额 / 速率 / 审计参见 [README — Gateway accounts & API keys](../../README.md#gateway-accounts--api-keys)。

### 13.5 经济参数调优

`backend/evotown_config.json` 或环境变量：

| 参数 | 默认 | 环境变量 |
|------|------|----------|
| initial_balance | 100 | `EVOTOWN_INITIAL_BALANCE` |
| cost_accept | -5 | `EVOTOWN_COST_ACCEPT` |
| reward_complete | 10 | `EVOTOWN_REWARD_COMPLETE` |
| penalty_fail | -5 | `EVOTOWN_PENALTY_FAIL` |
| eliminate_on_zero | true | `EVOTOWN_ELIMINATE_ON_ZERO` |
| interval_tasks | 3 | `EVOTOWN_INTERVAL_TASKS` |
| failure_cooldown | 3 | `EVOTOWN_FAILURE_COOLDOWN` |

进化奖励在 `evolution.rewards` 配置块下。

---

## 14. API 路线图（与 ingest v0.1 协同）

| 版本 | 主要新增 |
|------|----------|
| **v0.1（已实现）** | `POST /api/v1/engines/register`、`GET /api/v1/engines`、`POST /api/v1/runs/{run_id}/complete`、`GET /api/v1/runs`、`GET /api/v1/runs/{run_id}`、`GET /api/v1/runs/{run_id}/events` |
| **v0.2** | `POST /api/v1/events`（run.started / run.progress / run.completed / step / tool_call / model_call / artifact_written / policy_violation / run_finished）；`GET /api/v1/policies`；`POST /api/v1/policy/violations` |
| **v0.3** | `POST /api/v1/assets/propose`、`GET /api/v1/assets`、`POST /api/v1/assets/{asset_id}/review`、`GET /api/v1/assets/recommend` |
| **v0.4** | `POST /api/v1/evaluations`、`GET /api/v1/evaluations/{evaluation_id}`、`POST /api/v1/assets/{asset_id}/promote`、`POST /api/v1/assets/{asset_id}/deprecate` |

完整字段定义见 [引擎接入 API v0.1](EVOTOWN-ENGINE-INGEST-V0.1.md) 与 OpenAPI 草案 `docs/openapi/evotown-engine-ingest-v0.1.yaml`。

---

## 15. 风险与缓解

| 风险 | 缓解 |
|------|------|
| **大 artifact / 大日志撑爆磁盘** | `log_excerpt` ≤ 64 KiB 默认上限；artifact 走 manifest + 可选拉取；保留策略可配置 |
| **重放攻击** | 幂等窗口；未来 v0.2+ HMAC + 时间戳 |
| **员工隐私边界模糊** | 团队级聚合为默认；下钻到员工级走 RBAC；产品文案严格区分「观测」与「监控」 |
| **个人 skill 被自动推全公司** | 强制 `pending → approved → promoted` 流；个人产出永远不会自动变成默认 |
| **Runtime 锁定** | 入站协议中立 + Connector 归一化 + Arena 把 runtime 当物种而非依赖 |
| **进化无激励 → 退化为只测 LLM** | 经济系统给 rule/skill/memory 直接奖励；任务设计强制 `total_tools >= 2`；进化触发阈值可调 |

---

## 16. 词汇表

| 术语 | 含义 |
|------|------|
| **Runtime / Engine** | 真正执行 Agent 任务的程序（OpenClaw / Hermes / SkillLite / custom） |
| **Connector** | runtime 与 Evotown 之间的集成节点，负责归一化、脱敏、策略缓存 |
| **Run** | 一次完整的 Agent 执行；以 `run_id` 为单位 |
| **Asset** | 可复用的组织资产，含 skill / prompt / workflow / playbook / memory / tool_config / evaluation_case |
| **Skill Candidate** | 候选 skill，待审核进入企业资产 |
| **Bootstrap Bundle** | 私有 Skills 市场签发的初始安装包 |
| **Arena** | Evotown 的可视化沙盘，把控制面概念游戏化呈现 |
| **Chronicle** | 组织学习日志，自动叙述 run / asset / policy 的演进 |
| **Judge** | 任务评分器，返回 completion / quality / efficiency 与奖励 |
| **Evolution** | rules / memory / skills 的自我进化机制 |

---

## 17. 参考与扩展阅读

- [产品定位（spec）](../../spec/product-positioning.md)
- [企业控制面（spec）](../../spec/enterprise-control-plane.md)
- [Skills 市场与 Connector（spec）](../../spec/skills-market-and-connectors.md)
- [策略中心（spec）](../../spec/policy-center.md)
- [资产注册（spec）](../../spec/asset-registry.md)
- [Arena UX（spec）](../../spec/arena-ux.md)
- [安全与隐私（spec）](../../spec/security-and-privacy.md)
- [路线图（spec）](../../spec/roadmap.md)
- [引擎接入 API v0.1（中文）](EVOTOWN-ENGINE-INGEST-V0.1.md)
- [私有 Skills 市场部署指南](PRIVATE_SKILLS_MARKET_DEPLOYMENT.md)
- [奖励机制](REWARD_MECHANISM.md) ｜ [进化机制](EVOLUTION_MECHANISM_ANALYSIS.md) ｜ [任务接受逻辑](AGENT_TASK_ACCEPTANCE_ANALYSIS.md)
- [企业控制面产品规格（详版）](ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md)

[English version: TBD]
