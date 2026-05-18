"""简单双 Token 鉴权

策略：
  - 写操作（POST / PUT / DELETE / PATCH）→ 必须携带 X-Admin-Token 请求头
  - 读操作（GET）+ WebSocket 观战     → 公开，无需 token

启动前在环境变量或 .env 中设置：
  ADMIN_TOKEN=your-secret-here

若未配置 ADMIN_TOKEN，所有写操作返回 503，提醒部署者先设置。
"""
import os

from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

_HEADER_SCHEME = APIKeyHeader(name="X-Admin-Token", auto_error=False)
_BEARER_SCHEME = HTTPBearer(auto_error=False)


def _get_configured_token() -> str:
    return os.environ.get("ADMIN_TOKEN", "").strip()


async def require_admin(key: str | None = Security(_HEADER_SCHEME)) -> None:
    """FastAPI 依赖：校验 X-Admin-Token 请求头。

    用法：
        @router.post("/foo")
        async def foo(..., _: None = Depends(require_admin)):
            ...
    """
    admin_token = _get_configured_token()
    if not admin_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server not configured: ADMIN_TOKEN env var is missing.",
        )
    if not key or key != admin_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing X-Admin-Token header.",
        )


def _get_engine_ingest_token() -> str:
    """Engine ingest token, falling back to ADMIN_TOKEN for single-node dev."""
    return os.environ.get("EVOTOWN_ENGINE_INGEST_TOKEN", "").strip() or _get_configured_token()


async def require_engine_ingest(
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> None:
    """Validate bearer token for external engine ingest endpoints.

    Production deployments should set EVOTOWN_ENGINE_INGEST_TOKEN so connectors do
    not need the broader admin token. ADMIN_TOKEN fallback keeps local dev simple.
    """
    token = _get_engine_ingest_token()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server not configured: EVOTOWN_ENGINE_INGEST_TOKEN or ADMIN_TOKEN is missing.",
        )
    if credentials is None or credentials.scheme.lower() != "bearer" or credentials.credentials != token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing bearer token.",
        )


def _get_gateway_api_keys() -> list[str]:
    """Gateway virtual keys, falling back to ADMIN_TOKEN for local development."""
    raw = os.environ.get("EVOTOWN_GATEWAY_API_KEYS", "").strip()
    keys = [item.strip() for item in raw.split(",") if item.strip()]
    admin_token = _get_configured_token()
    if admin_token:
        keys.append(admin_token)
    return keys


def _gateway_key_label(token: str) -> str:
    if token == _get_configured_token():
        return "admin-token"
    return f"gateway-key-{token[-6:]}" if len(token) >= 6 else "gateway-key"


async def require_gateway_api_key(
    credentials: HTTPAuthorizationCredentials | None = Security(_BEARER_SCHEME),
) -> dict[str, str]:
    """Validate bearer token for the centralized model gateway."""
    keys = _get_gateway_api_keys()
    if not keys:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server not configured: EVOTOWN_GATEWAY_API_KEYS or ADMIN_TOKEN is missing.",
        )
    if credentials is None or credentials.scheme.lower() != "bearer" or credentials.credentials not in keys:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing gateway bearer token.",
        )
    return {"key_label": _gateway_key_label(credentials.credentials)}


def admin_token_status() -> str:
    """返回 ADMIN_TOKEN 配置状态（供启动日志使用，不暴露 token 值）。"""
    token = _get_configured_token()
    if not token:
        return "NOT SET ⚠️  — all write endpoints will return 503"
    return f"configured ({len(token)} chars) ✓"


# ── Prompt Injection Guard ─────────────────────────────────────────────────────

# 常见 prompt injection 特征短语（全部小写匹配）
_INJECTION_PATTERNS: list[str] = [
    "ignore previous instructions",
    "ignore all previous",
    "disregard all previous",
    "forget everything above",
    "forget all previous",
    "you are now",
    "your new instructions",
    "override your instructions",
    "act as if you are",
    "pretend you are",
    "from now on you",
    "new persona:",
    "jailbreak",
    # 常见 LLM prompt delimiter 滥用
    "<|system|>",
    "<|user|>",
    "<|assistant|>",
    "###instruction",
    "[system]",
    "[user]",
    # 中文注入特征
    "忽略之前的指令",
    "忽略所有之前",
    "忘记之前的设定",
    "现在你是",
    "你的新指令",
]

# SOUL.md 内容最大长度（约 5 000 字，足够描述完整人格）
SOUL_MAX_CHARS = 5_000

# 单条任务描述最大长度
TASK_MAX_CHARS = 2_000


def check_prompt_injection(text: str) -> str | None:
    """检测文本是否包含 prompt injection 特征。

    返回被匹配的特征词（str）；若无，返回 None。
    """
    lower = text.lower()
    for pattern in _INJECTION_PATTERNS:
        if pattern in lower:
            return pattern
    return None


def validate_soul_content(content: str) -> None:
    """校验 SOUL.md 内容，不合规则抛出 HTTPException(400)。"""
    if len(content) > SOUL_MAX_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"SOUL.md content exceeds {SOUL_MAX_CHARS} character limit "
                   f"(got {len(content)}).",
        )
    hit = check_prompt_injection(content)
    if hit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"SOUL.md content contains disallowed prompt-injection pattern: '{hit}'.",
        )


def validate_task_content(task: str) -> None:
    """校验任务注入内容，不合规则抛出 HTTPException(400)。"""
    if len(task) > TASK_MAX_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task description exceeds {TASK_MAX_CHARS} character limit "
                   f"(got {len(task)}).",
        )
    hit = check_prompt_injection(task)
    if hit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task content contains disallowed prompt-injection pattern: '{hit}'.",
        )

