"""Pluggable knowledge source adapters."""
from __future__ import annotations

from typing import Any

from infra.knowledge_adapters.base import FetchedDocument, demo_documents
from infra.knowledge_adapters.feishu import FeishuKnowledgeAdapter
from infra.knowledge_adapters.yuque import YuqueKnowledgeAdapter

_ADAPTERS = {
    "feishu": FeishuKnowledgeAdapter(),
    "yuque": YuqueKnowledgeAdapter(),
}


def get_adapter(source_type: str):
    return _ADAPTERS.get(source_type)


def fetch_from_source(source_type: str, config: dict[str, Any]) -> list[FetchedDocument]:
    adapter = get_adapter(source_type)
    if adapter is None:
        if source_type == "custom":
            return demo_documents("custom", str(config.get("name") or "Custom"))
        raise ValueError(f"unsupported knowledge source type: {source_type}")
    return adapter.fetch_documents(config)
