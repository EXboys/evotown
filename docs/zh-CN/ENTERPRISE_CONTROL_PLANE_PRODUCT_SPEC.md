# Evotown 企业控制面产品规格

**状态：** 产品规划草案。本文描述目标产品方向，不代表所有能力当前已经实现。

**源头：** Evotown 的产品与工程规格现已放在 [`../../spec/`](../../spec/) 下。本文是便于阅读的规划叙述，方向与 spec 保持一致。

**定位：** Evotown 保留进化竞技场，但企业产品形态扩展为独立 Agent 运行时的中心控制面。OpenClaw 系、Hermes、SkillLite 和自研 runner 都可以继续在原处运行；Evotown 接收 telemetry、artifacts、policy events 与可复用资产。

---

## 1. 产品判断

单机 Agent 运行时可以提升个人效率，但企业需要一层组织级能力：

- 观察员工电脑、服务器、CI、容器上的 Agent 使用情况。
- 对比不同引擎、团队、任务的效率与输出质量。
- 约束模型、工具、网络、文件与密钥使用。
- 把个人发现沉淀为可复用的企业资产。
- 对资产进行评测、审核、推荐、回滚。

Evotown 应该成为这一层，同时避免把所有团队锁定到某一个 runtime。

---

## 2. 产品模式

Evotown 面向两个公开模式，共用同一套后端：

| 模式 | 面向对象 | 主要价值 |
|------|----------|----------|
| 社区 / 研究 | 开发者、框架作者、研究者 | 进化竞技场、benchmark 实验、可视化沙盘、可复现实验对比 |
| 企业控制面 | 平台团队、安全团队、研发负责人 | 运行可观测、策略封控、资产审核、技能 / prompt / workflow 复用 |

游戏页面继续保留，但它成为更大控制台里的 **Arena view**。

---

## 3. 核心模块

### 3.1 Engine registry / 引擎注册中心

管理接入 Evotown 的运行时。

最小字段：

- `engine_id`
- `engine_type`：`openclaw`、`hermes`、`skilllite`、`custom`
- `engine_version`
- `owner_team`
- `deployment_kind`：`laptop`、`server`、`ci`、`container`
- `capabilities`：run ingest、events、artifacts、assets、policy pull
- `health`：最近心跳、最近 run、错误状态

第一版可扩展现有 `POST /api/v1/engines/register` 契约。

### 3.2 Run observatory / 运行观测台

把当前任务历史升级为企业级 run 时间线。

指标：

- 按员工、团队、项目、引擎统计 run 数。
- 成功 / 失败 / 取消比例。
- 耗时与排队时间。
- token 与模型成本。
- 高风险 tool call。
- artifact 数量与大小。
- 高频失败类型。

视图：

- Runs 列表。
- Run 详情。
- 团队摘要。
- 引擎对比。
- 失败分析。

### 3.3 Policy center / 策略与封控中心

在不替代 runtime 的前提下提供企业护栏。

策略类型：

- 允许的模型供应商与模型。
- tool / MCP allowlist 与 denylist。
- 网络域名 allowlist / denylist。
- workspace 路径访问规则。
- 密钥处理与脱敏规则。
- artifact 上传限制。
- 高风险操作审批。

第一版可以采用 pull 模式：本地 connector 调用 `GET /api/v1/policies`，尽力执行策略，并上报违规。

### 3.4 Asset registry / 企业资产库

捕获可复用的组织知识。

资产类型：

- skill
- prompt
- workflow / playbook
- memory snippet
- tool config
- evaluation case

必要元数据：

- `asset_id`
- `asset_type`
- 来源 `run_id`
- 作者与团队
- 版本
- 状态：`pending`、`approved`、`rejected`、`deprecated`
- 标签与适用场景
- benchmark 结果
- 晋升后的使用次数与成功率
- 回滚指针

重要产品规则：个人发现不能自动变成公司默认资产，必须先进入 review。

### 3.5 Review and promotion / 审核与晋升

控制资产如何变成可复用资产。

流程：

1. runtime 或 connector 提交资产。
2. Evotown 以 `pending` 状态存储。
3. 评测任务在 benchmark 上运行。
4. 人工或策略审核通过 / 拒绝。
5. 通过的资产进入企业资产库。
6. Evotown 在相似任务中推荐已批准资产。
7. 有问题的版本可 deprecated 或 rollback。

### 3.6 Arena view / 竞技场视图

现有游戏页面应该保留。它的角色从「整个产品」调整为「进化实验的可视化沙盘」。

Arena 可展示：

- 团队作为群组。
- 引擎作为 agent 物种或 runtime 类别。
- 任务作为 quest。
- 已批准资产作为装备 / 能力。
- 策略违规作为被拦截动作。
- benchmark 轮次作为 tournament。

这样既保留 Evotown 的记忆点，又让企业控制台保持实用。

### 3.7 Chronicle / 组织学习日志

Chronicle 从故事视图升级为组织学习日志。

例子：

- “团队 A 通过晋升 workflow W 降低了重复测试失败。”
- “Hermes runner 在 benchmark B 上因 prompt asset P 降低了耗时。”
- “策略在 run R 中拦截了高风险文件访问。”

---

## 4. API 路线图

现有 ingest API 是基础，后续逐步扩展。

### v0.1：run 完成上报

当前范围：

- `POST /api/v1/engines/register`
- `POST /api/v1/runs/{run_id}/complete`
- 可选 artifacts
- 可选 run lease

### v0.2：实时事件与策略拉取

新增：

```text
POST /api/v1/events
GET  /api/v1/policies
POST /api/v1/policy/violations
```

事件类型：

- `run_started`
- `step_started`
- `tool_call`
- `model_call`
- `artifact_written`
- `policy_violation`
- `run_finished`

### v0.3：资产

新增：

```text
POST /api/v1/assets/propose
GET  /api/v1/assets
POST /api/v1/assets/{asset_id}/review
GET  /api/v1/assets/recommend
```

### v0.4：评测与晋升

新增：

```text
POST /api/v1/evaluations
GET  /api/v1/evaluations/{evaluation_id}
POST /api/v1/assets/{asset_id}/promote
POST /api/v1/assets/{asset_id}/deprecate
```

---

## 5. UI 路线图

目标导航：

- `Dashboard`：企业总览。
- `Runs`：run 列表与详情。
- `Engines`：运行时注册与健康状态。
- `Policies`：护栏与审批规则。
- `Assets`：企业 skill / prompt / workflow 资产库。
- `Reviews`：待审核资产与高风险操作。
- `Arena`：游戏化进化沙盘。
- `Chronicle`：组织学习日志。

现有页面映射：

| 当前页面 | 未来角色 |
|----------|----------|
| `/arena` | Arena view |
| `/task-history` | Runs |
| `/chronicle` | Chronicle |
| `/agents/{id}/metrics` | Run / engine / team metrics 数据源 |

---

## 6. Connector 策略

Evotown 不应要求单一部署方式。

### 模式 A：仅 HTTP ingest

外部 runtime 在 run 完成后上报。这是最低成本接入方式。

### 模式 B：本地 connector

一个小进程运行在员工 workspace 旁边。

职责：

- 发现本地 agent run。
- 上传 run events 与 artifacts。
- 拉取策略。
- 上传前脱敏密钥。
- 提交可复用资产。

### 模式 C：gateway mode

企业模型网关负责模型路由、成本控制与审计。Evotown 可以集成网关，但不强制依赖网关。

---

## 7. 实施阶段

### Phase 1：可观测基础

目标：先让企业看见 Agent 使用情况。

交付：

- 引擎注册页面。
- 改进 runs 页面。
- run 详情展示 logs、signals、artifacts。
- 团队 / 引擎指标。
- README 与 docs 定位更新。

验收：

- custom runner 可以注册并上报 run。
- 管理员可以按引擎和团队对比 run。
- Arena 可以消费 run 结果作为可视化数据源。

### Phase 2：资产捕获

目标：把个人产出变成可审核资产。

交付：

- asset 数据模型。
- `assets/propose` endpoint。
- asset 列表与详情页。
- pending / approved / rejected 状态。
- 每个 asset 可追溯到 source run。

验收：

- run 可以提交 skill / prompt / workflow。
- reviewer 可以批准或拒绝。
- approved asset 可以搜索。

### Phase 3：策略与封控

目标：让企业敢部署到员工机器。

交付：

- policy model。
- `GET /policies`。
- policy violation ingest。
- policy center UI。
- 高风险操作审批队列。

验收：

- connector 可以拉取策略。
- 被拦截动作出现在 Evotown。
- 管理员可以看到哪些策略产生违规。

### Phase 4：评测与推荐

目标：让资产复用有证据。

交付：

- evaluation jobs。
- benchmark suites。
- asset promotion / deprecation。
- asset recommendation API。
- asset performance dashboard。

验收：

- asset 基于证据晋升。
- 较差版本可以回滚。
- 用户在相似任务中收到已批准资产推荐。

---

## 8. 产品边界

Evotown 不应变成所有 runtime 本身。

范围内：

- 控制面。
- ingest 与 telemetry。
- 策略与审核流。
- 资产库。
- 评测与可视化。

初期范围外：

- 替代 OpenClaw / Hermes / SkillLite runtime。
- 完整 endpoint security / EDR。
- 完整 MDM agent。
- 强制模型网关。
- 自动安装所有引擎。

---

## 9. 近期 README 话术

建议产品句：

> Evotown 是独立 Agent 运行时的进化竞技场与企业控制面。Runner 留在原处运行；Evotown 接收 runs、artifacts、policy events 与可复用资产，用于评测、治理与复用。

建议 Arena 句：

> Arena 是进化实验、benchmark 与团队学习的可视化沙盘。

