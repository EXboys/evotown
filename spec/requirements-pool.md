# Evotown 需求池

## 待实施

### MCP 动态服务
详见 `spec/mcp-dynamic-services.md`

### hosted_coding 常驻实例
workspace 保持常驻运行，空闲 1h 自动停止。依赖 system_functions 中 `workspace.hosted` 权限控制。

### OA cookie 登录
同域 cookie 自动登录，oa_bindings 表维护 employee_id 映射。

## 待讨论

### MCP Tools 注入 Agent
MCP 注册/修改后，需要快速注入到所有关联 workspace 的 Agent（Claude Code SDK）上下文中，让 Agent 感知到新增/变更的 MCP 工具。

涉及：
- Agent 启动时的 tool 注册机制
- MCP 变更后的推送/失效通知
- 与 Claude Code SDK tool_use 的对接方式
