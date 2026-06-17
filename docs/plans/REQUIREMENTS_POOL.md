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


### REQ-013: 系统 MCP — evotown-admin（技能管理）

Skill 生命周期管理的系统 MCP，供 skill-publisher Skill 调用。

**service_id**: system/evotown-admin
**功能**：
- skill_submit → 扫描 workspace 目录 + 打包 .skill + 版本递增 + 写入 skill_candidates 表
- skill_status → 查询审核进度
- skill_checkout → 拉取技能到 ws（含冲突检测、developed_by_workspace 锁）
- skill_release_lock → 管理员强制解锁
- dependency_check → 检查 requires_mcp / requires_knowledge 合法性
- 多 Agent 协调：developed_by_workspace_id 锁 + 版本冲突检测
- 仅进程内调用，不暴露 HTTP

**关联需求**: REQ-006、REQ-011
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

### OA cookie 登录
同域 cookie 自动登录，oa_bindings 表维护 employee_id 映射。
**状态**: 待实施

### 技能审核 — 前端 UI（REQ-006 子需求）
后端 skill_candidates + review API 已就绪，前端 SkillsManagementPage 需增加「审核」tab，展示待审列表 + 通过/驳回操作。
**状态**: 待实施

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
| SDK/脚手架 | skill-creator SKILL.md 有 init_skill.py / package_skill.py（仅在 arena_skills 内部）；skill_market.create_draft_skill() | CLI 工具：evotown skill create/validate/package |
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

**CLI 定位**：
- CLI = 开发期工具，给「人」用（非 Agent 运行时调用）
- 用途：创建/验证/打包技能，最终产物仍是 SKILL.md + scripts，下发到 workspace
- 不走纯 CLI 运行时调用（否则无法读 workspace 文件，限制太大）

**三阶段计划**：
1. Phase 1（本次）：声明式依赖 + 下发更新策略
2. Phase 2：测试沙箱 + 安全审核
3. Phase 3：版本锁定/回滚 + 市场分发

**状态**: 方案讨论中（声明式依赖已确认，待讨论具体字段格式；下发策略已确认；CLI/测试/版本/审核/市场待后续讨论）

### REQ-009: Agent 对话技能推荐弹窗
对话中提及技能但未触发调用时，弹窗提示确认是否使用。
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
