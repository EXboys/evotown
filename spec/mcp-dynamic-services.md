# MCP 动态服务完整方案

## 一、目录结构

```
宿主机: /usr/local/agent-data/mcp-services/
容器内: /app/data/mcp-services/
       (docker-compose bind mount，与 workspaces 同级)

mcp-services/
  ├── database.py          ← 全局，系统自动生成（DB 连接函数）
  ├── permissions.py       ← 全局，系统自动生成（DIMENSIONS 维度注册）
  ├── mcp_a1b2c3/
  │   ├── manifest.json    ← 智能体声明
  │   └── handler.py       ← 智能体开发（唯一可执行文件）
  └── mcp_f7e8d9/
      ├── manifest.json
      └── handler.py
```

## 二、manifest.json 格式

```json
{
  "name": "订单查询",
  "description": "按条件查询订单，自动过滤租户权限",
  "dimensions": ["tenant_id"],
  "tables": ["orders"],
  "input": {
    "type": "object",
    "properties": {
      "status": { "type": "string", "description": "订单状态", "enum": ["paid", "pending", "cancelled"] },
      "date_from": { "type": "string", "description": "起始日期" }
    }
  },
  "output": {
    "type": "object",
    "properties": {
      "rows": { "type": "array" },
      "total": { "type": "integer" }
    }
  }
}
```

## 三、核心文件说明

| 文件 | 谁生成 | 何时更新 | 内容 |
|------|--------|---------|------|
| `database.py` | 系统 | DB 绑定变更时 | `get_xxx()` 连接函数 + `query_xxx(sql, tenant_ids)` 辅助 |
| `permissions.py` | 系统 | 维度增删时 | `DIMENSIONS = { "tenant_id": {"label":"租户","source_table":"orders_db.tenants","source_column":"id"}, ... }` |
| `manifest.json` | 智能体 | 部署时写入 | 声明 name/description/dimensions/tables/input/output |
| `handler.py` | 智能体 | 覆盖文件即热更新(mtime) | `def process(args, permissions) -> data` |

## 四、database.py 生成规则

- 遍历所有 active 的 database_connections
- 为每个生成 `get_{name}()` 连接函数（含密码，从 database_connections.config 读取）
- 生成 `query_{table}(sql, params, tenant_ids)` 辅助函数，用于单表自动注入 WHERE
- 生成 `from database import get_orders_db, query_orders` 给 handler 用

## 五、permissions.py 生成规则

- `DIMENSIONS` 字典，key=dim_id, value={label, source_table, source_column}
- source_table 格式: `db_conn.table_name`
- source_column: 下拉值的来源字段
- 由 `system_dimension_registry` 表驱动生成

## 六、handler.py 接口约定

```python
def process(args, permissions):
    """
    args:        dict, 调用者传入的参数 (对应 manifest.input)
    permissions: dict, 网关注入 { "tenant_id": ["team_a", "team_b"], "org_id": ["org_123"] }

    返回: dict | list, 业务数据 (对应 manifest.output)
    """
    # 简单查询
    rows = query_orders("SELECT * FROM orders WHERE status = %s",
                        [args["status"]],
                        tenant_ids=permissions.get("tenant_id", []))

    # 聚合查询
    ids = permissions.get("tenant_id", [])
    clause = f"tenant_id IN ({','.join(map(repr, ids))})"
    sql = f"SELECT month, SUM(amount) FROM orders WHERE {clause} GROUP BY month"

    # 调用其他 MCP（方法一：直接 import）
    # from mcp_f7e8d9.handler import process as enrich
    # result = enrich({"key": "value"}, {})

    # 调用其他 MCP（方法二：mcp_call 工具函数，推荐）
    # result = mcp_call("mcp_f7e8d9", {"key": "value"})

    return {"rows": [...], "total": 42}
```

## 七、MCP 间互相调用

- 内部调用不走 HTTP，走 Python import
- 提供 `mcp_call(service_id, args)` 工具函数
- `mcp_call` 实现：importlib 加载目标 handler → 传空 permissions（内部信任）→ handler.process(args, {})
- 调用链：handler A → mcp_call("mcp_B") → importlib 加载 B → B.process()

## 八、数据库表

### 已有表改动

```
mcp_services 加字段:
  manifest       TEXT NOT NULL DEFAULT '{}'   ← JSON, manifest.json 内容
  workspace_id   TEXT NOT NULL DEFAULT ''     ← 归属的 workspace
```

### 新增表

```sql
CREATE TABLE system_dimension_registry (
    dim_id               TEXT PRIMARY KEY,
    label                TEXT NOT NULL,        -- 显示名, 如"租户"
    db_connection_id     TEXT NOT NULL,        -- 关联 database_connections.connection_id
    table_name           TEXT NOT NULL,        -- 数据源表, 如"tenants"
    column_name          TEXT NOT NULL,        -- 数据源字段, 如"id"
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## 九、API

### 新增

```
POST   /api/v1/mcp/{service_id}              ← Agent 调用 MCP
GET    /api/v1/mcp/tools                      ← Agent 发现 MCP (Anthropic Tool Use 格式)
       /api/v1/mcp/tools/openai               ← 未来: OpenAI function_call 格式
       /api/v1/mcp/tools/mcp                  ← 未来: MCP 标准 tools/list 格式
GET    /api/v1/dimensions                      ← 维度列表 (admin)
POST   /api/v1/dimensions                      ← 新增维度 (admin)
DELETE  /api/v1/dimensions/{dim_id}            ← 删除维度 (admin)
GET    /api/v1/dimensions/{dim_id}/values      ← 维度值下拉 (admin, 查实际数据)
POST   /api/v1/mcp-deploy                      ← 部署 MCP (admin, 从 workspace 部署到 mcp-services/)
```

### 修改

```
GET    /api/v1/mcp/tools                       ← 替代旧 GET /api/v1/workspaces/{id}/mcp
POST   /api/v1/mcp-services                     ← 注册时可带 manifest
```

### 界面重构

```
McpPanel「智能体角色」tab                        ← 现有界面基于旧模型，需按新方案重做
  旧: 启用开关 + row_rules 文本输入框
  新: 按 MCP manifest.dimensions 自动展示维度，每维度下拉选值 + 全选
```

### 弃用

```
GET    /api/v1/workspaces/{id}/mcp              ← 被 /api/v1/mcp/tools 替代，保留兼容
```

## 十、GET /api/v1/mcp/tools — Agent 发现入口

### 格式: Anthropic Tool Use

从 Token 解析 workspace_id，返回该 workspace 有权访问的所有 MCP，格式为 Claude Code SDK 原生 tool_use：

```json
{
  "tools": [
    {
      "name": "mcp_order_query",
      "description": "按条件查询订单，自动过滤租户权限",
      "input_schema": {
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "enum": ["paid", "pending", "cancelled"],
            "description": "订单状态"
          },
          "date_from": {
            "type": "string",
            "description": "起始日期"
          }
        }
      }
    }
  ]
}
```

### 数据来源

```
manifest.json → 系统生成 Anthropic Tool Use 格式
  name:         service_id 转 tool name (mcp_a1b2c3 → mcp_order_query)
  description:  manifest.description
  input_schema: manifest.input
  execute:      POST /api/v1/mcp/{service_id} (后端代理，不暴露给 Agent)
```

### 多 Agent 扩展

内部只有一份 manifest.json，对外按需转换：

```
GET /api/v1/mcp/tools          ← Anthropic Tool Use (当前实现)
GET /api/v1/mcp/tools/openai   ← 未来: OpenAI function_call 格式
GET /api/v1/mcp/tools/mcp      ← 未来: MCP 标准 tools/list 格式
```

不改 manifest，不改 handler，加转换路由即可。

## 十一、POST /api/v1/mcp/{service_id} 网关路由

```
① Token → workspace_id
   复用 require_console_read 认证

② service_id → 查 mcp_services 获取 manifest

③ 权限解析
   workspace_id → roles → agent_role_mcp_policies
   按 manifest.dimensions 过滤
   解析 row_rules → 结构化 permissions
   维度值 = "*" → 不加入 permissions（handler 判断 key 不存在即全量）

④ 热加载 handler
   importlib.util 从 mcp-services/{id}/handler.py 加载
   mtime 缓存 → 文件更新自动热重载

⑤ 执行
   result = handler.process(args, permissions)

⑥ 包装输出
   success → { "ok": true, "data": result, "error": null }   (200)
   handler 内业务错误 → handler 自己 return { "error": "..." }
   权限不足 → { "ok": false, "data": null, "error": "..." }  (403)
```

## 十二、部署流程

```
1. 管理员在 workspace 内自然语言开发 MCP
2. 智能体生成:
   ├── manifest.json  (声明权限维度 + input/output)
   └── handler.py     (业务逻辑)
3. 管理员点 [部署]
4. 系统校验:
   ├── manifest.dimensions 的每一项必须在 permissions.py 的 DIMENSIONS 中
   │   (不在 → 拒绝，提示先注册维度)
   └── dimensions + tables 全空 → 提醒"此 MCP 为开放权限，无访问控制"
5. 管理员填写 service_id（仅允许 URL 合法字符: a-z 0-9 - _），写入 mcp-services/{service_id}/
6. 注册到 mcp_services 表 (service_id, name, manifest, workspace_id)
7. status → active
```

## 十三、权限维度管理流程

```
1. 管理员在维度管理页新增维度
   填写 dim_id, label, db_connection, table_name, column_name
   → 写入 system_dimension_registry

2. 保存后系统自动 regenerate_permissions.py
   → mcp-services/permissions.py 更新

3. 管理员在 MCP 服务管理页（McpPanel）
   展开某个 MCP 服务 → 「智能体角色」tab → 选一个角色
   → 该 MCP 的 manifest.dimensions 声明的维度自动展示
   → 每个维度根据 permissions.py 的 source_table 读取实际数据值，提供下拉+全选
   → 选值保存 → 写入 agent_role_mcp_policies.row_rules

4. 网关解析 permissions 时
   维度值 = "*"  → permissions 中不包含该维度（handler 判断 key 不存在即全量）
   维度值 = 具体值 → permissions["维度名"] = ["值1","值2"]
```

## 十四、统一输出格式

```json
成功:
{ "ok": true,  "data": { "行": [...], "total": 42 }, "error": null }

handler 业务错误:
{ "ok": false, "data": null, "error": "查询超时" }

认证/权限:
{ "ok": false, "data": null, "error": "权限不足，缺少 tenant_id 维度" }
(HTTP 401/403)
```

## 十五、mcp_call 内部互调

```python
# 工具函数，注入 handler 加载环境
def mcp_call(service_id, args):
    # 内部调用，跳过权限校验
    handler = get_handler(service_id)
    return handler.process(args, {})
```

Handler 内使用:
```python
result = mcp_call("mcp_f7e8d9", {"user_id": 123})
```

## 十六、mcp-developer skill（系统内置）

### 定位
- 类型：arena_skill，系统内置，不可删除
- 触发：workspace 所属 role 含 `mcp.develop` 功能时自动注入 Agent 上下文
- 作用：约束智能体按规范生成 MCP handler + manifest

### 规范要点

**产物**：智能体必须输出 `manifest.json` + `handler.py` 两个文件。

**handler.py 约定**：
- 入口函数固定 `def process(args, permissions)`
- `args` 是调用者传入的参数
- `permissions` 是网关运行时注入的权限字典 `{ "维度名": ["值1","值2"] }`
- handler 内用 permissions 值做数据过滤
- 单表查询可用 `database.py` 的 helper
- 聚合/复杂查询自己拼 WHERE
- 调用其他 MCP 用 `mcp_call(service_id, args)`

**manifest.json 约定**：
- `name`、`description`、`input`、`output` 必填
- `dimensions` 只能引用 `permissions.py` 的 `DIMENSIONS` 中已注册维度
- 无权限需求时 dimensions + tables 全空

**数据库注入**：`database.py` 自动生成，直接用 `from database import get_xxx_db`

**权限声明**：manifest.dimensions 决定网关注入哪些维度的权限值

### 注入机制

Agent 启动 / 对话时，检测 workspace 的 func 列表是否含 `mcp.develop`，有则自动附加 `mcp-developer` skill 的指引段落到 system prompt。

## 十七、实施清单

| # | 改动 | 文件 |
|---|------|------|
| 1 | `mcp_services` 加 `manifest` + `workspace_id` 字段 | backend/infra/mcp_registry.py |
| 2 | 新增 `system_dimension_registry` 表 + CRUD | backend/infra/ 新文件 或 mcp_registry.py |
| 3 | 维度 CRUD API + 值查询 API | backend/api/routers/mcp_services.py |
| 4 | `database.py` 自动生成逻辑 | backend/services/ 新文件 |
| 5 | `permissions.py` 自动生成逻辑 | backend/services/ 新文件 |
| 6 | `POST /api/v1/mcp/{id}` 网关路由（含 importlib 热加载器） | backend/api/routers/mcp_services.py + services/mcp_loader.py |
| 7 | `mcp_call` 工具函数 | 加载器同文件 |
| 8 | `GET /api/v1/mcp/tools` Agent 发现入口（Anthropic Tool Use） | backend/api/routers/mcp_services.py |
| 9 | MCP 部署 API (从 workspace 复制到 mcp-services/) | backend/api/routers/mcp_services.py |
| 10 | arena_skill: `mcp-developer`（系统内置，智能体开发 MCP 规范） | backend/arena_skills/mcp-developer/SKILL.md |
| 11 | 前端：维度管理页 | frontend/src/components/ 新文件 |
| 12 | 前端：MCP 权限配置页（维度下拉选值） | frontend/src/components/McpPanel.tsx 扩展 |
| 13 | 前端：workspace 内 [部署 MCP] 按钮 | frontend/src/components/CodingAgentWorkspacePage.tsx |
| 14 | 前端：EnterpriseConsole 路由集成 | EnterpriseConsole.tsx + App.tsx |
| 15 | 部署校验 (manifest ⊆ permissions) | 后端部署 API |
| 16 | 无权限声明提醒 | 后端 + 前端 |
| 17 | `mcp-developer` skill 自动注入：workspace 含 `mcp.develop` 时注入 context | claude_code_runner 或 agent 上下文构建 |
| 18 | mcp-services/ 目录挂载 | docker-compose.yml |

