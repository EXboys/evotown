# Database connector architecture

## Decision

Evotown does **not** execute SQL against customer business databases. It provides a **Database Connector layer** that:

1. Registers database connection metadata (host, credentials, MCP endpoint)
2. Defines employee / org / team access grants
3. Exposes a catalog API for runtimes and MCP proxies
4. Resolves full credentials only for trusted MCP proxy services

Skills and agent runtimes must call **MCP database tools**, never hold connection strings.

## Layers

```text
Admin registers DB in Evotown console
        ↓ metadata + ACL in database_registry.db
MCP Database Proxy (per DB or shared)
        ↓ pulls credentials via EVOTOWN_DATABASE_MCP_TOKEN
        ↓ enforces grants + read/write limits
Agent skill / runtime
        ↓ MCP tools: list_tables, query_readonly, …
Evotown audit (future: database.query run events)
```

## Evotown responsibilities

- Store connection registry (`database_connections`)
- Store access grants (`database_access_grants`)
- Mask passwords in console API responses
- Never run customer SQL in the control plane

## MCP proxy responsibilities

- Hold outbound network access to customer DBs
- Authenticate callers (employee API key → Evotown `/mcp/catalog`)
- Resolve credentials via `GET /api/v1/databases/mcp/{connection_id}/resolve`
- Enforce SQL safety (read-only role, row limits, statement allowlist)
- Emit audit events back to Evotown ingest (future)

## Access grant model

| field | values |
|-------|--------|
| `principal_type` | `account`, `org`, `team` |
| `principal_id` | `acc_…`, `org_…`, team id |
| `permission` | `read`, `write`, `admin` |

Matching: caller identity from gateway API key (`account_id`, `org_id`) is checked against grants; highest permission wins.

## API

### Console admin (`X-Admin-Token` / `console.write`)

- `GET /api/v1/databases/stats`
- `GET /api/v1/databases/manage`
- `POST /api/v1/databases`
- `PUT /api/v1/databases/{connection_id}`
- `DELETE /api/v1/databases/{connection_id}`
- `GET /api/v1/databases/grants/manage`
- `POST /api/v1/databases/grants`
- `DELETE /api/v1/databases/grants/{grant_id}`
- `POST /api/v1/databases/test-config` — admin draft config ping (`SELECT 1` + optional MCP `/health`)
- `POST /api/v1/databases/{connection_id}/test` — admin test saved connection

### Runtime / employee (`Bearer evk_…` with `console.read`)

- `GET /api/v1/databases/accessible` — databases this key may use (no credentials)
- `GET /api/v1/databases/mcp/catalog` — same, for MCP bootstrap

### MCP proxy service (`Bearer EVOTOWN_DATABASE_MCP_TOKEN`)

- `GET /api/v1/databases/mcp/{connection_id}/resolve` — full config including password

### Database MCP Proxy (HTTP, port 9100)

Deploy from `integrations/database-mcp-proxy`. Skill / runtime calls Proxy; Proxy calls Evotown + DB.

- `GET /health`
- `GET /catalog` — Bearer employee `evk_…`
- `GET /connections/{connection_id}/tables`
- `POST /query` — `{"connection_id","sql"}` read-only

Skill: `backend/arena_skills/database-query`

## Config shape

```json
{
  "connection_id": "crm-prod",
  "name": "CRM Production",
  "db_type": "postgres",
  "mcp_server_url": "http://db-mcp.internal:9100/crm-prod",
  "config": {
    "host": "crm-db.internal",
    "port": 5432,
    "database": "crm",
    "username": "agent_readonly",
    "password": "…"
  }
}
```

## Non-goals (MVP)

- Evotown executing SQL directly
- Skills embedding connection strings
- Fine-grained table/column ACL (defer to MCP proxy or DB roles)
- Automatic MCP server provisioning

## Environment

| variable | purpose |
|----------|---------|
| `EVOTOWN_DATABASE_MCP_TOKEN` | Shared secret for MCP proxy credential resolve |

## Relation to policy center

Default policy `tool-allowlist` denies `raw_sql_exec`. Database access should flow only through registered MCP servers listed in connector config.
