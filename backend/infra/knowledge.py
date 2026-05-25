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

from domain.models import (
    KnowledgeDocumentIngestItem,
    KnowledgeFolderCreate,
    KnowledgeNativeDocCreate,
    KnowledgeNativeDocUpdate,
    KnowledgeNativeDocUpdate,
    KnowledgeSourceCreate,
    KnowledgeSourceUpdate,
    KnowledgeSpaceCreate,
)
from infra.knowledge_adapters import fetch_from_source
from infra.knowledge_chunks import chunk_row, delete_document_chunks, reindex_document_chunks

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

        CREATE TABLE IF NOT EXISTS knowledge_spaces (
            space_id            TEXT PRIMARY KEY,
            name                TEXT NOT NULL,
            description         TEXT NOT NULL DEFAULT '',
            team_id             TEXT NOT NULL DEFAULT '',
            source_id           TEXT NOT NULL,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS knowledge_folders (
            folder_id           TEXT PRIMARY KEY,
            space_id            TEXT NOT NULL,
            parent_folder_id    TEXT NOT NULL DEFAULT '',
            name                TEXT NOT NULL,
            sort_order          INTEGER NOT NULL DEFAULT 0,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(space_id, folder_id)
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_folders_space ON knowledge_folders(space_id);

        CREATE TABLE IF NOT EXISTS knowledge_chunks (
            chunk_id            TEXT PRIMARY KEY,
            doc_id              TEXT NOT NULL,
            chunk_index         INTEGER NOT NULL DEFAULT 0,
            heading             TEXT NOT NULL DEFAULT '',
            content             TEXT NOT NULL DEFAULT '',
            char_start          INTEGER NOT NULL DEFAULT 0,
            char_end            INTEGER NOT NULL DEFAULT 0,
            indexed_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
            chunk_id UNINDEXED,
            doc_id UNINDEXED,
            heading,
            content,
            tokenize = 'unicode61'
        );
        """
    )
    _migrate_native_schema(conn)
    _seed_defaults(conn)
    _conn = conn
    return conn


def _migrate_native_schema(conn: sqlite3.Connection) -> None:
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(knowledge_documents)").fetchall()}
    if "space_id" not in cols:
        conn.execute("ALTER TABLE knowledge_documents ADD COLUMN space_id TEXT NOT NULL DEFAULT ''")
    if "folder_id" not in cols:
        conn.execute("ALTER TABLE knowledge_documents ADD COLUMN folder_id TEXT NOT NULL DEFAULT ''")
    if "publish_status" not in cols:
        conn.execute("ALTER TABLE knowledge_documents ADD COLUMN publish_status TEXT NOT NULL DEFAULT 'published'")
    if "version" not in cols:
        conn.execute("ALTER TABLE knowledge_documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
    if "author" not in cols:
        conn.execute("ALTER TABLE knowledge_documents ADD COLUMN author TEXT NOT NULL DEFAULT ''")
    conn.execute(
        "UPDATE knowledge_documents SET publish_status = 'published' WHERE publish_status IS NULL OR publish_status = ''"
    )


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
        "space_id": row["space_id"] if "space_id" in row.keys() else "",
        "folder_id": row["folder_id"] if "folder_id" in row.keys() else "",
        "content_text": row["content_text"],
        "snippet": row["content_snippet"],
        "tags": _json_loads(row["tags_json"], []),
        "team_id": row["team_id"],
        "status": row["status"],
        "publish_status": row["publish_status"] if "publish_status" in row.keys() else "published",
        "version": row["version"] if "version" in row.keys() else 1,
        "author": row["author"] if "author" in row.keys() else "",
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
    if conn.execute("SELECT COUNT(*) AS c FROM knowledge_spaces").fetchone()["c"] == 0:
        try:
            create_space(
                KnowledgeSpaceCreate(
                    space_id="default",
                    name="Evotown 默认知识库",
                    description="平台自管 Markdown 文档空间",
                    team_id="",
                ),
                conn=conn,
            )
            create_native_doc(
                "default",
                KnowledgeNativeDocCreate(
                    slug="welcome",
                    title="欢迎使用 Evotown Native 知识库",
                    content_md=(
                        "# 欢迎使用 Evotown Native 知识库\n\n"
                        "在此编写企业内部 SOP、Runbook 与 Agent 参考文档。\n\n"
                        "## 检索\n\n"
                        "发布后文档会自动分块并进入统一检索索引，Agent 可通过 `/api/v1/knowledge/search` 获取 citation。\n"
                    ),
                    author="system",
                    publish_status="published",
                    tags=["native", "welcome"],
                ),
                conn=conn,
            )
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
        delete_document_chunks(conn, row["doc_id"])
        conn.execute("DELETE FROM knowledge_documents_fts WHERE doc_id = ?", (row["doc_id"],))
    conn.execute("DELETE FROM knowledge_documents WHERE source_id = ?", (source_id,))
    conn.execute("DELETE FROM knowledge_sync_logs WHERE source_id = ?", (source_id,))
    space = conn.execute("SELECT space_id FROM knowledge_spaces WHERE source_id = ?", (source_id,)).fetchone()
    if space is not None:
        conn.execute("DELETE FROM knowledge_folders WHERE space_id = ?", (space["space_id"],))
        conn.execute("DELETE FROM knowledge_spaces WHERE space_id = ?", (space["space_id"],))
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
    space_id: str = "",
    folder_id: str = "",
    publish_status: str = "published",
    version: int = 1,
    author: str = "",
) -> tuple[str, bool]:
    doc_id = f"{source_id}:{external_id}"
    snippet = _snippet(content_text)
    existing = conn.execute("SELECT doc_id, version FROM knowledge_documents WHERE doc_id = ?", (doc_id,)).fetchone()
    created = existing is None
    next_version = version if version > 1 or created else (int(existing["version"]) if existing else 1)
    conn.execute(
        """
        INSERT INTO knowledge_documents (
            doc_id, source_id, external_id, title, url, space_name,
            content_text, content_snippet, tags_json, team_id, status,
            updated_at_source, indexed_at, space_id, folder_id,
            publish_status, version, author
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), ?, ?, ?, ?, ?)
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
            indexed_at = datetime('now'),
            space_id = excluded.space_id,
            folder_id = excluded.folder_id,
            publish_status = excluded.publish_status,
            version = excluded.version,
            author = excluded.author
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
            space_id,
            folder_id,
            publish_status,
            next_version,
            author,
        ),
    )
    delete_document_chunks(conn, doc_id)
    conn.execute("DELETE FROM knowledge_documents_fts WHERE doc_id = ?", (doc_id,))
    if publish_status == "published":
        _upsert_fts(conn, doc_id, title, content_text)
        reindex_document_chunks(conn, doc_id, content_text)
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
    space_id: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    chunk_results = search_chunks(
        query=query,
        source_type=source_type,
        source_id=source_id,
        team_id=team_id,
        space_id=space_id,
        limit=limit,
    )
    if chunk_results:
        return chunk_results
    return list_documents(source_id=source_id, team_id=team_id, query=query, limit=limit)


def search_chunks(
    *,
    query: str,
    source_type: str | None = None,
    source_id: str | None = None,
    team_id: str | None = None,
    space_id: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    q = query.strip()
    if not q:
        return []

    fts_query = " OR ".join(f'"{part}"' for part in q.split() if part.strip())
    params: list[Any] = [fts_query, limit]
    join_source = "JOIN knowledge_documents d ON d.doc_id = c.doc_id"
    extra = " AND d.status = 'active' AND d.publish_status = 'published'"
    if source_id:
        extra += " AND d.source_id = ?"
        params.insert(-1, source_id)
    if space_id:
        extra += " AND d.space_id = ?"
        params.insert(-1, space_id)
    if team_id:
        extra += " AND (d.team_id = ? OR d.team_id = '')"
        params.insert(-1, team_id)
    if source_type:
        join_source += " JOIN knowledge_sources s ON s.source_id = d.source_id"
        extra += " AND s.source_type = ? AND s.status = 'active'"
        params.insert(-1, source_type)

    try:
        rows = conn.execute(
            f"""
            SELECT c.*, d.title AS doc_title, d.url, d.space_name, d.source_id, d.space_id, d.folder_id,
                   bm25(knowledge_chunks_fts) AS score
            FROM knowledge_chunks_fts fts
            JOIN knowledge_chunks c ON c.chunk_id = fts.chunk_id
            {join_source}
            WHERE knowledge_chunks_fts MATCH ?{extra}
            ORDER BY score
            LIMIT ?
            """,
            params,
        ).fetchall()
        if rows:
            results: list[dict[str, Any]] = []
            for row in rows:
                chunk = chunk_row(row)
                source_type_value = _source_type_for(conn, row["source_id"])
                citation = {
                    "doc_id": row["doc_id"],
                    "title": row["doc_title"],
                    "url": row["url"],
                    "space_name": row["space_name"],
                    "space_id": row["space_id"],
                    "folder_id": row["folder_id"],
                    "chunk_index": row["chunk_index"],
                    "heading": row["heading"],
                    "char_start": row["char_start"],
                    "char_end": row["char_end"],
                    "source_type": source_type_value,
                }
                results.append(
                    {
                        **chunk,
                        "title": row["doc_title"],
                        "url": row["url"],
                        "space_name": row["space_name"],
                        "space_id": row["space_id"],
                        "folder_id": row["folder_id"],
                        "source_id": row["source_id"],
                        "source_type": source_type_value,
                        "score": row["score"],
                        "result_type": "chunk",
                        "citation": citation,
                    }
                )
            return results
    except sqlite3.OperationalError:
        pass
    return []


def _source_type_for(conn: sqlite3.Connection, source_id: str) -> str:
    row = conn.execute("SELECT source_type FROM knowledge_sources WHERE source_id = ?", (source_id,)).fetchone()
    return row["source_type"] if row else ""


def _native_source_id(space_id: str) -> str:
    return f"native-{space_id}"


def _space_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "space_id": row["space_id"],
        "name": row["name"],
        "description": row["description"],
        "team_id": row["team_id"],
        "source_id": row["source_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _refresh_source_document_count(conn: sqlite3.Connection, source_id: str) -> None:
    count = conn.execute(
        "SELECT COUNT(*) AS c FROM knowledge_documents WHERE source_id = ? AND status = 'active'",
        (source_id,),
    ).fetchone()["c"]
    conn.execute(
        "UPDATE knowledge_sources SET document_count = ?, updated_at = datetime('now') WHERE source_id = ?",
        (count, source_id),
    )


def create_space(body: KnowledgeSpaceCreate, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    own = conn is None
    conn = conn or _ensure_conn()
    if conn.execute("SELECT space_id FROM knowledge_spaces WHERE space_id = ?", (body.space_id,)).fetchone():
        raise ValueError("space_id already exists")
    source_id = _native_source_id(body.space_id)
    conn.execute(
        """
        INSERT INTO knowledge_spaces (space_id, name, description, team_id, source_id)
        VALUES (?, ?, ?, ?, ?)
        """,
        (body.space_id, body.name, body.description, body.team_id, source_id),
    )
    conn.execute(
        """
        INSERT INTO knowledge_sources (
            source_id, source_type, name, tenant_id, team_id, config_json, status
        ) VALUES (?, 'native', ?, '', ?, ?, 'active')
        """,
        (source_id, body.name, body.team_id, json.dumps({"space_id": body.space_id}, ensure_ascii=False)),
    )
    if own:
        pass
    return get_space(body.space_id) or {}


def list_spaces(*, limit: int = 100) -> list[dict[str, Any]]:
    conn = _ensure_conn()
    rows = conn.execute(
        "SELECT * FROM knowledge_spaces ORDER BY updated_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [_space_row(row) for row in rows]


def get_space(space_id: str) -> dict[str, Any] | None:
    conn = _ensure_conn()
    row = conn.execute("SELECT * FROM knowledge_spaces WHERE space_id = ?", (space_id,)).fetchone()
    return _space_row(row) if row else None


def create_folder(space_id: str, body: KnowledgeFolderCreate) -> dict[str, Any]:
    conn = _ensure_conn()
    if get_space(space_id) is None:
        raise ValueError("space not found")
    if body.parent_folder_id:
        parent = conn.execute(
            "SELECT folder_id FROM knowledge_folders WHERE space_id = ? AND folder_id = ?",
            (space_id, body.parent_folder_id),
        ).fetchone()
        if parent is None:
            raise ValueError("parent folder not found")
    conn.execute(
        """
        INSERT INTO knowledge_folders (folder_id, space_id, parent_folder_id, name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(folder_id) DO UPDATE SET
            name = excluded.name,
            parent_folder_id = excluded.parent_folder_id
        """,
        (body.folder_id, space_id, body.parent_folder_id, body.name),
    )
    conn.execute("UPDATE knowledge_spaces SET updated_at = datetime('now') WHERE space_id = ?", (space_id,))
    row = conn.execute(
        "SELECT * FROM knowledge_folders WHERE space_id = ? AND folder_id = ?",
        (space_id, body.folder_id),
    ).fetchone()
    return dict(row) if row else {}


def create_native_doc(
    space_id: str,
    body: KnowledgeNativeDocCreate,
    *,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    own = conn is None
    conn = conn or _ensure_conn()
    space = get_space(space_id)
    if space is None:
        raise ValueError("space not found")
    if body.folder_id:
        folder = conn.execute(
            "SELECT folder_id FROM knowledge_folders WHERE space_id = ? AND folder_id = ?",
            (space_id, body.folder_id),
        ).fetchone()
        if folder is None:
            raise ValueError("folder not found")
    source_id = space["source_id"]
    doc_id, _ = _upsert_document(
        conn,
        source_id=source_id,
        external_id=body.slug,
        title=body.title,
        url=f"/knowledge/spaces/{space_id}/docs/{body.slug}",
        space_name=space["name"],
        content_text=body.content_md,
        tags=body.tags,
        team_id=space["team_id"],
        updated_at_source="",
        space_id=space_id,
        folder_id=body.folder_id,
        publish_status=body.publish_status,
        version=1,
        author=body.author,
    )
    _refresh_source_document_count(conn, source_id)
    conn.execute("UPDATE knowledge_spaces SET updated_at = datetime('now') WHERE space_id = ?", (space_id,))
    if own:
        pass
    doc = get_document(doc_id, include_content=True)
    return doc or {}


def update_native_doc(doc_id: str, body: KnowledgeNativeDocUpdate) -> dict[str, Any] | None:
    conn = _ensure_conn()
    existing = get_document(doc_id, include_content=True)
    if existing is None:
        return None
    source = get_source(existing["source_id"])
    if source is None or source["source_type"] != "native":
        raise ValueError("not a native document")
    space_id = existing.get("space_id") or ""
    if body.folder_id:
        folder = conn.execute(
            "SELECT folder_id FROM knowledge_folders WHERE space_id = ? AND folder_id = ?",
            (space_id, body.folder_id),
        ).fetchone()
        if folder is None:
            raise ValueError("folder not found")
    next_version = int(existing.get("version") or 1) + 1
    _upsert_document(
        conn,
        source_id=existing["source_id"],
        external_id=existing["external_id"],
        title=body.title if body.title is not None else existing["title"],
        url=existing["url"],
        space_name=existing["space_name"],
        content_text=body.content_md if body.content_md is not None else existing["content_text"],
        tags=body.tags if body.tags is not None else existing.get("tags", []),
        team_id=existing["team_id"],
        updated_at_source="",
        space_id=space_id,
        folder_id=body.folder_id if body.folder_id is not None else existing.get("folder_id", ""),
        publish_status=body.publish_status if body.publish_status is not None else existing.get("publish_status", "draft"),
        version=next_version,
        author=body.author if body.author is not None else existing.get("author", ""),
    )
    _refresh_source_document_count(conn, existing["source_id"])
    if space_id:
        conn.execute("UPDATE knowledge_spaces SET updated_at = datetime('now') WHERE space_id = ?", (space_id,))
    return get_document(doc_id, include_content=True)


def publish_native_doc(doc_id: str) -> dict[str, Any] | None:
    return update_native_doc(
        doc_id,
        KnowledgeNativeDocUpdate(publish_status="published"),
    )


def get_space_tree(space_id: str) -> dict[str, Any] | None:
    conn = _ensure_conn()
    space = get_space(space_id)
    if space is None:
        return None
    folders = [
        dict(row)
        for row in conn.execute(
            "SELECT folder_id, space_id, parent_folder_id, name, sort_order FROM knowledge_folders WHERE space_id = ? ORDER BY sort_order, name",
            (space_id,),
        ).fetchall()
    ]
    docs = [
        {
            "doc_id": row["doc_id"],
            "title": row["title"],
            "folder_id": row["folder_id"],
            "publish_status": row["publish_status"],
            "version": row["version"],
            "author": row["author"],
            "external_id": row["external_id"],
        }
        for row in conn.execute(
            """
            SELECT doc_id, title, folder_id, publish_status, version, author, external_id
            FROM knowledge_documents
            WHERE space_id = ? AND status = 'active'
            ORDER BY title
            """,
            (space_id,),
        ).fetchall()
    ]
    folder_map = {item["folder_id"]: {**item, "children": []} for item in folders}
    roots: list[dict[str, Any]] = []
    for item in folder_map.values():
        parent_id = item.get("parent_folder_id") or ""
        if parent_id and parent_id in folder_map:
            folder_map[parent_id]["children"].append(item)
        else:
            roots.append(item)
    return {"space": space, "folders": roots, "documents": docs}


def knowledge_stats() -> dict[str, Any]:
    conn = _ensure_conn()
    sources = conn.execute("SELECT COUNT(*) AS c FROM knowledge_sources WHERE status = 'active'").fetchone()["c"]
    documents = conn.execute("SELECT COUNT(*) AS c FROM knowledge_documents WHERE status = 'active'").fetchone()["c"]
    chunks = conn.execute("SELECT COUNT(*) AS c FROM knowledge_chunks").fetchone()["c"]
    spaces = conn.execute("SELECT COUNT(*) AS c FROM knowledge_spaces").fetchone()["c"]
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
        "indexed_chunks": chunks,
        "native_spaces": spaces,
        "by_source_type": {row["source_type"]: row["c"] for row in by_type_rows},
    }
