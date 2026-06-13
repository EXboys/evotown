"""Vision preflight for Coding Agent workspace image attachments."""
from __future__ import annotations

import base64
import io
import os
from pathlib import Path
from typing import Any

import httpx

from infra import gateway_models, gateway_upstream, workspaces
from infra.workspace_uploads import _IMAGE_SUFFIXES

_VISION_INSTRUCTION = (
    "用户上传了图片，请仔细查看并用中文详细描述，包括："
    "1) 画面类型（实拍照片/屏幕截图/文档扫描等）；"
    "2) 可见文字尽量逐字转录；"
    "3) 主要对象、人物、场景、UI 元素；"
    "4) 与用户问题直接相关的要点。"
)


def vision_model_name() -> str:
    return (
        os.environ.get("EVOTOWN_CLAUDE_VISION_MODEL", "").strip()
        or os.environ.get("EVOTOWN_VISION_MODEL", "").strip()
    )


def vision_enabled() -> bool:
    flag = os.environ.get("EVOTOWN_CLAUDE_VISION_ENABLED", "").strip().lower()
    if flag in {"0", "false", "no", "off"}:
        return False
    return bool(vision_model_name())


def is_image_path(path: str) -> bool:
    return Path(path).suffix.lower() in _IMAGE_SUFFIXES


def filter_image_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in paths:
        rel = str(raw or "").strip().replace("\\", "/")
        if not rel or rel in seen or not is_image_path(rel):
            continue
        seen.add(rel)
        out.append(rel)
    return out


def _prepare_image_b64(path: Path, *, max_bytes: int = 4 * 1024 * 1024, max_side: int = 2048) -> tuple[str, str]:
    from PIL import Image

    img = Image.open(path)
    img = img.convert("RGB")
    width, height = img.size
    if max(width, height) > max_side:
        scale = max_side / max(width, height)
        img = img.resize((int(width * scale), int(height * scale)), Image.Resampling.LANCZOS)
    quality = 85
    data = b""
    while quality >= 50:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        data = buf.getvalue()
        if len(data) <= max_bytes:
            break
        quality -= 10
    return "image/jpeg", base64.b64encode(data).decode("ascii")


def _extract_chat_text(data: dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content") or ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "\n".join(part for part in parts if part).strip()
    return str(content).strip()


async def describe_workspace_images(
    workspace: dict[str, Any],
    image_paths: list[str],
    *,
    user_prompt: str,
) -> str:
    """Call a Gateway-registered OpenAI-compatible vision model."""
    paths = filter_image_paths(image_paths)
    if not paths:
        return ""

    model = vision_model_name()
    if not model:
        raise ValueError(
            "未配置视觉模型：请在 .env 设置 EVOTOWN_CLAUDE_VISION_MODEL，"
            "并在控制台 Gateway → 上游模型注册支持识图的模型（如 qwen-vl-plus）。"
        )

    managed = gateway_models.get_by_model_name(model)
    if managed is None:
        raise ValueError(f"视觉模型「{model}」未在 Gateway 上游模型中注册或未启用")

    content: list[dict[str, Any]] = []
    prompt_line = _VISION_INSTRUCTION
    if user_prompt.strip():
        prompt_line = f"{_VISION_INSTRUCTION}\n\n用户问题：{user_prompt.strip()}"
    content.append({"type": "text", "text": prompt_line})

    encoded = 0
    for rel in paths:
        target = workspaces.resolve_workspace_path(workspace, rel)
        if not target.is_file():
            continue
        media_type, b64 = _prepare_image_b64(target)
        content.append({"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64}"}})
        encoded += 1

    if encoded == 0:
        raise ValueError("图片附件不存在或无法读取")

    body = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "max_tokens": int(os.environ.get("EVOTOWN_CLAUDE_VISION_MAX_TOKENS", "2048")),
    }
    url, headers, req = gateway_upstream.build_upstream_call(body, model)
    timeout = float(os.environ.get("EVOTOWN_CLAUDE_VISION_TIMEOUT_SEC", "120"))
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, headers=headers, json=req)
    if resp.status_code >= 400:
        detail = resp.text[:500]
        raise ValueError(f"视觉模型调用失败 (HTTP {resp.status_code}): {detail}")

    text = _extract_chat_text(resp.json())
    if not text:
        raise ValueError("视觉模型未返回文本描述")
    return text
