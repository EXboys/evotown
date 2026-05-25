# Knowledge connector architecture

## Decision

Evotown does not replace Feishu Wiki or Yuque. It provides a **Knowledge Connector layer** that:

1. Registers customer document sources (Feishu, Yuque, custom)
2. Syncs or ingests documents into a unified search index
3. Exposes search + citation metadata to Agent runtimes
4. Keeps audit evidence in the control plane (future: `knowledge.retrieved` run events)

## Layers

```text
Customer wiki (Feishu / Yuque / custom)
        ↓ adapter sync OR connector ingest
Evotown knowledge index (SQLite + FTS5)
        ↓ GET /api/v1/knowledge/search
Agent runtime (kb-search skill / MCP)
        ↓ run evidence
Evotown Runs / Chronicle
```

## Source types

| type | config keys | notes |
|------|-------------|-------|
| `feishu` | `app_id`, `app_secret`, `space_id`, optional `demo` | Uses Lark Open API; falls back to demo docs without credentials |
| `yuque` | `token`, `login`, `book`, optional `demo` | Uses Yuque Open API |
| `custom` | arbitrary | Documents pushed via connector ingest only |

## API

### Runtime / console read (`console.read`)

- `GET /api/v1/knowledge/stats`
- `GET /api/v1/knowledge/sources` — public metadata
- `GET /api/v1/knowledge/search?q=...`
- `GET /api/v1/knowledge/documents/{doc_id}`

### Admin (`console.write` / admin token)

- `GET /api/v1/knowledge/sources/manage`
- `POST /api/v1/knowledge/sources`
- `PUT /api/v1/knowledge/sources/{source_id}`
- `DELETE /api/v1/knowledge/sources/{source_id}`
- `POST /api/v1/knowledge/sources/{source_id}/sync`
- `GET /api/v1/knowledge/sources/{source_id}/sync-logs`
- `GET /api/v1/knowledge/documents`

### Connector ingest (`EVOTOWN_ENGINE_INGEST_TOKEN`)

- `POST /api/v1/knowledge/documents/ingest`

```json
{
  "source_id": "custom-crm",
  "documents": [
    {
      "external_id": "crm-pricing",
      "title": "CRM 定价策略",
      "url": "https://example.com/crm/pricing",
      "content_text": "...",
      "tags": ["crm"]
    }
  ]
}
```

## Non-goals (MVP)

- Full document editor inside Evotown
- Vector embedding / semantic search (FTS5 keyword search only for now)
- Fine-grained ACL mirroring Feishu/Yuque permissions (team_id filter only)
