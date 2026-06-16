# Evotown 需求池

> 记录待讨论、待实现的需求。确认方案后写入方案文件（`docs/plans/`），按计划逐一实现。

---

## 待讨论

### REQ-001: Agent 执行过程实时可视化

**描述**: 发起长任务时，无法判断是否正常进行。需要在运行详情面板中展示具体过程、进度、大模型中间输出。

**实现方向**:
- 后端在 `run_events` 中实时记录 Agent 中间输出（assistant text、tool_call/result）
- 前端详情面板展示：执行步骤 + 控制台输出窗口，支持展开查看完整文本
- 4 秒轮询，不改 Agent 逻辑

**状态**: 待确认方案

---

### REQ-002: Web 交互页面 — 分享功能

**描述**: 用户生成的 Web 页面分享给其他账号查看。初步方案是复制文件到目标 workspace，各自独立。

**实现方向**:
- 方案 A: 文件复制（独立副本）
- 方案 B: 分享链接 + 临时 token
- 可二选一或组合

**状态**: 待讨论

---

### REQ-003: Agent 产出物自动归类目录

**描述**: Agent 生成的下载文件放入 `workspace/downloads/`，前端静态文件放入 `workspace/dashboard/` 等，统一目录规范。

**状态**: 待讨论

---

### REQ-004: Coding Agent 工作台页面整体重设计

**描述**: 重新规划整个工作台页面的布局，解决聊天区过窄、Web/图片预览空间不足、会话列表占用过多空间等问题。

**候选方案**:
- **方案 A（推荐）**: 左侧可折叠图标栏 + 聊天区全宽 + 右侧可折叠详情面板。Web/图片预览直接嵌在聊天流中，不受 max-w 限制。
- **方案 B**: 三栏（会话列表 / 聊天区 / 持久预览面板），预览始终可见。
- **方案 C**: 上下分栏（上聊天 / 下预览），可拖拽调整。

**状态**: 待讨论

---

### REQ-005: MCP 服务管理与权限体系

**描述**: MCP 是 Agent 连接数据库的唯一通道。MCP 服务由后端发布，前端仅管理查看和权限设定。

**已确认方向**:
- MCP 生命周期：后端开发部署 → 注册到 evotown → 前端管理面板（只读 + 权限配置）
- 两层权限：a. workspace 级 MCP 访问开关；b. 行级权限规则（MCP 代理层查询改写）
- 权限绑定粒度：workspace 级别
- 行权限规则支持变量插值：`{workspace_team_id}`, `{org_id}`, `{workspace.owner_account_id}`
- MCP 不独立使用，由 Skill 声明 `requires_mcp` 依赖，运行时自动注入
- 前端移除输入区 MCP 手动选择器
- 前端新增 `/console/mcp` MCP 服务管理面板
- MCP 前端不做创建，仅管理查看和权限设定

**待确认**: MCP 注册方式（API vs 配置文件）、行权限规则引擎语法

**状态**: ✅ 已实施

---

### REQ-006: Skill 开发与管理体系

**描述**: Skill 是 Agent 能力的核心载体。需要建立完整的 Skill 开发、发布、管理流程。

**核心问题**:
- 当前 Skill 从市场下载 zip 包到 workspace，缺乏结构化开发体验
- Skill 没有声明式依赖（`requires_mcp`、`requires_knowledge`）
- 缺乏 Skill 开发 SDK/脚手架、测试环境
- Skill 版本管理、安全审核、市场分发机制待建立

**关联依赖**: REQ-005 MCP（Skill 依赖 MCP 时自动注入）

**状态**: 待讨论

---

### REQ-007: 任务看板

**描述**: 基于现有「任务管理」板块，升级为可视化任务看板。

**核心概念**:
- **任务 (Task)**: 一个完整的业务链路，包含起止点、多个串行执行节点
- **执行节点 (TaskNode)**: 看板最小颗粒，单次 Agent 执行
- **Agent 通信**: 通过节点间派活自动流转（上游完成 → 自动派发给下游）
- 看板按 workspace 隔离，管理员可切换 workspace 查看

**创建入口**:
1. 管理员看板 UI「新建任务」→ 编排节点链
2. Agent 调用 `create-task` 系统技能（显式调用 / 其他技能依赖）
3. 节点间自动流转（上游完成 → 系统自动创建下游节点）
4. （远期）定时/周期触发、API/Webhook 触发

**系统技能: create-task**:
- 内置源代码，存储在 `backend/arena_skills/create-task/`
- Agent 调用时向任务看板插入新任务，其他 Agent 可见可领取执行
- 入口统一：看板 UI / Agent 调用 / 自动流转 → 都走 `POST /api/v1/tasks`

**一期（近期）**:
- 串行节点编排，单 Agent 执行
- 看板视图：按状态分列（queued/running/completed/failed）
- workspace 切换器
- 任务组串联展示
- 统一 dispatch_jobs + agent_runs 为 task_nodes

**远期**: fork/merge 分支合并、batch 工作池、定时/周期/Webhook 触发

**关联**: 现有 `/dispatch` 任务派活 + `/runs` 运行记录

**状态**: 方案已确认，待实施

---

### REQ-009: Agent 对话技能推荐弹窗

**描述**: Agent 对话中提及技能库中的技能但未触发调用时，前端弹窗提示用户确认是否使用该技能。勾选后该技能加入本次对话的实际执行。

**示例**: 用户说"帮我看看最近的订单情况"，Agent 上下文中有 `database-query` 技能但用户未明确调用 → 弹窗"是否使用 database-query 技能查询数据库？"

**状态**: 待讨论，暂不展开

---

### REQ-008: 任务节点并行（远期）

**描述**: 单个节点任务量过大时，支持 fork 拆分为多 Agent 并行处理、batch 工作池抢占消费。

**状态**: 远期，暂不实施

---

### REQ-010: 引擎模块功能重构（远期）

**描述**: 当前引擎模块（`engine_ingest`、`hosted_workspace_engines`）已从 workspace 生命周期解绑。未来需重新设计引擎：外部 Agent 通过 API key 直连时的注册、心跳、任务分发逻辑。

**已完成解绑**:
- `workspaces.py`: 创建/更新 workspace 不再自动注册引擎
- `main.py`: 启动时不再同步 workspace 到引擎表

**状态**: 远期，暂不实施

---

（暂无）

---

## 已实现

- Phase 1-6: Coding Agent 工作台交互区改造
