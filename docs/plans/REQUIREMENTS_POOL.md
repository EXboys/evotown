# Evotown 需求池

> 记录待讨论、待实现的需求。确认方案后写入方案文件，按计划逐一实现。

---

## 待实施

### REQ-011: MCP 基础设施 — 目录结构与自动注册

system MCP 启动扫描自动注册到 mcp_services 表。

**范围**：
- `backend/services/mcp_system/` — 系统内置 MCP 根目录（git 仓库内，随代码部署）
- **启动扫描注册**：evotown 启动时扫描 mcp_system/ 子目录 → 读 manifest.json → INSERT INTO mcp_services（source=system），已存在则跳过（幂等）
- **get_handler 按 source 分流**：
  - system → `backend/services/mcp_system/{name}/handler.py`
  - internal → `/app/data/mcp-services/{service_id}/handler.py`
  - external → 不走本地，直接 HTTP 转发

**注册时机**：
| 类型 | 注册方式 |
|------|---------|
| system MCP | 启动扫描自动插入 |
| internal MCP | Agent 调 internal_mcp_deploy 提审，管理员审核通过后 INSERT |
| external MCP | 管理员手动注册 INSERT |

**关联需求**: REQ-012、REQ-013
**状态**: 方案已确认，待实施


### REQ-012: 系统 MCP — internal_mcp_deploy + 审核流程

internal MCP 生命周期管理的完整链路。

**service_id**: `system/internal_mcp_deploy`

**Agent 调用**：
```
mcp_call("internal_mcp_deploy", {
    "category": "shop",
    "name": "platform_order"
})
```

**内部自动**：
① 拼 mcp_path = /{category}/{name}，service_id = {category}_{name}
② 读 /app/data/mcp-dev/{mcp_path}/manifest.json → 拆字段
③ 查 mcp_services WHERE mcp_path → 首次/更新
④ 首次 → INSERT mcp_services (status=pending)
   更新 → INSERT mcp_service_versions (status=pending)

**审核互斥**：
- 提审前检查：SELECT FROM mcp_service_versions WHERE service_id = ? AND status = 'pending'
- 已有 pending → 拒绝：`{ok: false, error: "版本 x.x.x 正在审核中，请等待审核完成后再提交"}`
- 同一 MCP 同一时间只有一个版本在审核

**版本策略**：
- 版本号从 manifest.json 读取，由 Agent 控制
- 系统不做强制递增约束
- 被驳回后可同版本重提（新增一条记录，不覆盖），也可改 manifest 升级版本号

**mcp_services 新增字段**：
mcp_path, category, version, dimensions(JSON), tables(JSON), input_schema(JSON), output_schema(JSON)
status 扩展：online/offline/pending/approved/rejected/deprecated

**新增 mcp_service_versions 表**：
version_id, service_id, version, version_notes,
snapshot_dimensions, snapshot_tables, snapshot_schemas,
status, submitted_by_workspace, submitted_by_account,
submitted_at, reviewed_by, reviewed_at, review_comment

**管理员审核**：
- 通过 → 复制 handler.py 到 mcp-services/{mcp_path}/ + status=online + 清 mcp_loader 缓存
- 驳回 → status=rejected + review_comment

**前端改造**：
- 表格加列：版本号、维度、分类路径
- 操作：查看详情、审核(通过/驳回)、废弃
- 展开「提交记录」面板：申请时间 | 版本 | 提交智能体 | 申请人 | 状态 | 审核时间 | 审核人
- internal tab 去掉「新增」按钮
- external tab 保留新增入口

**关联需求**: REQ-011
**状态**: 方案已确认，待实施


### REQ-013: 系统 MCP — internal_skill_deploy（技能发布）

技能发布申请的系统 MCP。

**service_id**: system/internal_skill_deploy

**调用方式**：
```
mcp_call("internal_skill_deploy", {
    "category": "shop",
    "name": "platform_order"
})
```

**内部自动**：
① 扫描 workspace 技能文件（SKILL.md + scripts）
② 读技能元信息（frontmatter 等）
③ 查系统 skill 表，同 category + name 是否存在
④ 不存在 → INSERT（status=pending）  已存在 → INSERT 新版本记录（status=pending）

**审核互斥**：
- 提审前检查同一 skill 是否已有 pending 版本
- 已有 pending → 拒绝，提示等待审核

**功能**（两个 tool）：
- skill_submit → 扫描 workspace 技能文件 + 写发布记录（增/改）
- skill_status → 查询审核进度（辅助）

仅进程内调用，不暴露 HTTP。

**关联需求**: REQ-011
**状态**: 方案已确认，待实施

### REQ-007: 任务看板
基于现有「任务管理」板块升级为可视化看板。串行节点编排，按状态分列，workspace 隔离。统一 dispatch_jobs + agent_runs 为 task_nodes。
**状态**: 方案已确认，待实施

### 权限维度 — 删除关联检查（子需求）
删除维度时检查是否有 MCP 服务的 manifest.dimensions 引用了该维度，有则阻止删除或给出警告。当前只做了简单的 DIMENSION 表行删除，不处理关联数据。
**状态**: 待实施

### 权限维度 — 前端维度值预览
维度列表点击展开/弹窗显示 `GET /dimensions/{id}/values` 实际数据值。
**状态**: 待实施

### 权限维度 — _parse_dim_values 正则增强
当前 `_parse_dim_values()` 只支持 `IN (...)` 和 `= 'value'` 两种 where 格式。需扩展支持 `BETWEEN`、`LIKE`、`NOT IN`、多条件组合等更丰富的行权限表达式。
**状态**: 待实施

### hosted_coding 常驻实例
workspace 保持常驻运行，空闲 1h 自动停止。依赖 `workspace.hosted` 系统功能权限控制。
**状态**: 待实施

### 员工账号 scope 字段
员工账号表增加 `scope` 字段，控制账号可见的数据范围（如部门、区域等）。属于账号层字段，Agent 维度不关注此字段。
**状态**: 待讨论

### OA cookie 登录
同域 cookie 自动登录，oa_bindings 表维护 employee_id 映射。
**状态**: 待实施

### 技能审核 — 前端 UI（REQ-006 子需求）
后端 skill_candidates + review API 已就绪，前端 SkillsManagementPage 需增加「审核」tab，展示待审列表 + 通过/驳回操作。
**状态**: 待实施

---
### REQ-016: Workspace/Agent 概念统一

当前系统存在两套 ID 体系：`workspaces` 表（ws_xxx）和 `gateway_agents` 表（agt_xxx），逻辑冗余，概念混淆。统一为一个 Agent 概念。

**关联需求**: REQ-014（016 是 014 的前置基础）
**ID 前缀**: 统一为 agt_xxx
**状态**: 已完成 ✅

---

#### 合并后 agents 表

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| agent_id | TEXT | ws.workspace_id | 值重建为 agt_xxx |
| name | TEXT | ws.name | |
| agent_type | TEXT | ga.agent_type | 扩展用，当前 "coding-agent" |
| owner_account_id | TEXT | ws.owner_account_id | |
| tenant_id | TEXT | ws.tenant_id | |
| team_id | TEXT | ws.team_id | |
| root_path | TEXT | ws.root_path | 权威字段，ga.workspace_path 废弃 |
| visibility | TEXT | ws.visibility | |
| status | TEXT | ws/gb.status | 两表合并 |
| storage_quota_mb | INTEGER | ws.storage_quota_mb | |
| model_policy | TEXT | ws.model_policy | |
| category | TEXT | ws.category | |
| template_id | TEXT | ws.template_id | |
| key_id | TEXT | ga.key_id | |
| created_at | TEXT | ws.created_at | |
| updated_at | TEXT | ws.updated_at | |

**废弃字段**: ga.workspace_path（= root_path 冗余）、ga.agent_name（= name 冗余）

#### 关联表变更

| 旧表 | 新表 | 变更 |
|------|------|------|
| workspace_members | agent_members | workspace_id→agent_id |
| agent_bindings | 废弃 | 合入 agent_members（agent_id+account_id） |
| workspace_profiles | agent_profiles | workspace_id→agent_id |

#### 其他表 workspace_id 改名

| DB 文件 | 表 | 字段 |
|---------|----|------|
| claude_agent_runs.db | claude_agent_runs | workspace_id→agent_id |
| mcp_registry.db | agent_role_members | workspace_id→agent_id |
| mcp_registry.db | mcp_services | workspace_id→agent_id |
| mcp_registry.db | mcp_workspace_policies | workspace_id→agent_id，表名→agent_mcp_policies |
| mcp_registry.db | mcp_service_versions | submitted_by_workspace→submitted_by_agent_id |
| accounts.db | gateway_agents | 整表废弃，移入 agents |
| accounts.db | agent_bindings | 整表废弃，合入 agent_members |
| accounts.db | agent_identity_templates | has_workspace_dir→has_agent_dir；workspace_dir_root→agent_dir_root；workspace_dir_prefix→agent_dir_prefix |

#### DB 文件

- workspaces.db → agents.db（改名，路径从 `/app/data/workspaces.db` 改为 `/app/data/agents.db`）
- accounts.db 保留（仅剩 gateway_accounts + gateway_api_keys）

#### 配置变更

| 文件 | 变更 |
|------|------|
| docker-compose.yml | EVOTOWN_WORKSPACES_DIR→EVOTOWN_AGENTS_DIR，挂载路径 /app/data/workspaces→/app/data/agents |
| .env | EVOTOWN_WORKSPACES_HOST_DIR 对应调整 |

#### 后端文件清单（14 个）

| 文件 | 主要变更 |
|------|---------|
| infra/workspaces.py | 文件改名→agents.py；_ensure_conn 指向 agents.db；workspace_id→agent_id；全部函数/变量/类名重命名 |
| infra/accounts.py | 删除 gateway_agents 相关函数（create_agent/get_agent/list_agents/update_agent 等）；删除 agent_bindings 相关 |
| infra/claude_agent_runs.py | workspace_id→agent_id |
| infra/mcp_registry.py | workspace_id→agent_id；mcp_workspace_policies 表名改名 |
| infra/skill_market.py | workspace_id→agent_id |
| infra/hosted_workspace_engines.py | 文件名改名→hosted_agent_engines.py；workspace→agent |
| api/routers/coding_agent.py | workspace_id→agent_id；/api/v1/workspaces→/api/v1/agents；from infra.workspaces→from infra.agents |
| api/routers/accounts.py | 删除 create_agent/list_agents/get_agent/update_agent 等 gateway_agents 接口；agent_bindings 接口改为 agent_members |
| api/routers/console_auth.py | my-agents 去掉兼容映射，直接读 agents 表 |
| api/routers/mcp_services.py | workspace_id→agent_id；workspace→agent |
| services/claude_code_runner.py | workspace_id→agent_id；from infra.workspaces→from infra.agents |
| services/hosted_dispatch_worker.py | workspace_id→agent_id |
| services/mcp_system/internal_mcp_deploy/handler.py | workspace_id→agent_id |
| tests/*.py | 全部 workspace_id→agent_id |

#### 前端文件清单（14 个）

| 文件 | 主要变更 |
|------|---------|
| App.tsx | 路由 /workspaces→/agents；组件导入路径 |
| CodingAgentPage.tsx | workspace→agent；workspace_id→agent_id |
| CodingAgentWorkspacePage.tsx | 文件名改名→CodingAgentChatPage.tsx；workspace→agent |
| GatewayAccountsPanel.tsx | workspace→agent；agent_bindings→agent_members |
| AgentTemplatePanel.tsx | workspace→agent |
| AgentDetail.tsx | workspace→agent |
| DispatchPanel.tsx | workspace→agent |
| McpPanel.tsx | workspace→agent |
| RolePanel.tsx | workspace→agent |
| SkillsManagementPage.tsx | workspace→agent |
| FunctionListPanel.tsx | workspace→agent |
| LandingPage.tsx | workspace→agent；"我的智能体"→直接用 agents API |
| WorkspaceAgentProfilePanel.tsx | 文件名改名；workspace→agent |
| workspaceAgentPresets.ts | 文件名改名→agentPresets.ts |

#### console_auth 硬编码说明

`console_auth.py:238` 中 my-agents 接口为兼容前端，把 workspace 列表映射成 agent 格式时写了 `"agent_type": "coding-agent"` 硬编码。合并后 agents 表已有 agent_type 字段，这层映射直接去掉。

---

### REQ-014: MCP 调用 Agent 身份识别与权限注入

Agent 调用 MCP 时，后端需要知道是哪个 Agent 在调用，并基于 Agent 的身份解析权限维度值后传入 invoke_mcp。同时记录 MCP 调用审计。

**前置依赖**：REQ-015（agent_role_dimensions 表）✅ + REQ-016（统一 agent_id）✅

**现状**：MCP 调用走 HTTP（Claude Code SDK/CLI 子进程 → `POST /api/v1/mcp/{sid}`），`call_mcp` 端点已有 `token → agent_id → policies → permissions` 链路。全局 `ADMIN_TOKEN` 做 agent key，`mcp_usage_log` 仅记 service_id + 时间。

**改造项**：

1. **Agent 专属 key**：`gateway_sdk_env(agent_id)` 从 agents 表读 agent 自己的 evk_ key 注入子进程 env，替代全局 `EVOTOWN_CLAUDE_GATEWAY_API_KEY`（ADMIN_TOKEN）。权限解析链自然通（agent key 的 account_id = agent_id）。

2. **run_id 注入 MCP URL**：run 启动时将 run_id 拼入 MCP 工具定义的 URL：
   - CLI 模式：`call_endpoint = "/api/v1/mcp/{sid}?run_id={run_id}"`（AGENT_CONTEXT.md）
   - SDK 模式：`.mcp.json` 中 MCP server URL 同样拼接
   Claude Code 调 MCP 时自动携带，`call_mcp` 从 query param 读取。

3. **权限解析**：不需要改——token → identity["account_id"] = agent_id → `list_policies_for_agent` → `agent_role_dimensions` → permissions → `invoke_mcp`。

4. **MCP 审计**：扩展 `mcp_usage_log` 表（新增 run_id / agent_id / account_id / args / status / result 列）。`call_mcp` 通过 run_id 查 `claude_agent_runs` 获得 account_id，写入完整审计记录。一个 run 触发多次 MCP = 多条记录，通过 run_id 关联。

**改造文件**：
| 文件 | 改动 |
|------|------|
| `services/claude_agent_sdk_runner.py` | `gateway_sdk_env()` 加 `agent_id` 参数，从 agents 表读 key |
| `services/claude_code_runner.py` | `_cli_subprocess_env()` 传 agent_id；`_resolve_mcp_context()` / `_render_agent_context_md()` / `_write_context_files()` 拼 run_id 到 URL |
| `api/routers/mcp_services.py` | `call_mcp` 加 `run_id` 查询参数，审计写 mcp_usage_log |
| `infra/mcp_registry.py` | `mcp_usage_log` 表扩列 + `record_mcp_call` 扩展 |

**状态**: 方案已确认，待实施

---

## 待讨论

### REQ-001: Agent 执行过程实时可视化
发起长任务时展示具体过程、进度、大模型中间输出。后端在 run_events 中实时记录，前端 4 秒轮询展示。
**状态**: 待确认方案

### REQ-002: Web 交互页面 — 分享功能
用户生成的 Web 页面分享给其他账号。方案 A：文件复制到目标 workspace；方案 B：分享链接 + 临时 token。
**状态**: 待讨论

### REQ-003: Agent 产出物自动归类目录
Agent 产出按类型自动放入 workspace 子目录（downloads/、dashboard/ 等）。
**状态**: 待讨论

### REQ-004: Coding Agent 工作台页面整体重设计
重新规划工作台布局。方案 A（推荐）：左侧可折叠图标栏 + 聊天区全宽 + 右侧可折叠详情面板。
**状态**: 待讨论

### REQ-006: Skill 开发与管理体系

六大子方向，按三阶段实施。源码摸底已完成（2026-06-17），结论如下：

#### 源码现状

| 子方向 | 已有基础 | 缺什么 |
|--------|---------|--------|
| 声明式依赖 | SKILL.md frontmatter 仅 name/description/license；skills 表有 dependencies 字段但含义是技能间依赖，非 MCP/知识库声明 | requires_mcp / requires_knowledge 字段定义 + 注入逻辑 |
| SDK/脚手架 | skill-creator SKILL.md 有 init_skill.py / package_skill.py（仅在 arena_skills 内部）；skill_market.create_draft_skill() | 对话式技能创建流程：Agent 按模板生成 SKILL.md + scripts 到 workspace |
| 测试沙箱 | skill_market.trigger_skill_test() 可触发测试 run | 隔离沙箱（临时 workspace 创建/销毁） |
| 版本管理 | skills.version 字段 ✓；skill_versions 独立版本表 ✓（含 sha256/dependencies）；list_skill_versions() ✓ | workspace 版本锁定 / 回滚 / diff |
| 安全审核 | skill_candidates 表 + submit/review 流程 ✓；source_type 三分类 ✓ | 自动安全检查（脚本/MCP 权限扫描） |
| 市场分发 | visibility(company/team) ✓；skill_bundles ✓；download_count ✓；skill_catalog ✓ | 评分、一键安装 UI、部门可见性细粒度控制 |

#### 已确认方案

**技能下发更新策略**：
- 技能下发到 workspace 目录（非 CLI 调用），确保 Agent 能读写 workspace 文件
- 下发前检查 `.evotown/skills/{id}/.skill_hash.json`：
  - 不存在 → 首次安装，直接覆盖
  - 存在 → 对比当前文件 SHA256 vs 记录
    - 一致 → Agent 没改过，覆盖升级
    - 不一致 → Agent 改过，跳过不动
- 下发后重新计算所有文件 SHA256，写入 `.skill_hash.json`

**三阶段计划**：
1. Phase 1（本次）：声明式依赖 + 下发更新策略
2. Phase 2：测试沙箱 + 安全审核
3. Phase 3：版本锁定/回滚 + 市场分发

**状态**: 方案讨论中（声明式依赖已确认，待讨论具体字段格式；下发策略已确认；CLI/测试/版本/审核/市场待后续讨论）

### REQ-009: Agent 对话技能推荐弹窗
对话中提及技能但未触发调用时，弹窗提示确认是否使用。
**状态**: 待讨论

### REQ-017: Agent 运行环境隔离 — 防止绕过 MCP 权限

Agent 子进程与 backend 共享同一个 Python 环境和容器，可直接 `from infra.mcp_registry import ...` 绕过 HTTP MCP 端点和权限检查。mcp03 已验证此问题——agent 在 `mcp_tools: 0` 的情况下通过直接 import registry 函数成功提交了 MCP 发版。

**需讨论方案**：
- 方案 A：子进程用独立 venv/容器，切断 Python import 路径
- 方案 B：在 registry 关键函数入口加运行时调用者校验
- 方案 C：限制 agent workspace 的 Python path，阻止 import backend 模块
- 方案 D：其他

**状态**: 待讨论

### REQ-018: Agent run 状态判定优化 — 非致命错误不应标记为 failed

当前 Claude Code CLI 返回 exit_code≠0 即判定 run 为 `failed`。但很多场景下对话本身已完成，只是工具调用未成功（如无权限调 MCP）。应区分「对话失败」和「工具调用失败」，让 run 状态反映对话是否正常完成，工具调用错误仅记录在 events 中。

**状态**: 待讨论

---

## 远期（暂不实施）

### REQ-008: 任务节点并行
fork 拆分多 Agent 并行处理、batch 工作池抢占消费。

### REQ-010: 引擎模块功能重构
外部 Agent 通过 API key 直连时的注册、心跳、任务分发逻辑重新设计。

---

## 已实现

- Phase 1-6: Coding Agent 工作台交互区改造
- REQ-005: MCP 动态服务（角色体系 + system_functions + agent_role_functions + 三分类体系 + Tools 注入 + 前端 McpPanel 重写）
- 智能体分类重构（员工/部门/专属）+ 卡片新设计
- 门户首页"我的智能体"模块
- 数据库模块去 mcp_server_url + database.py 自动生成
- workspace 目录扁平化 + 中文名支持
- REQ-015: 角色绑定数据权限维度（agent_role_dimensions 新表 + CRUD + API + RolePanel「数据维度」tab）
