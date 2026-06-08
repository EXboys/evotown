# Evotown Database MCP Proxy

独立服务：**真正连接**客户 PostgreSQL / MySQL / SQLite，执行只读 SQL。  
Evotown 只存配置与 ACL；Skill 只调本服务 HTTP API（或 stdio MCP）。

## 架构

```text
Skill (database-query)
    → HTTP Bearer evk_…
Database MCP Proxy (:9100)
    → GET Evotown /mcp/catalog（校验员工权限）
    → GET Evotown /mcp/{id}/resolve（拉连接串，需 EVOTOWN_DATABASE_MCP_TOKEN）
    → 连库执行 SELECT
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `EVOTOWN_BASE_URL` | Evotown 后端，默认 `http://localhost:8765` |
| `EVOTOWN_DATABASE_MCP_TOKEN` | 与 Evotown 后端相同，用于 resolve 凭证 |
| `DB_MCP_PORT` | 监听端口，默认 `9100` |
| `DB_MCP_MAX_ROWS` | 自动 LIMIT 上限，默认 `1000` |
| `EVOTOWN_EMPLOYEE_API_KEY` | stdio MCP 模式下的员工 Key |

## 本地启动

```bash
cd integrations/database-mcp-proxy
pip install -r requirements.txt

export EVOTOWN_BASE_URL=http://localhost:8765
export EVOTOWN_DATABASE_MCP_TOKEN=your-mcp-token   # 与 backend .env 一致

python run_http.py
# 健康检查: curl http://localhost:9100/health
```

## Docker Compose（可选 profile）

```bash
# .env 中设置 EVOTOWN_DATABASE_MCP_TOKEN
docker compose --profile db-mcp up -d --build
```

控制台注册数据库时，MCP 地址填：`http://localhost:9100`（宿主机）或 `http://db-mcp-proxy:9100`（容器内）。

## HTTP API

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/health` | 无 | 健康检查 |
| GET | `/catalog` | Bearer `evk_…` | 员工可见库列表 |
| GET | `/connections/{id}/tables` | Bearer `evk_…` | 列表 |
| POST | `/query` | Bearer `evk_…` | 只读 SQL，`{"connection_id","sql"}` |

## SkillLite Skill

使用 `backend/arena_skills/database-query`：

```json
{
  "action": "query",
  "connection_id": "crm-demo",
  "sql": "SELECT * FROM orders LIMIT 10",
  "api_key": "evk_..."
}
```

环境变量 `EVOTOWN_DB_MCP_URL` 指向 Proxy 地址。

## stdio MCP（Cursor / OpenClaw，可选）

```bash
pip install mcp
export EVOTOWN_EMPLOYEE_API_KEY=evk_...
python -m database_mcp_proxy.mcp_stdio
```

工具：`list_database_connections`、`list_database_tables`、`query_readonly`。

## 本地 SQLite Demo

```bash
sqlite3 /tmp/demo.db "CREATE TABLE orders(id INTEGER, amount REAL); INSERT INTO orders VALUES (1, 99.5);"
```

在 Evotown 控制台注册：

- connection_id: `demo-sqlite`
- db_type: `sqlite`
- config: `{"path": "/tmp/demo.db"}`（Proxy 进程能访问的路径）
- mcp_server_url: `http://localhost:9100`
- 给员工账号添加 grant
