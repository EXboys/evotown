"""Evotown LLM 客户端 — 复用 .env 中的 API 配置，供裁判/分发等模块使用

使用 OpenAI SDK，兼容 Gemini、本地模型（Ollama）等 OpenAI 兼容 API。

分层模型路由（token 成本优化）
─────────────────────────────────────────────────
角色              | 推荐模型         | 环境变量
─────────────────────────────────────────────────
主 Agent（Rust）  | 远端强力模型     | MODEL / BASE_URL / API_KEY
裁判 Judge        | 本地 7B/14B      | JUDGE_MODEL / LOCAL_BASE_URL / LOCAL_API_KEY
任务生成 Dispatch  | 本地 7B/14B     | DISPATCHER_MODEL / LOCAL_BASE_URL / LOCAL_API_KEY
─────────────────────────────────────────────────

M4 16GB 本地模型推荐（via Ollama）:
  - qwen2.5:7b    (~4.5 GB，适合裁判和任务生成，速度快)
  - qwen2.5:14b   (~8.5 GB，质量更高，仍有余量)
  - llama3.1:8b   (~5 GB，英文能力强)

.env 配置示例（本地 + 远端 混合）:
  BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
  API_KEY=sk-xxxx
  MODEL=qwen-plus

  LOCAL_BASE_URL=http://localhost:11434/v1
  LOCAL_API_KEY=ollama
  JUDGE_MODEL=qwen2.5:7b
  DISPATCHER_MODEL=qwen2.5:7b
"""
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

from dotenv import load_dotenv
from openai import AsyncOpenAI

from token_usage import add_usage

load_dotenv()
logger = logging.getLogger("evotown.llm")


# ── 熔断器 ───────────────────────────────────────────────────────────────────
@dataclass
class _CircuitBreaker:
    """简单三态熔断器：CLOSED → (连续失败 ≥ threshold) → OPEN → (cooldown 过期) → HALF_OPEN → CLOSED/OPEN

    - CLOSED  : 正常放行
    - OPEN    : 熔断，直接抛出异常，不发起网络请求
    - HALF_OPEN: cooldown 后放行一次探测；成功则复位，失败则延长 cooldown 再次 OPEN
    """
    label: str
    threshold: int = 3          # 连续失败多少次触发熔断
    base_cooldown: float = 60.0 # 初始冷却时间（秒）

    _failures: int = field(default=0, repr=False)
    _is_open: bool = field(default=False, repr=False)
    _opened_at: float = field(default=0.0, repr=False)
    _cooldown: float = field(default=0.0, repr=False, init=False)

    def __post_init__(self) -> None:
        self._cooldown = self.base_cooldown

    def _elapsed(self) -> float:
        return time.monotonic() - self._opened_at

    def allow(self) -> bool:
        """返回 True 表示可以发起请求"""
        if not self._is_open:
            return True
        if self._elapsed() >= self._cooldown:
            logger.info("[circuit:%s] half-open probe allowed after %.0fs", self.label, self._elapsed())
            return True  # half-open：允许一次探测
        return False

    def record_success(self) -> None:
        if self._is_open:
            logger.info("[circuit:%s] probe succeeded → CLOSED", self.label)
        self._failures = 0
        self._is_open = False
        self._cooldown = self.base_cooldown  # 复位冷却时间

    def record_failure(self) -> None:
        self._failures += 1
        if self._is_open:
            # 半开探测失败：延长 cooldown（指数退避，上限 10 分钟）
            self._cooldown = min(self._cooldown * 2, 600.0)
            self._opened_at = time.monotonic()
            logger.warning(
                "[circuit:%s] half-open probe failed → OPEN again, cooldown=%.0fs",
                self.label, self._cooldown,
            )
        elif self._failures >= self.threshold:
            self._is_open = True
            self._opened_at = time.monotonic()
            logger.warning(
                "[circuit:%s] OPEN after %d consecutive failures, cooldown=%.0fs",
                self.label, self._failures, self._cooldown,
            )

    def raise_if_open(self) -> None:
        """若熔断中则立刻抛出，调用方无需等待超时"""
        if self._is_open and not self.allow():
            remaining = max(0.0, self._cooldown - self._elapsed())
            raise RuntimeError(
                f"[circuit:{self.label}] open — {remaining:.0f}s remaining. "
                "LLM API temporarily disabled to prevent runaway costs."
            )


# 每个调用通道各自独立的熔断器
_breakers: dict[str, _CircuitBreaker] = {
    "judge-local":      _CircuitBreaker("judge-local"),
    "judge-main":       _CircuitBreaker("judge-main"),
    "dispatcher-local": _CircuitBreaker("dispatcher-local"),
    "dispatcher-main":  _CircuitBreaker("dispatcher-main"),
    "main":             _CircuitBreaker("main"),
}

# ── 主客户端（远端 API，供 agent 子进程使用，不在此进程直接调用）──
_BASE_URL = os.getenv("BASE_URL", "").rstrip("/")
_API_KEY = os.getenv("API_KEY", "")

# ── 本地客户端（Ollama 或本地 OpenAI-compatible API）──
_LOCAL_BASE_URL = os.getenv("LOCAL_BASE_URL", "").rstrip("/")
_LOCAL_API_KEY = os.getenv("LOCAL_API_KEY", "ollama")

# ── 模型选择 ──
# 裁判：优先 JUDGE_MODEL → LOCAL 本地回退 → 远端 MODEL
_JUDGE_MODEL = os.getenv("JUDGE_MODEL", "")
# 任务生成：优先 DISPATCHER_MODEL → JUDGE_MODEL → LOCAL → 远端 MODEL
_DISPATCHER_MODEL = os.getenv("DISPATCHER_MODEL", "")
# 兜底：原有逻辑
_DEFAULT_MODEL = os.getenv("JUDGE_MODEL") or os.getenv("MODEL", "gemini-2.5-flash")

_client: AsyncOpenAI | None = None
_local_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    """获取主（远端）客户端"""
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            base_url=_BASE_URL or None,
            api_key=_API_KEY,
            timeout=120.0,  # 文言文战报等长文本生成需要更长时间
        )
    return _client


def _get_local_client() -> AsyncOpenAI | None:
    """获取本地客户端（Ollama），未配置 LOCAL_BASE_URL 时返回 None"""
    global _local_client
    if not _LOCAL_BASE_URL:
        return None
    if _local_client is None:
        _local_client = AsyncOpenAI(
            base_url=_LOCAL_BASE_URL,
            api_key=_LOCAL_API_KEY or "ollama",
            timeout=120.0,  # 本地模型响应可能较慢
        )
    return _local_client


def has_local_llm() -> bool:
    """是否配置了本地模型端点"""
    return bool(_LOCAL_BASE_URL)


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
    raw_only: bool = False,
) -> dict[str, Any]:
    """调用 OpenAI 兼容 API，返回 parsed JSON 或 raw text。
    raw_only=True 时跳过 JSON 解析，直接以 {"raw": content} 返回（用于文言文战报等纯文本生成）。"""
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
    usage = getattr(response, "usage", None)
    if usage is not None:
        pt = getattr(usage, "prompt_tokens", 0) or 0
        ct = getattr(usage, "completion_tokens", 0) or 0
        if pt or ct:
            add_usage(prompt_tokens=pt, completion_tokens=ct)

    content = response.choices[0].message.content if response.choices else None

    if not content or not isinstance(content, str):
        return {"raw": content or ""}

    if raw_only:
        return {"raw": content}

    parsed = _parse_json_from_content(content)
    return parsed if parsed is not None else {"raw": content}


async def _call_with_client(
    client: AsyncOpenAI,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
    response_format: dict | None,
    label: str,
) -> dict[str, Any]:
    """内部：使用指定客户端和模型发起调用，统计 token 并返回解析结果。
    集成熔断器：熔断中时直接抛出，不发起网络请求。"""
    # ── 熔断检查 ──────────────────────────────────────────────────────────────
    breaker = _breakers.get(label) or _breakers.setdefault(label, _CircuitBreaker(label))
    breaker.raise_if_open()

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if response_format:
        kwargs["response_format"] = response_format
    try:
        response = await client.chat.completions.create(**kwargs)
    except Exception as e:
        breaker.record_failure()
        logger.error("[%s] LLM call failed (model=%s): %s", label, model, e)
        raise
    # ── 记录成功 ───────────────────────────────────────────────────────────────
    breaker.record_success()
    usage = getattr(response, "usage", None)
    if usage is not None:
        pt = getattr(usage, "prompt_tokens", 0) or 0
        ct = getattr(usage, "completion_tokens", 0) or 0
        if pt or ct:
            add_usage(prompt_tokens=pt, completion_tokens=ct)
            logger.info("[%s] tokens: prompt=%d completion=%d model=%s", label, pt, ct, model)
    content = response.choices[0].message.content if response.choices else None
    if not content or not isinstance(content, str):
        return {"raw": content or ""}
    parsed = _parse_json_from_content(content)
    return parsed if parsed is not None else {"raw": content}


async def judge_completion(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.1,
    max_tokens: int = 256,
    response_format: dict | None = None,
) -> dict[str, Any]:
    """裁判专用调用 — 优先使用本地模型（LOCAL_BASE_URL + JUDGE_MODEL），
    本地未配置时回退到主 API。

    本地模型建议：qwen2.5:7b / llama3.1:8b（via Ollama）
    """
    local = _get_local_client()
    if local and _JUDGE_MODEL:
        model = _JUDGE_MODEL
        logger.info("[judge] using local model: %s @ %s", model, _LOCAL_BASE_URL)
        try:
            return await _call_with_client(local, model, messages, temperature, max_tokens, response_format, "judge-local")
        except Exception as e:
            logger.warning("[judge] local model failed (%s), falling back to main API: %s", model, e)
    # 回退到主 API
    model = _JUDGE_MODEL or _DEFAULT_MODEL
    return await _call_with_client(_get_client(), model, messages, temperature, max_tokens, response_format, "judge-main")


async def dispatcher_completion(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.95,
    max_tokens: int = 1200,
) -> dict[str, Any]:
    """任务生成专用调用 — 优先使用本地模型（LOCAL_BASE_URL + DISPATCHER_MODEL），
    本地未配置时回退到主 API。

    本地模型建议：qwen2.5:7b / qwen2.5:14b（via Ollama）
    """
    local = _get_local_client()
    dispatcher_model = _DISPATCHER_MODEL or _JUDGE_MODEL
    if local and dispatcher_model:
        logger.info("[dispatcher] using local model: %s @ %s", dispatcher_model, _LOCAL_BASE_URL)
        try:
            return await _call_with_client(local, dispatcher_model, messages, temperature, max_tokens, None, "dispatcher-local")
        except Exception as e:
            logger.warning("[dispatcher] local model failed (%s), falling back to main API: %s", dispatcher_model, e)
    # 回退到主 API
    model = dispatcher_model or _DEFAULT_MODEL
    return await _call_with_client(_get_client(), model, messages, temperature, max_tokens, None, "dispatcher-main")
