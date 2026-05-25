"""HMAC signatures for private skill packages."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os


def signing_secret() -> str:
    return os.environ.get("EVOTOWN_SKILL_SIGNING_SECRET", "").strip()


def signing_enabled() -> bool:
    return bool(signing_secret())


def require_signed_downloads() -> bool:
    return os.environ.get("EVOTOWN_REQUIRE_SIGNED_SKILLS", "").strip().lower() in {"1", "true", "yes", "on"}


def sign_digest_hex(hex_digest: str) -> str:
    secret = signing_secret()
    if not secret:
        return ""
    mac = hmac.new(secret.encode("utf-8"), hex_digest.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode("ascii").rstrip("=")


def verify_digest_hex(hex_digest: str, signature: str) -> bool:
    if not signature:
        return not require_signed_downloads()
    if not signing_secret():
        return True
    expected = sign_digest_hex(hex_digest)
    return hmac.compare_digest(expected, signature.strip())


def sign_bytes(raw: bytes) -> tuple[str, str]:
    digest = hashlib.sha256(raw).hexdigest()
    return digest, sign_digest_hex(digest)
