---
name: mcp-developer
description: 开发 Evotown MCP 动态服务的规范和指引。当 workspace 拥有 mcp.develop 权限时自动注入。用于约束智能体按标准生成 handler.py 和 manifest.json。
license: MIT
compatibility: Python 3.x
metadata:
  author: evotown
  version: "1.0"
  system: true
---

# MCP Developer Skill

本 skill 定义了开发 Evotown MCP 动态服务的规范。智能体必须严格遵守。

## 输出产物

智能体必须输出两个文件：

1. **mcp_manifest.json** — 服务声明
2. **mcp_handler.py** — 业务逻辑

文件放在 workspace 的 `.evotown/` 目录下。

## mcp_manifest.json 规范

```json
{
  "name": "服务名称",
  "description": "服务的功能描述",
  "dimensions": ["tenant_id"],
  "tables": ["orders"],
  "input": {
    "type": "object",
    "properties": {
      "arg1": { "type": "string", "description": "参数说明" }
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

字段说明：
- `name` / `description`: 必填
- `dimensions`: 该 MCP 需要哪些权限维度。只能引用 mcp-services/permissions.py 中 DIMENSIONS 的已注册维度
- `tables`: 涉及的数据表
- `input` / `output`: JSON Schema 格式的入参/出参定义。Agent 通过 GET /api/v1/mcp/tools 获取这些信息
- 如果 MCP 不涉及权限控制，`dimensions` 和 `tables` 都留空数组

## mcp_handler.py 规范

入口函数固定为：

```python
def process(args, permissions):
    """
    args:        调用者传入的参数（对应 manifest.input）
    permissions: 运行时注入的权限字典 {"维度名": ["值1","值2"]}
                 如果某个维度不在 permissions 中，说明是全量权限
    """
    return {"rows": [...], "total": 42}
```

## 数据库注入

mcp-services/database.py 已自动生成数据库连接函数，handler 内直接引入：

```python
from database import get_orders_db
conn = get_orders_db()
```

## 权限过滤

- 单表查询: 用 permissions 值拼接 WHERE 条件
- 聚合查询: 自己拼 SQL
- 全量权限: 维度 key 不在 permissions 中时，不过滤
- 无权限声明: dimensions 空，permissions 永远是空字典

```python
def process(args, permissions):
    tenant_ids = permissions.get("tenant_id", [])
    if tenant_ids:
        clause = f"tenant_id IN ({','.join(map(repr, tenant_ids))})"
    else:
        clause = "1=1"
    sql = f"SELECT * FROM orders WHERE {clause}"
```

## MCP 间互调

内部调用其他 MCP 使用 `mcp_call(service_id, args)` 函数：

```python
result = mcp_call("mcp_user_enrich", {"user_ids": [1, 2, 3]})
```

内部调用跳过权限校验，不需要传 permissions。

## 部署

开发完成后，管理员在 workspace 页面点击「部署 MCP」按钮，填写 service_id（仅允许 a-z 0-9 - _）。系统会自动：
1. 校验 manifest.dimensions 是否在已注册维度中
2. 将文件复制到 mcp-services/{service_id}/
3. 注册到 mcp_services 表
4. 重新生成 database.py
