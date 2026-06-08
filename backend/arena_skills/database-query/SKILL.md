---
name: database-query
description: 通过 Evotown Database MCP Proxy 对已注册的业务数据库执行只读 SQL 查询。当用户需要查 CRM、订单、报表等结构化数据时使用；禁止直连数据库或写入 SQL。
license: MIT
compatibility: Python 3.x，需网络访问 EVOTOWN_DB_MCP_URL（默认 http://localhost:9100）
metadata:
  author: evotown
  version: "1.0"
---

# Database Query Skill

通过 **Evotown Database MCP Proxy** 查询企业已注册数据库。Skill **不持有**连接串；权限由 Evotown ACL + Proxy 校验。

## 前置条件

1. 管理员在 Evotown 控制台注册数据库并配置 MCP 地址
2. 当前员工 API Key 已被授权访问目标 `connection_id`
3. MCP Proxy 服务已启动（`EVOTOWN_DB_MCP_URL`，默认 `http://localhost:9100`）

## 动作

| action | 说明 |
|--------|------|
| `list_connections` | 列出当前员工可访问的数据库 |
| `list_tables` | 列出某库的表 |
| `query` | 执行只读 SELECT（Proxy 自动加 LIMIT，拒绝 INSERT/UPDATE/DELETE） |

## 示例

### 列出可访问数据库

```json
{
  "action": "list_connections",
  "api_key": "evk_..."
}
```

### 查表

```json
{
  "action": "list_tables",
  "connection_id": "crm-demo",
  "api_key": "evk_..."
}
```

### 只读查询

```json
{
  "action": "query",
  "connection_id": "crm-demo",
  "sql": "SELECT id, name, amount FROM orders WHERE status = 'paid'",
  "api_key": "evk_..."
}
```

也可设置环境变量 `EVOTOWN_EMPLOYEE_API_KEY`，省略 `api_key` 字段。

## Runtime

```yaml
entry_point: scripts/main.py
language: python
network:
  enabled: true
  outbound:
    - "*:9100"
    - "*:8765"
input_schema:
  type: object
  properties:
    action:
      type: string
      enum: [list_connections, list_tables, query]
      default: query
    connection_id:
      type: string
      description: Evotown 注册的 connection_id
    sql:
      type: string
      description: 只读 SELECT / WITH / EXPLAIN 语句
    api_key:
      type: string
      description: 员工 evk_ API Key（可改用环境变量 EVOTOWN_EMPLOYEE_API_KEY）
  required: []
```
