"""Evotown LLM 客户端 — 复用 .env 中的 API 配置，供裁判/分发等模块使用"""
import json
import logging
import os
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("evotown.llm")

_BASE_URL = os.getenv("BASE_URL", "").rstrip("/")
_API_KEY = os.getenv("API_KEY", "")
_DEFAULT_MODEL = os.getenv("JUDGE_MODEL") or os.getenv("MODEL", "gemini-2.5-flash")


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
    url = f"{_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {_API_KEY}",
        "Content-Type": "application/json",
    }
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if response_format:
        body["response_format"] = response_format

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()

    content = data["choices"][0]["message"]["content"]
    try:
        return json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return {"raw": content}
