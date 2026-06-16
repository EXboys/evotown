#!/usr/bin/env python3
"""MCP 发布工具 — 从 mcp-dev 部署到 mcp-services。

用法:  python publish.py {category}/{service_name}
示例:  python publish.py demo/mcp_order_query

Agent 在对话中执行此脚本即可完成部署。
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

DEV_DIR = Path(__file__).resolve().parent          # mcp-dev/
PROD_DIR = DEV_DIR.parent / "mcp-services"          # mcp-services/ 同级

DIMENSIONS = {}
_permissions_py = DEV_DIR / "permissions.py"
if _permissions_py.is_file():
    try:
        exec(_permissions_py.read_text(encoding="utf-8"), {"__name__": "__permissions__"}, DIMENSIONS)
    except Exception:
        pass


def _load_manifest(service_path: Path) -> dict:
    mf = service_path / "manifest.json"
    if not mf.is_file():
        raise SystemExit(f"❌ manifest.json 不存在: {mf}")
    return json.loads(mf.read_text(encoding="utf-8"))


def _validate_dimensions(manifest: dict):
    declared = manifest.get("dimensions", [])
    if not declared:
        return
    registered = set(DIMENSIONS.get("DIMENSIONS", {}))
    missing = set(declared) - registered
    if missing:
        raise SystemExit(f"❌ manifest.dimensions 引用了未注册维度: {missing}\n   已注册: {sorted(registered)}")


def _bump_version(existing: str | None) -> str:
    if not existing:
        return "1.0.0"
    try:
        parts = [int(x) for x in existing.split(".")]
    except (ValueError, TypeError):
        return "1.0.0"
    parts = (parts + [0, 0, 0])[:3]
    parts[2] += 1
    return ".".join(str(p) for p in parts)


def _clear_cache(service_id: str):
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
        from services.mcp_loader import clear_handler_cache
        clear_handler_cache(service_id)
    except ImportError:
        pass


def main():
    parser = argparse.ArgumentParser(description="MCP 发布: 开发 → 生产")
    parser.add_argument("service_id", help="服务ID，格式 {category}/{service_name}")
    args = parser.parse_args()

    service_id = args.service_id.strip("/")

    dev_path = DEV_DIR / service_id
    if not dev_path.is_dir():
        raise SystemExit(f"❌ 开发目录不存在: {dev_path}")

    # 1. Load and validate manifest
    manifest = _load_manifest(dev_path)
    _validate_dimensions(manifest)

    # 2. Check handler.py
    handler = dev_path / "handler.py"
    if not handler.is_file():
        raise SystemExit(f"❌ handler.py 不存在: {handler}")

    # 3. Determine version
    new_version = manifest.get("version", "1.0.0")
    prod_path = PROD_DIR / service_id

    if prod_path.is_dir():
        existing_manifest = prod_path / "manifest.json"
        if existing_manifest.is_file():
            try:
                old = json.loads(existing_manifest.read_text(encoding="utf-8"))
                new_version = _bump_version(old.get("version"))
            except Exception:
                new_version = _bump_version(None)
    manifest["version"] = new_version

    # 4. Copy to production
    prod_path.mkdir(parents=True, exist_ok=True)
    shutil.copy2(handler, prod_path / "handler.py")
    (prod_path / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # 5. Clear cache for hot-reload
    _clear_cache(service_id)

    print(f"✅ MCP 发布成功: {service_id} v{new_version}")
    print(f"   开发: {dev_path}")
    print(f"   生产: {prod_path}")


if __name__ == "__main__":
    main()
