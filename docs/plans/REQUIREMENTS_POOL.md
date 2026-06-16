# Evotown 需求池

> 记录待讨论、待实现的需求。确认方案后写入方案文件，按计划逐一实现。

---

## 待实施

### REQ-005: MCP 动态服务
详见 `spec/mcp-dynamic-services.md`。当前进度：
- ✅ 后端全部完成
- ✅ 前端：维度管理页、workspace 部署按钮、智能体分类重构
- ❌ 接口权限入口（角色/MCP 界面改版时统一讨论）
- ❌ MCP Tools 注入 Agent（已在需求池单列）

**MCP 分类体系**（已确认，待实施）：
- `system` — 系统内置 MCP（`backend/services/mcp_system/`），项目启动自动注册，不可编辑/删除
- `user` — 业务自定义 MCP（`mcp-services/{id}/`），智能体开发→部署
- `external` — 外部接入 MCP，管理员手动注册 URL
- `mcp_services.source` 字段已存在，需扩展为三值

**状态**: 实施中

### REQ-007: 任务看板
基于现有「任务管理」板块升级为可视化看板。串行节点编排，按状态分列，workspace 隔离。统一 dispatch_jobs + agent_runs 为 task_nodes。
**状态**: 方案已确认，待实施

### hosted_coding 常驻实例
workspace 保持常驻运行，空闲 1h 自动停止。依赖 `workspace.hosted` 系统功能权限控制。
**状态**: 待实施

### OA cookie 登录
同域 cookie 自动登录，oa_bindings 表维护 employee_id 映射。
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
Skill 声明式依赖（requires_mcp、requires_knowledge）、SDK/脚手架、测试环境、版本管理、安全审核、市场分发。
**状态**: 待讨论

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
- REQ-005: MCP 角色体系 + system_functions + agent_role_functions（REQ-005 前半部分）
- 智能体分类重构（员工/部门/专属）+ 卡片新设计
- 门户首页"我的智能体"模块
- 数据库模块去 mcp_server_url + database.py 自动生成
- workspace 目录扁平化 + 中文名支持
