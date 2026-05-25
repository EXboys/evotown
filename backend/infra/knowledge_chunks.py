"""Document chunking and chunk-level FTS index."""
from __future__ import annotations

import re
import sqlite3
from typing import Any


def _snippet(text: str, limit: int = 280) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1] + "…"


def split_into_chunks(content_text: str, *, max_chars: int = 900) -> list[dict[str, Any]]:
    """Split markdown/plain text into citation-friendly chunks."""
    text = content_text.strip()
    if not text:
        return []

    sections: list[tuple[str, str]] = []
    current_heading = ""
    buffer: list[str] = []

    for line in text.splitlines():
        if re.match(r"^#{1,6}\s+", line):
            if buffer:
                sections.append((current_heading, "\n".join(buffer).strip()))
                buffer = []
            current_heading = line.lstrip("#").strip()
            buffer.append(line)
        else:
            buffer.append(line)
    if buffer:
        sections.append((current_heading, "\n".join(buffer).strip()))

    if not sections:
        sections = [("", text)]

    chunks: list[dict[str, Any]] = []
    for heading, body in sections:
        if not body:
            continue
        if len(body) <= max_chars:
            chunks.append({"heading": heading, "content": body})
            continue
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
        part: list[str] = []
        part_len = 0
        for para in paragraphs:
            if part_len + len(para) + 2 > max_chars and part:
                chunks.append({"heading": heading, "content": "\n\n".join(part)})
                part = [para]
                part_len = len(para)
            else:
                part.append(para)
                part_len += len(para) + 2
        if part:
            chunks.append({"heading": heading, "content": "\n\n".join(part)})

    if not chunks:
        chunks = [{"heading": "", "content": text}]
    return chunks


def reindex_document_chunks(conn: sqlite3.Connection, doc_id: str, content_text: str) -> int:
    conn.execute("DELETE FROM knowledge_chunks WHERE doc_id = ?", (doc_id,))
    conn.execute("DELETE FROM knowledge_chunks_fts WHERE doc_id = ?", (doc_id,))

    offset = 0
    count = 0
    for index, chunk in enumerate(split_into_chunks(content_text)):
        body = chunk["content"]
        if not body.strip():
            continue
        chunk_id = f"{doc_id}#chunk-{index}"
        char_start = offset
        char_end = char_start + len(body)
        offset = char_end + 1
        conn.execute(
            """
            INSERT INTO knowledge_chunks (
                chunk_id, doc_id, chunk_index, heading, content, char_start, char_end
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (chunk_id, doc_id, index, chunk.get("heading") or "", body, char_start, char_end),
        )
        conn.execute(
            "INSERT INTO knowledge_chunks_fts(chunk_id, doc_id, heading, content) VALUES (?, ?, ?, ?)",
            (chunk_id, doc_id, chunk.get("heading") or "", body),
        )
        count += 1
    return count


def delete_document_chunks(conn: sqlite3.Connection, doc_id: str) -> None:
    conn.execute("DELETE FROM knowledge_chunks_fts WHERE doc_id = ?", (doc_id,))
    conn.execute("DELETE FROM knowledge_chunks WHERE doc_id = ?", (doc_id,))


def chunk_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "chunk_id": row["chunk_id"],
        "doc_id": row["doc_id"],
        "chunk_index": row["chunk_index"],
        "heading": row["heading"],
        "snippet": _snippet(row["content"]),
        "char_start": row["char_start"],
        "char_end": row["char_end"],
    }
