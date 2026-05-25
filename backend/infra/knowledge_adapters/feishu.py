"""Feishu (Lark) knowledge adapter."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from infra.knowledge_adapters.base import FetchedDocument, demo_documents


def _http_json(method: str, url: str, headers: dict[str, str] | None = None, body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _tenant_access_token(app_id: str, app_secret: str) -> str:
    payload = _http_json(
        "POST",
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        body={"app_id": app_id, "app_secret": app_secret},
    )
    token = payload.get("tenant_access_token")
    if not token:
        raise RuntimeError(payload.get("msg") or "failed to obtain feishu tenant_access_token")
    return str(token)


def _list_wiki_nodes(token: str, space_id: str) -> list[dict[str, Any]]:
    url = f"https://open.feishu.cn/open-apis/wiki/v2/spaces/{space_id}/nodes?page_size=50"
    headers = {"Authorization": f"Bearer {token}"}
    payload = _http_json("GET", url, headers=headers)
    data = payload.get("data") or {}
    items = data.get("items") or []
    return items if isinstance(items, list) else []


class FeishuKnowledgeAdapter:
    source_type = "feishu"

    def fetch_documents(self, config: dict[str, Any]) -> list[FetchedDocument]:
        source_name = str(config.get("name") or "飞书知识库")
        if config.get("demo") is True:
            return demo_documents("feishu", source_name)

        app_id = str(config.get("app_id") or "").strip()
        app_secret = str(config.get("app_secret") or "").strip()
        space_id = str(config.get("space_id") or "").strip()
        if not app_id or not app_secret or not space_id:
            return demo_documents("feishu", source_name)

        try:
            token = _tenant_access_token(app_id, app_secret)
            nodes = _list_wiki_nodes(token, space_id)
        except (urllib.error.URLError, RuntimeError, json.JSONDecodeError, KeyError):
            return demo_documents("feishu", source_name)

        docs: list[FetchedDocument] = []
        for node in nodes[:50]:
            node_token = str(node.get("node_token") or node.get("obj_token") or "")
            title = str(node.get("title") or node.get("name") or node_token or "Untitled")
            obj_type = str(node.get("obj_type") or "wiki")
            url = str(node.get("url") or f"https://feishu.cn/wiki/{node_token}")
            docs.append(
                FetchedDocument(
                    external_id=node_token or title,
                    title=title,
                    url=url,
                    space_name=f"飞书 · {space_id}",
                    content_text=f"{title}\n(obj_type={obj_type}, space_id={space_id})",
                    tags=["feishu", obj_type],
                    updated_at=str(node.get("obj_edit_time") or node.get("node_create_time") or ""),
                )
            )
        return docs or demo_documents("feishu", source_name)
