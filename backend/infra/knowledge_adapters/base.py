"""Knowledge source connector adapters."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class FetchedDocument:
    external_id: str
    title: str
    url: str
    content_text: str
    space_name: str = ""
    tags: list[str] = field(default_factory=list)
    updated_at: str = ""


class KnowledgeAdapter(Protocol):
    source_type: str

    def fetch_documents(self, config: dict[str, Any]) -> list[FetchedDocument]:
        """Pull documents from the upstream knowledge system."""


def demo_documents(source_type: str, source_name: str) -> list[FetchedDocument]:
    """Seed/demo content when credentials are missing or demo mode is enabled."""
    if source_type == "feishu":
        return [
            FetchedDocument(
                external_id="feishu-demo-onboarding",
                title="新员工 Agent 使用指南",
                url="https://example.feishu.cn/wiki/demo-onboarding",
                space_name="飞书知识库 · 人事",
                content_text=(
                    "Evotown 企业 Agent 平台 onboarding：\n"
                    "1. 在控制台注册账号并获取 API Key。\n"
                    "2. 从 Skills 市场安装 bootstrap bundle。\n"
                    "3. 通过知识库检索 skill 查询公司内部 SOP。\n"
                    "4. 所有 run 可在 Runs 页面审计。"
                ),
                tags=["onboarding", "hr", "agent"],
            ),
            FetchedDocument(
                external_id="feishu-demo-security",
                title="数据安全与密钥管理规范",
                url="https://example.feishu.cn/wiki/demo-security",
                space_name="飞书知识库 · 安全",
                content_text=(
                    "禁止在 Agent prompt 中明文粘贴生产密钥。\n"
                    "Connector 上报前必须 redact secrets。\n"
                    "下载 Skills 需 console.read 权限。"
                ),
                tags=["security", "policy"],
            ),
        ]
    if source_type == "yuque":
        return [
            FetchedDocument(
                external_id="yuque-demo-api",
                title="内部 API 接入说明",
                url="https://www.yuque.com/demo/api-guide",
                space_name=f"语雀 · {source_name}",
                content_text=(
                    "REST 基础路径 /api/v1。\n"
                    "引擎 ingest 使用 Bearer EVOTOWN_ENGINE_INGEST_TOKEN。\n"
                    "知识检索 GET /api/v1/knowledge/search?q=..."
                ),
                tags=["api", "engineering"],
            ),
            FetchedDocument(
                external_id="yuque-demo-runbook",
                title="On-call Runbook：Agent 运行失败",
                url="https://www.yuque.com/demo/runbook",
                space_name=f"语雀 · {source_name}",
                content_text=(
                    "1. 在 Runs 查看 log_excerpt 与 policy_violations。\n"
                    "2. 检查引擎 heartbeat 与 connector 状态。\n"
                    "3. 必要时在 Skills 市场回滚版本。"
                ),
                tags=["runbook", "sre"],
            ),
        ]
    return [
        FetchedDocument(
            external_id="custom-demo-policy",
            title="自定义知识源示例文档",
            url="https://example.com/docs/custom-policy",
            space_name=source_name,
            content_text="通过 Connector POST /api/v1/knowledge/documents/ingest 推送文档到 Evotown 索引。",
            tags=["custom"],
        ),
    ]
