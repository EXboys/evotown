#!/usr/bin/env python3
"""Evotown employee agent setup — check gateway, sync private SkillHub, optional watch loop.

Stdlib-only. Reads ~/.config/evotown/evotown.agent.env or environment variables.

Environment:
  EVOTOWN_URL          Base URL (required)
  EVOTOWN_API_KEY      evk_ employee key (required)
  EVOTOWN_RUNTIME      openclaw | hermes | skilllite (default: openclaw)
  EVOTOWN_SKILLS_DIR   Install directory (default: ~/.evotown/skills)
  EVOTOWN_BUNDLE_ID    Skill bundle id (default: default-agent-skills)
  EVOTOWN_ENGINE_ID    Optional engine id for register command
  EVOTOWN_INGEST_TOKEN Optional ingest token (IT-only register/heartbeat)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

DEFAULT_CONFIG_PATH = Path.home() / ".config" / "evotown" / "evotown.agent.env"
DEFAULT_STATE_PATH = Path.home() / ".config" / "evotown" / "skills-lock.json"
DEFAULT_SKILLS_DIR = Path.home() / ".evotown" / "skills"
RUNTIMES = {"openclaw", "hermes", "skilllite", "custom"}


def log(msg: str) -> None:
    print(msg, flush=True)


def die(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr, flush=True)
    raise SystemExit(code)


def load_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        values[key.strip()] = val.strip().strip('"').strip("'")
    return values


def config() -> dict[str, str]:
    file_values = load_env_file(Path(os.environ.get("EVOTOWN_CONFIG", str(DEFAULT_CONFIG_PATH))))
    merged = {**file_values, **{k: v for k, v in os.environ.items() if k.startswith("EVOTOWN_") or k in {"OPENAI_API_KEY"}}}
    if not merged.get("EVOTOWN_URL") and merged.get("EVOTOWN_PUBLIC_URL"):
        merged["EVOTOWN_URL"] = merged["EVOTOWN_PUBLIC_URL"]
    if not merged.get("EVOTOWN_API_KEY") and merged.get("OPENAI_API_KEY", "").startswith("evk_"):
        merged["EVOTOWN_API_KEY"] = merged["OPENAI_API_KEY"]
    return merged


def require(cfg: dict[str, str]) -> tuple[str, str]:
    base = (cfg.get("EVOTOWN_URL") or "").rstrip("/")
    key = (cfg.get("EVOTOWN_API_KEY") or "").strip()
    if not base:
        die(f"EVOTOWN_URL is required (set in {DEFAULT_CONFIG_PATH})")
    if not key.startswith("evk_"):
        die("EVOTOWN_API_KEY must be an evk_ employee key")
    return base, key


def http_json(method: str, url: str, *, api_key: str | None = None, body: dict | None = None, timeout: int = 60) -> Any:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        die(f"HTTP {exc.code} {url}: {detail[:500]}")


def http_bytes(url: str, *, api_key: str) -> bytes:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        die(f"HTTP {exc.code} download {url}: {detail[:300]}")


def cmd_check(cfg: dict[str, str]) -> int:
    base, key = require(cfg)
    runtime = (cfg.get("EVOTOWN_RUNTIME") or "openclaw").strip()
    if runtime not in RUNTIMES:
        die(f"invalid EVOTOWN_RUNTIME: {runtime}")

    health = http_json("GET", f"{base}/health")
    log(f"✓ Evotown health: {health.get('status', health)}")

    gw = http_json("GET", f"{base}/api/gateway/v1/health")
    log(f"✓ Gateway: litellm_configured={gw.get('litellm_configured')}")

    manifest_url = (
        f"{base}/api/v1/market/bundles/{cfg.get('EVOTOWN_BUNDLE_ID', 'default-agent-skills')}/manifest"
        f"?runtime_target={runtime}"
    )
    manifest_body = http_json("GET", manifest_url, api_key=key)
    skills = manifest_body.get("manifest", {}).get("skills", [])
    log(f"✓ Skill manifest ({runtime}): {len(skills)} skill(s)")

    log("")
    log("OpenClaw / Hermes env:")
    log(f"  OPENAI_BASE_URL={base}/api/gateway/v1")
    log(f"  OPENAI_API_KEY={key[:12]}…")
    return 0


def resolve_package_url(base: str, package_url: str) -> str | None:
    if not package_url or package_url.startswith("builtin://"):
        return None
    if package_url.startswith("http://") or package_url.startswith("https://"):
        return package_url
    if package_url.startswith("/"):
        return f"{base}{package_url}"
    return f"{base}/{package_url.lstrip('/')}"


def load_state(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"skills": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"skills": {}}


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def install_zip_bytes(content: bytes, target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    tmp = target_dir / ".download.zip"
    tmp.write_bytes(content)
    try:
        with zipfile.ZipFile(tmp) as zf:
            zf.extractall(target_dir)
    finally:
        tmp.unlink(missing_ok=True)


def cmd_sync(cfg: dict[str, str], *, dry_run: bool = False) -> int:
    base, key = require(cfg)
    runtime = (cfg.get("EVOTOWN_RUNTIME") or "openclaw").strip()
    skills_dir = Path(cfg.get("EVOTOWN_SKILLS_DIR") or DEFAULT_SKILLS_DIR).expanduser()
    state_path = Path(cfg.get("EVOTOWN_STATE_PATH") or DEFAULT_STATE_PATH).expanduser()
    bundle_id = cfg.get("EVOTOWN_BUNDLE_ID") or "default-agent-skills"

    manifest_url = f"{base}/api/v1/market/bundles/{bundle_id}/manifest?runtime_target={runtime}"
    manifest_body = http_json("GET", manifest_url, api_key=key)
    manifest = manifest_body.get("manifest") or {}
    skills = manifest.get("skills") or []

    state = load_state(state_path)
    state.update(
        {
            "bundle_id": manifest.get("bundle_id", bundle_id),
            "channel": manifest.get("channel", "stable"),
            "runtime_target": runtime,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    )
    lock = state.setdefault("skills", {})

    installed = skipped = failed = 0
    for entry in skills:
        skill_id = entry.get("skill_id") or ""
        version = entry.get("version") or "0.0.0"
        package_url = entry.get("package_url") or ""
        resolved = resolve_package_url(base, package_url)
        if not skill_id:
            continue
        if resolved is None:
            log(f"· {skill_id}@{version} (builtin — skipped)")
            skipped += 1
            continue

        prev = lock.get(skill_id, {})
        if prev.get("version") == version and prev.get("package_url") == package_url:
            target = skills_dir / skill_id
            if target.is_dir() and any(target.iterdir()):
                log(f"· {skill_id}@{version} (up to date)")
                skipped += 1
                continue

        log(f"↓ {skill_id}@{version}")
        if dry_run:
            installed += 1
            continue

        try:
            blob = http_bytes(resolved, api_key=key)
            digest = hashlib.sha256(blob).hexdigest()
            target = skills_dir / skill_id
            if target.exists():
                for child in target.iterdir():
                    if child.is_dir():
                        shutil.rmtree(child)
                    else:
                        child.unlink()
            install_zip_bytes(blob, target)
            lock[skill_id] = {
                "version": version,
                "package_url": package_url,
                "sha256": digest,
                "installed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            installed += 1
        except SystemExit:
            failed += 1
        except OSError as exc:
            log(f"  ! failed: {exc}")
            failed += 1

    save_state(state_path, state)
    log("")
    log(f"Sync done — installed/updated: {installed}, skipped: {skipped}, failed: {failed}")
    log(f"Skills dir: {skills_dir}")
    log(f"Lock file:  {state_path}")
    return 1 if failed else 0


def cmd_print_env(cfg: dict[str, str]) -> int:
    base, key = require(cfg)
    runtime = (cfg.get("EVOTOWN_RUNTIME") or "openclaw").strip()
    print(f"export EVOTOWN_URL={base}")
    print(f"export EVOTOWN_API_KEY={key}")
    print(f"export EVOTOWN_RUNTIME={runtime}")
    print(f"export OPENAI_BASE_URL={base}/api/gateway/v1")
    print(f"export OPENAI_API_KEY={key}")
    return 0


def cmd_register(cfg: dict[str, str]) -> int:
    ingest = (cfg.get("EVOTOWN_INGEST_TOKEN") or os.environ.get("EVOTOWN_ENGINE_INGEST_TOKEN") or "").strip()
    if not ingest:
        die("EVOTOWN_INGEST_TOKEN or EVOTOWN_ENGINE_INGEST_TOKEN required for register")
    base = (cfg.get("EVOTOWN_URL") or "").rstrip("/")
    engine_id = (cfg.get("EVOTOWN_ENGINE_ID") or f"{cfg.get('EVOTOWN_RUNTIME', 'openclaw')}-{Path.home().name}").strip()
    runtime = (cfg.get("EVOTOWN_RUNTIME") or "openclaw").strip()
    body = {
        "engine_id": engine_id,
        "engine_type": runtime if runtime in RUNTIMES else "custom",
        "engine_version": cfg.get("EVOTOWN_ENGINE_VERSION") or "local",
        "owner_team": cfg.get("EVOTOWN_TEAM_ID") or "",
        "deployment_kind": "laptop",
        "display_name": cfg.get("EVOTOWN_ENGINE_NAME") or engine_id,
    }
    req = urllib.request.Request(
        f"{base}/api/v1/engines/register",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {ingest}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        die(f"register failed HTTP {exc.code}: {exc.read().decode('utf-8', errors='replace')[:300]}")
    log(f"✓ Engine registered: {payload.get('engine', {}).get('engine_id', engine_id)}")
    return 0


def cmd_watch(cfg: dict[str, str], interval_sec: int) -> int:
    log(f"Watching SkillHub every {interval_sec}s (Ctrl+C to stop)")
    while True:
        cmd_sync(cfg)
        time.sleep(max(60, interval_sec))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evotown employee agent setup")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="Path to evotown.agent.env")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("check", help="Verify Evotown, gateway, and manifest access")
    p_sync = sub.add_parser("sync", help="Download/update skills from private SkillHub manifest")
    p_sync.add_argument("--dry-run", action="store_true", help="Show actions without downloading")
    sub.add_parser("print-env", help="Print shell export lines for OpenClaw/Hermes")
    sub.add_parser("register", help="Register this laptop engine (requires ingest token)")
    p_watch = sub.add_parser("watch", help="Periodically run sync")
    p_watch.add_argument("--interval", type=int, default=3600, help="Seconds between sync runs (min 60)")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    os.environ["EVOTOWN_CONFIG"] = args.config
    cfg = config()

    if args.command == "check":
        return cmd_check(cfg)
    if args.command == "sync":
        return cmd_sync(cfg, dry_run=args.dry_run)
    if args.command == "print-env":
        return cmd_print_env(cfg)
    if args.command == "register":
        return cmd_register(cfg)
    if args.command == "watch":
        try:
            cmd_watch(cfg, args.interval)
        except KeyboardInterrupt:
            log("\nStopped.")
        return 0
    parser.error(f"unknown command: {args.command}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
