"""Evotown LLM 客户端 — 复用 .env 中的 API 配置，供裁判/分发等模块使用

使用 OpenAI SDK，兼容 Gemini、本地模型等 OpenAI 兼容 API。
"""
import json
import logging
import os
from typing import Any

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()
logger = logging.getLogger("evotown.llm")

_BASE_URL = os.getenv("BASE_URL", "").rstrip("/")
_API_KEY = os.getenv("API_KEY", "")
_DEFAULT_MODEL = os.getenv("JUDGE_MODEL") or os.getenv("MODEL", "gemini-2.5-flash")

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            base_url=_BASE_URL or None,
            api_key=_API_KEY,
            timeout=30.0,
        )
    return _client


def _parse_json_from_content(content: str) -> dict[str, Any] | None:
    """从 content 中解析 JSON，支持 markdown 包裹和 Gemini 等非标准格式"""
    text = content.strip()
    for prefix in ("```json\n", "```json", "```\n"):
        if text.startswith(prefix):
            text = text[len(prefix) :]
            break
    for suffix in ("\n```", "```"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
            break
    text = text.strip()

    for candidate in [text, content]:
        try:
            return json.loads(candidate)
        except (json.JSONDecodeError, TypeError):
            pass
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except (json.JSONDecodeError, TypeError):
            pass
    return None


async def chat_completion(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 1024,
    response_format: dict | None = None,
) -> dict[str, Any]:
    """调用 OpenAI 兼容 API，返回 parsed JSON 或 raw text"""
    model = model or _DEFAULT_MODEL
    client = _get_client()

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if response_format:
        kwargs["response_format"] = response_format

    response = await client.chat.completions.create(**kwargs)
    content = response.choices[0].message.content if response.choices else None

    if not content or not isinstance(content, str):
        return {"raw": content or ""}

    parsed = _parse_json_from_content(content)
    return parsed if parsed is not None else {"raw": content}
