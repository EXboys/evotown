"""Enterprise knowledge base persistence and search.

Knowledge sources (Feishu, Yuque, custom) sync into a local index for unified
search. Connectors may also push documents via ingest API.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Any

from domain.models import KnowledgeDocumentIngestItem, KnowledgeSourceCreate, KnowledgeSourceUpdate
from infra.knowledge_adapters import fetch_from_source

_backend_dir = Path(__file__).resolve().parent.parent
_evotown_data = _backend_dir.parent / "data"

_conn: sqlite3.Connection | None = None


def _data_dir() -> Path:
    default = _evotown_data if _evotown_data.is_dir() else _backend_dir / "data"
    return Path(os.environ.get("EVOTOWN_DATA_DIR", default))


def _ensure_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(data_dir / "knowledge.db"), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS knowledge_sources (
            source_id           TEXT PRIMARY KEY,
            source_type         TEXT NOT NULL,
            name                TEXT NOT NULL,
            tenant_id           TEXT NOT NULL DEFAULT '',
            team_id             TEXT NOT NULL DEFAULT '',
            config_json         TEXT NOT NULL DEFAULT '{}',
            status              TEXT NOT NULL DEFAULT 'active',
            last_sync_at        TEXT,
            last_sync_status    TEXT NOT NULL DEFAULT '',
            last_sync_message   TEXT NOT NULL DEFAULT '',
            document_count      INTEGER NOT NULL DEFAULT 0,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_sources_type ON knowledge_sources(source_type);
        CREATE INDEX IF NOT EXISTS idx_knowledge_sources_status ON knowledge_sources(status);

        CREATE TABLE IF NOT EXISTS knowledge_documents (
            doc_id              TEXT PRIMARY KEY,
            source_id           TEXT NOT NULL,
            external_id         TEXT NOT NULL,
            title               TEXT NOT NULL,
            url                 TEXT NOT NULL DEFAULT '',
            space_name          TEXT NOT NULL DEFAULT '',
            content_text        TEXT NOT NULL DEFAULT '',
            content_snippet     TEXT NOT NULL DEFAULT '',
            tags_json           TEXT NOT NULL DEFAULT '[]',
            team_id             TEXT NOT NULL DEFAULT '',
            status              TEXT NOT NULL DEFAULT 'active',
            updated_at_source   TEXT NOT NULL DEFAULT '',
            indexed_at          TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(source_id, external_id)
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_documents_source ON knowledge_documents(source_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_documents_status ON knowledge_documents(status);

        CREATE TABLE IF NOT EXISTS knowledge_sync_logs (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id           TEXT NOT NULL,
            status              TEXT NOT NULL,
            message             TEXT NOT NULL DEFAULT '',
            docs_added          INTEGER NOT NULL DEFAULT 0,
            docs_updated        INTEGER NOT NULL DEFAULT 0,
            started_at          TEXT NOT NULL DEFAULT (datetime('now')),
            finished_at         TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_sync_logs_source ON knowledge_sync_logs(source_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_documents_fts USING fts5(
            doc_id UNINDEXED,
            title,
            content_text,
            tokenize = 'unicode61'
        );
        """
    )
    _seed_defaults(conn)
    _conn = conn
    return conn


def _json_loads(raw: str, default: Any) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def _snippet(text: str, limit: int = 240) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1] + "…"


def _source_row(row: sqlite3.Row) -> dict[str, Any]:
    config = _json_loads(row["config_json"], {})
    return {
        "source_id": row["source_id"],
        "source_type": row["source_type"],
        "name": row["name"],
        "tenant_id": row["tenant_id"],
        "team_id": row["team_id"],
        "config": config,
        "status": row["status"],
        "last_sync_at": row["last_sync_at"],
        "last_sync_status": row["last_sync_status"],
        "last_sync_message": row["last_sync_message"],
        "document_count": row["document_count"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _document_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "doc_id": row["doc_id"],
        "source_id": row["source_id"],
        "external_id": row["external_id"],
        "title": row["title"],
        "url": row["url"],
        "space_name": row["space_name"],
        "content_text": row["content_text"],
        "snippet": row["content_snippet"],
        "tags": _json_loads(row["tags_json"], []),
        "team_id": row["team_id"],
        "status": row["status"],
        "updated_at_source": row["updated_at_source"],
        "indexed_at": row["indexed_at"],
    }


def _public_document(row: sqlite3.Row) -> dict[str, Any]:
    doc = _document_row(row)
    doc.pop("content_text", None)
    return doc


def _upsert_fts(conn: sqlite3.Connection, doc_id: str, title: str, content_text: str) -> None:
    conn.execute("DELETE FROM knowledge_documents_fts WHERE doc_id = ?", (doc_id,))
    conn.execute(
        "INSERT INTO knowledge_documents_fts(doc_id, title, content_text) VALUES (?, ?, ?)",
        (doc_id, title, content_text),
    )


def _seed_defaults(conn: sqlite3.Connection) -> None:
    count = conn.execute("SELECT COUNT(*) AS c FROM knowledge_sources").fetchone()["c"]
    if count:
        return
    for source_id, source_type, name in (
        ("feishu-demo", "feishu", "飞书知识库（Demo）"),
        ("yuque-demo", "yuque", "语雀知识库（Demo）"),
    ):
        conn.execute(
            """
            INSERT INTO knowledge_sources (
                source_id, source_type, name, tenant_id, team_id, config_json, status
            ) VALUES (?, ?, ?, 'demo', '', ?, 'active')
            """,
            (source_id, source_type, name, json.dumps({"demo": True, "name": name}, ensure_ascii=False)),
        )
    for source_id in ("feishu-demo", "yuque-demo"):
        row = conn.execute("SELECT * FROM knowledge_sources WHERE source_id = ?", (source_id,)).fetchone()
        if row is None:
            continue
        source = _source_row(row)
        config = dict(source["config"])
        config["name"] = source["name"]
        try:
            sync_source(source_id, conn=conn, prefetched=fetch_from_source(source["source_type"], config))
        except Exception:
            pass


def list_sources(*, status: str | None = None, source_type: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    clauses: list[str] = []
    params: list[Any] = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if source_type:
        clauses.append("source_type = ?")
        params.append(source_type)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    rows = conn.execute(
        f"SELECT * FROM knowledge_sources {where} ORDER BY updated_at DESC LIMIT ?",
        params,
    ).fetchall()
    return [_source_row(row) for row in rows]


def get_source(source_id: str) -> dict[str, Any] | None:
    conn = _ensure_conn()
    row = conn.execute("SELECT * FROM knowledge_sources WHERE source_id = ?", (source_id,)).fetchone()
    return _source_row(row) if row else None


def create_source(body: KnowledgeSourceCreate) -> dict[str, Any]:
    conn = _ensure_conn()
    config = dict(body.config)
    config.setdefault("name", body.name)
    conn.execute(
        """
        INSERT INTO knowledge_sources (
            source_id, source_type, name, tenant_id, team_id, config_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'active')
        """,
        (
            body.source_id,
            body.source_type,
            body.name,
            body.tenant_id,
            body.team_id,
            json.dumps(config, ensure_ascii=False),
        ),
    )
    return get_source(body.source_id) or {}


def update_source(source_id: str, body: KnowledgeSourceUpdate) -> dict[str, Any] | None:
    conn = _ensure_conn()
    existing = get_source(source_id)
    if existing is None:
        return None
    name = body.name if body.name is not None else existing["name"]
    tenant_id = body.tenant_id if body.tenant_id is not None else existing["tenant_id"]
    team_id = body.team_id if body.team_id is not None else existing["team_id"]
    status = body.status if body.status is not None else existing["status"]
    config = existing["config"]
    if body.config is not None:
        config = {**config, **body.config}
    config["name"] = name
    conn.execute(
        """
        UPDATE knowledge_sources
        SET name = ?, tenant_id = ?, team_id = ?, status = ?, config_json = ?, updated_at = datetime('now')
        WHERE source_id = ?
        """,
        (name, tenant_id, team_id, status, json.dumps(config, ensure_ascii=False), source_id),
    )
    return get_source(source_id)


def delete_source(source_id: str) -> bool:
    conn = _ensure_conn()
    docs = conn.execute("SELECT doc_id FROM knowledge_documents WHERE source_id = ?", (source_id,)).fetchall()
    for row in docs:
        conn.execute("DELETE FROM knowledge_documents_fts WHERE doc_id = ?", (row["doc_id"],))
    conn.execute("DELETE FROM knowledge_documents WHERE source_id = ?", (source_id,))
    conn.execute("DELETE FROM knowledge_sync_logs WHERE source_id = ?", (source_id,))
    cur = conn.execute("DELETE FROM knowledge_sources WHERE source_id = ?", (source_id,))
    return cur.rowcount > 0


def _upsert_document(
    conn: sqlite3.Connection,
    *,
    source_id: str,
    external_id: str,
    title: str,
    url: str,
    space_name: str,
    content_text: str,
    tags: list[str],
    team_id: str,
    updated_at_source: str,
) -> tuple[str, bool]:
    doc_id = f"{source_id}:{external_id}"
    snippet = _snippet(content_text)
    existing = conn.execute("SELECT doc_id FROM knowledge_documents WHERE doc_id = ?", (doc_id,)).fetchone()
    created = existing is None
    conn.execute(
        """
        INSERT INTO knowledge_documents (
            doc_id, source_id, external_id, title, url, space_name,
            content_text, content_snippet, tags_json, team_id, status,
            updated_at_source, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'))
        ON CONFLICT(doc_id) DO UPDATE SET
            title = excluded.title,
            url = excluded.url,
            space_name = excluded.space_name,
            content_text = excluded.content_text,
            content_snippet = excluded.content_snippet,
            tags_json = excluded.tags_json,
            team_id = excluded.team_id,
            status = 'active',
            updated_at_source = excluded.updated_at_source,
            indexed_at = datetime('now')
        """,
        (
            doc_id,
            source_id,
            external_id,
            title,
            url,
            space_name,
            content_text,
            snippet,
            json.dumps(tags, ensure_ascii=False),
            team_id,
            updated_at_source,
        ),
    )
    _upsert_fts(conn, doc_id, title, content_text)
    return doc_id, created


def ingest_documents(
    source_id: str,
    documents: list[KnowledgeDocumentIngestItem],
) -> dict[str, Any]:
    conn = _ensure_conn()
    source = get_source(source_id)
    if source is None:
        raise ValueError("source not found")
    added = 0
    updated = 0
    doc_ids: list[str] = []
    for item in documents:
        _, created = _upsert_document(
            conn,
            source_id=source_id,
            external_id=item.external_id,
            title=item.title,
            url=item.url,
            space_name=item.space_name or source["name"],
            content_text=item.content_text,
            tags=item.tags,
            team_id=item.team_id or source["team_id"],
            updated_at_source=item.updated_at_source,
        )
        doc_ids.append(f"{source_id}:{item.external_id}")
        if created:
            added += 1
        else:
            updated += 1
    count = conn.execute(
        "SELECT COUNT(*) AS c FROM knowledge_documents WHERE source_id = ? AND status = 'active'",
        (source_id,),
    ).fetchone()["c"]
    conn.execute(
        """
        UPDATE knowledge_sources
        SET document_count = ?, updated_at = datetime('now')
        WHERE source_id = ?
        """,
        (count, source_id),
    )
    return {"source_id": source_id, "added": added, "updated": updated, "document_ids": doc_ids}


def sync_source(
    source_id: str,
    *,
    conn: sqlite3.Connection | None = None,
    prefetched: list | None = None,
) -> dict[str, Any]:
    own_conn = conn is None
    conn = conn or _ensure_conn()
    source = get_source(source_id)
    if source is None:
        raise ValueError("source not found")
    if source["status"] != "active":
        raise ValueError("source is not active")

    log_id = conn.execute(
        "INSERT INTO knowledge_sync_logs(source_id, status, message) VALUES (?, 'running', 'sync started')",
        (source_id,),
    ).lastrowid

    added = 0
    updated = 0
    message = "sync completed"
    status = "succeeded"
    try:
        config = dict(source["config"])
        config["name"] = source["name"]
        fetched = prefetched if prefetched is not None else fetch_from_source(source["source_type"], config)
        for doc in fetched:
            _, created = _upsert_document(
                conn,
                source_id=source_id,
                external_id=doc.external_id,
                title=doc.title,
                url=doc.url,
                space_name=doc.space_name or source["name"],
                content_text=doc.content_text,
                tags=doc.tags,
                team_id=source["team_id"],
                updated_at_source=doc.updated_at,
            )
            if created:
                added += 1
            else:
                updated += 1
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM knowledge_documents WHERE source_id = ? AND status = 'active'",
            (source_id,),
        ).fetchone()["c"]
        conn.execute(
            """
            UPDATE knowledge_sources
            SET document_count = ?, last_sync_at = datetime('now'), last_sync_status = 'succeeded',
                last_sync_message = ?, updated_at = datetime('now')
            WHERE source_id = ?
            """,
            (count, message, source_id),
        )
    except Exception as exc:
        status = "failed"
        message = str(exc)
        conn.execute(
            """
            UPDATE knowledge_sources
            SET last_sync_at = datetime('now'), last_sync_status = 'failed',
                last_sync_message = ?, updated_at = datetime('now')
            WHERE source_id = ?
            """,
            (message, source_id),
        )
    conn.execute(
        """
        UPDATE knowledge_sync_logs
        SET status = ?, message = ?, docs_added = ?, docs_updated = ?, finished_at = datetime('now')
        WHERE id = ?
        """,
        (status, message, added, updated, log_id),
    )
    if own_conn:
        pass
    return {
        "source_id": source_id,
        "status": status,
        "message": message,
        "added": added,
        "updated": updated,
        "document_count": get_source(source_id)["document_count"] if get_source(source_id) else 0,
    }


def list_sync_logs(source_id: str, limit: int = 20) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    rows = conn.execute(
        """
        SELECT id, source_id, status, message, docs_added, docs_updated, started_at, finished_at
        FROM knowledge_sync_logs
        WHERE source_id = ?
        ORDER BY id DESC
        LIMIT ?
        """,
        (source_id, limit),
    ).fetchall()
    return [dict(row) for row in rows]


def list_documents(
    *,
    source_id: str | None = None,
    team_id: str | None = None,
    query: str | None = None,
    limit: int = 50,
    include_content: bool = False,
) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    clauses = ["d.status = 'active'"]
    params: list[Any] = []
    if source_id:
        clauses.append("d.source_id = ?")
        params.append(source_id)
    if team_id:
        clauses.append("(d.team_id = ? OR d.team_id = '')")
        params.append(team_id)
    if query and query.strip():
        q = query.strip()
        clauses.append("(d.title LIKE ? OR d.content_text LIKE ? OR d.content_snippet LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    params.append(limit)
    rows = conn.execute(
        f"""
        SELECT d.* FROM knowledge_documents d
        WHERE {' AND '.join(clauses)}
        ORDER BY d.indexed_at DESC
        LIMIT ?
        """,
        params,
    ).fetchall()
    if include_content:
        return [_document_row(row) for row in rows]
    return [_public_document(row) for row in rows]


def get_document(doc_id: str, *, include_content: bool = True) -> dict[str, Any] | None:
    conn = _ensure_conn()
    row = conn.execute("SELECT * FROM knowledge_documents WHERE doc_id = ?", (doc_id,)).fetchone()
    if row is None:
        return None
    if include_content:
        return _document_row(row)
    return _public_document(row)


def search_documents(
    *,
    query: str,
    source_type: str | None = None,
    source_id: str | None = None,
    team_id: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    q = query.strip()
    if not q:
        return list_documents(source_id=source_id, team_id=team_id, limit=limit)

    # Try FTS5 first; fall back to LIKE if FTS query fails.
    fts_query = " OR ".join(f'"{part}"' for part in q.split() if part.strip())
    params: list[Any] = [fts_query, limit]
    join_source = ""
    extra = ""
    if source_id:
        extra += " AND d.source_id = ?"
        params.insert(-1, source_id)
    if team_id:
        extra += " AND (d.team_id = ? OR d.team_id = '')"
        params.insert(-1, team_id)
    if source_type:
        join_source = "JOIN knowledge_sources s ON s.source_id = d.source_id"
        extra += " AND s.source_type = ? AND s.status = 'active'"
        params.insert(-1, source_type)

    try:
        rows = conn.execute(
            f"""
            SELECT d.*, bm25(knowledge_documents_fts) AS score
            FROM knowledge_documents_fts fts
            JOIN knowledge_documents d ON d.doc_id = fts.doc_id
            {join_source}
            WHERE knowledge_documents_fts MATCH ? AND d.status = 'active'{extra}
            ORDER BY score
            LIMIT ?
            """,
            params,
        ).fetchall()
        if rows:
            results = []
            for row in rows:
                doc = _public_document(row)
                doc["score"] = row["score"]
                doc["source_type"] = _source_type_for(conn, row["source_id"])
                results.append(doc)
            return results
    except sqlite3.OperationalError:
        pass

    return list_documents(source_id=source_id, team_id=team_id, query=q, limit=limit)


def _source_type_for(conn: sqlite3.Connection, source_id: str) -> str:
    row = conn.execute("SELECT source_type FROM knowledge_sources WHERE source_id = ?", (source_id,)).fetchone()
    return row["source_type"] if row else ""


def knowledge_stats() -> dict[str, Any]:
    conn = _ensure_conn()
    sources = conn.execute("SELECT COUNT(*) AS c FROM knowledge_sources WHERE status = 'active'").fetchone()["c"]
    documents = conn.execute("SELECT COUNT(*) AS c FROM knowledge_documents WHERE status = 'active'").fetchone()["c"]
    by_type_rows = conn.execute(
        """
        SELECT source_type, COUNT(*) AS c
        FROM knowledge_sources
        WHERE status = 'active'
        GROUP BY source_type
        """
    ).fetchall()
    return {
        "active_sources": sources,
        "indexed_documents": documents,
        "by_source_type": {row["source_type"]: row["c"] for row in by_type_rows},
    }
