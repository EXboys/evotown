"""Yuque (语雀) knowledge adapter."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from infra.knowledge_adapters.base import FetchedDocument, demo_documents


def _http_json(method: str, url: str, headers: dict[str, str] | None = None) -> dict | list:
    req = urllib.request.Request(url, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fetch_doc_body(token: str, login: str, book: str, slug: str) -> str:
    url = f"https://www.yuque.com/api/v2/repos/{login}/{book}/docs/{slug}/body"
    headers = {"X-Auth-Token": token, "User-Agent": "Evotown-Knowledge-Connector/1.0"}
    payload = _http_json("GET", url, headers=headers)
    if isinstance(payload, dict):
        body = payload.get("data") or payload.get("body") or payload
        if isinstance(body, dict):
            return str(body.get("body") or body.get("content") or "")
        return str(body)
    return ""


class YuqueKnowledgeAdapter:
    source_type = "yuque"

    def fetch_documents(self, config: dict[str, Any]) -> list[FetchedDocument]:
        source_name = str(config.get("name") or "语雀知识库")
        if config.get("demo") is True:
            return demo_documents("yuque", source_name)

        token = str(config.get("token") or config.get("auth_token") or "").strip()
        login = str(config.get("login") or config.get("group") or "").strip()
        book = str(config.get("book") or config.get("repo") or "").strip()
        if not token or not login or not book:
            return demo_documents("yuque", source_name)

        try:
            url = f"https://www.yuque.com/api/v2/repos/{login}/{book}/docs"
            headers = {"X-Auth-Token": token, "User-Agent": "Evotown-Knowledge-Connector/1.0"}
            payload = _http_json("GET", url, headers=headers)
            items = payload.get("data") if isinstance(payload, dict) else payload
            if not isinstance(items, list):
                return demo_documents("yuque", source_name)
        except (urllib.error.URLError, json.JSONDecodeError, AttributeError):
            return demo_documents("yuque", source_name)

        docs: list[FetchedDocument] = []
        for item in items[:50]:
            if not isinstance(item, dict):
                continue
            slug = str(item.get("slug") or item.get("id") or "")
            title = str(item.get("title") or slug or "Untitled")
            doc_url = str(item.get("url") or f"https://www.yuque.com/{login}/{book}/{slug}")
            body = ""
            if slug:
                try:
                    body = _fetch_doc_body(token, login, book, slug)
                except (urllib.error.URLError, json.JSONDecodeError):
                    body = str(item.get("description") or "")
            if not body.strip():
                body = str(item.get("description") or title)
            docs.append(
                FetchedDocument(
                    external_id=str(item.get("id") or slug),
                    title=title,
                    url=doc_url,
                    space_name=f"语雀 · {login}/{book}",
                    content_text=body[:20000],
                    tags=["yuque", str(item.get("format") or "doc")],
                    updated_at=str(item.get("updated_at") or item.get("content_updated_at") or ""),
                )
            )
        return docs or demo_documents("yuque", source_name)
