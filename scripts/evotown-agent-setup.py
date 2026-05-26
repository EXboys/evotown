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
  EVOTOWN_INGEST_TOKEN Optional ingest token (IT-only register/heartbeat/connector)
  OPENCLAW_HOOK_URL    OpenClaw gateway hooks/agent URL (default http://127.0.0.1:18789/hooks/agent)
  OPENCLAW_HOOK_TOKEN  Bearer token matching OpenClaw hooks.token
  HERMES_HOOK_URL      Hermes webhook URL for evotown route (see hermes.evotown.yaml)
  HERMES_HOOK_TOKEN    Optional bearer for Hermes webhook
  EVOTOWN_DISPATCH_TIMEOUT  Max seconds to wait for agent completion (default 300)
  EVOTOWN_DISPATCH_POLL_SEC Poll interval when waiting for run terminal status (default 5)
  EVOTOWN_DISPATCH_COMPLETION poll_run (default) | hook_only
    poll_run: trigger gateway hook in background, complete when run is terminal
              (via ingest events) or hook returns; hook HTTP 2xx alone does not complete
    hook_only: wait for blocking hook response only (legacy)
"""
from __future__ import annotations

import argparse
import threading
import base64
import hashlib
import hmac
import os
import json
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

DEFAULT_CONFIG_PATH = Path.home() / ".config" / "evotown" / "evotown.agent.env"
DEFAULT_STATE_PATH = Path.home() / ".config" / "evotown" / "skills-lock.json"
DEFAULT_SKILLS_DIR = Path.home() / ".evotown" / "skills"
RUNTIMES = {"openclaw", "hermes", "skilllite", "custom"}
CONNECTOR_VERSION = "evotown-setup-1.1"
_RUN_TERMINAL = frozenset({"succeeded", "failed", "cancelled"})


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


def ingest_token(cfg: dict[str, str]) -> str:
    return (
        cfg.get("EVOTOWN_INGEST_TOKEN")
        or os.environ.get("EVOTOWN_ENGINE_INGEST_TOKEN")
        or ""
    ).strip()


def engine_id(cfg: dict[str, str]) -> str:
    return (cfg.get("EVOTOWN_ENGINE_ID") or f"{cfg.get('EVOTOWN_RUNTIME', 'openclaw')}-{Path.home().name}").strip()


def http_raw(
    method: str,
    url: str,
    *,
    api_key: str | None = None,
    body: dict | None = None,
    timeout: int = 60,
) -> tuple[int, bytes]:
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
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def http_json(method: str, url: str, *, api_key: str | None = None, body: dict | None = None, timeout: int = 60) -> Any:
    status, raw = http_raw(method, url, api_key=api_key, body=body, timeout=timeout)
    if status >= 400:
        die(f"HTTP {status} {url}: {raw.decode('utf-8', errors='replace')[:500]}")
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def http_json_soft(method: str, url: str, *, api_key: str | None = None, body: dict | None = None, timeout: int = 60) -> tuple[int, Any]:
    status, raw = http_raw(method, url, api_key=api_key, body=body, timeout=timeout)
    if not raw:
        return status, {}
    try:
        return status, json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return status, {"raw": raw.decode("utf-8", errors="replace")[:2000]}


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
    ingest = ingest_token(cfg)
    if ingest:
        log("✓ EVOTOWN_INGEST_TOKEN present (register / connector / handoff enabled)")
    else:
        log("! EVOTOWN_INGEST_TOKEN not set — connector and handoff disabled")
    return 0


def verify_package_signature(hex_digest: str, signature: str) -> bool:
    secret = os.environ.get("EVOTOWN_SKILL_SIGNING_SECRET", "").strip()
    if not secret or not signature:
        return True
    mac = hmac.new(secret.encode("utf-8"), hex_digest.encode("utf-8"), hashlib.sha256).digest()
    expected = base64.urlsafe_b64encode(mac).decode("ascii").rstrip("=")
    return hmac.compare_digest(expected, signature.strip())


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
            expected_sha = entry.get("package_sha256") or ""
            expected_sig = entry.get("signature") or ""
            if expected_sha and digest != expected_sha:
                log(f"  ! sha256 mismatch for {skill_id}")
                failed += 1
                continue
            if expected_sig and not verify_package_signature(digest, expected_sig):
                log(f"  ! signature verification failed for {skill_id}")
                failed += 1
                continue
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


def _write_ingest_token_to_config(cfg_path: Path, token: str) -> None:
    lines: list[str] = []
    if cfg_path.is_file():
        for raw in cfg_path.read_text(encoding="utf-8").splitlines():
            if raw.strip().startswith("EVOTOWN_ENGINE_INGEST_TOKEN=") or raw.strip().startswith(
                "EVOTOWN_INGEST_TOKEN="
            ):
                continue
            lines.append(raw)
    lines.append(f"EVOTOWN_ENGINE_INGEST_TOKEN={token}")
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    cfg_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def cmd_register(cfg: dict[str, str], *, save_token: bool = False, rotate: bool = False) -> int:
    bootstrap = ingest_token(cfg)
    if not bootstrap:
        die("EVOTOWN_INGEST_TOKEN or EVOTOWN_ENGINE_INGEST_TOKEN required for register (IT bootstrap)")
    base = (cfg.get("EVOTOWN_URL") or "").rstrip("/")
    eid = engine_id(cfg)
    runtime = (cfg.get("EVOTOWN_RUNTIME") or "openclaw").strip()
    body = {
        "engine_id": eid,
        "engine_type": runtime if runtime in RUNTIMES else "custom",
        "engine_version": cfg.get("EVOTOWN_ENGINE_VERSION") or "local",
        "owner_team": cfg.get("EVOTOWN_TEAM_ID") or "",
        "deployment_kind": cfg.get("EVOTOWN_DEPLOYMENT_KIND") or "laptop",
        "display_name": cfg.get("EVOTOWN_ENGINE_NAME") or eid,
        "capabilities": {
            "dispatch_lease": True,
            "events": True,
            "handoff": True,
        },
        "rotate_ingest_token": rotate,
    }
    status, payload = http_json_soft(
        "POST",
        f"{base}/api/v1/engines/register",
        api_key=bootstrap,
        body=body,
    )
    if status >= 400:
        die(f"register failed HTTP {status}: {payload}")
    log(f"✓ Engine registered: {payload.get('engine', {}).get('engine_id', eid)}")
    issued = payload.get("ingest_token")
    if issued:
        log("")
        log("Per-engine ingest token (save to this machine only, shown once):")
        log(issued)
        if save_token:
            cfg_path = Path(os.environ.get("EVOTOWN_CONFIG", str(DEFAULT_CONFIG_PATH)))
            _write_ingest_token_to_config(cfg_path, issued)
            log(f"✓ Wrote token to {cfg_path}")
        else:
            log("Tip: re-run with --save-token to write EVOTOWN_ENGINE_INGEST_TOKEN into your env file.")
    elif not (cfg.get("EVOTOWN_INGEST_TOKEN") or cfg.get("EVOTOWN_ENGINE_INGEST_TOKEN")):
        log("! No new token issued; set rotate_ingest_token or use existing evi_ token on disk.")
    return 0


def _format_dispatch_message(job: dict[str, Any]) -> str:
    title = (job.get("title") or "").strip()
    body = job.get("message") or ""
    parent = (job.get("refs") or {}).get("parent_job_id")
    job_id = job.get("job_id") or ""
    run_id = job.get("run_id") or job_id
    prefix = f"【Evotown · {title}】" if title else f"【Evotown 任务 {job_id}】"
    if parent:
        prefix += f" (接续 {parent})"
    footer = (
        f"\n\n---\n"
        f"[evotown] job_id={job_id} run_id={run_id}\n"
        f"When this task is fully done, run:\n"
        f"  evotown-agent-setup.py complete --job-id {job_id} --status succeeded --summary \"<brief result>\"\n"
        f"Or POST run.completed to Evotown ingest with run_id={run_id}."
    )
    return f"{prefix}\n\n{body}{footer}"


def _hook_timeout(cfg: dict[str, str]) -> int:
    try:
        return max(30, int(cfg.get("EVOTOWN_DISPATCH_TIMEOUT") or "300"))
    except ValueError:
        return 300


def _trigger_openclaw(cfg: dict[str, str], message: str) -> tuple[bool, str]:
    url = (cfg.get("OPENCLAW_HOOK_URL") or "http://127.0.0.1:18789/hooks/agent").strip()
    token = (cfg.get("OPENCLAW_HOOK_TOKEN") or cfg.get("EVOTOWN_HOOK_TOKEN") or "").strip()
    if not token:
        return False, "OPENCLAW_HOOK_TOKEN not set (must match OpenClaw hooks.token)"
    job_id = ""
    if "[evotown] job_id=" in message:
        try:
            fragment = message.split("[evotown] job_id=", 1)[1]
            job_id = fragment.split()[0].strip()
        except IndexError:
            job_id = ""
    body = {
        "message": message,
        "name": "Evotown",
        "agentId": cfg.get("OPENCLAW_AGENT_ID") or "main",
        "wakeMode": "now",
        "deliver": False,
        "timeoutSeconds": min(_hook_timeout(cfg), 600),
        "metadata": {"source": "evotown", "job_id": job_id} if job_id else {"source": "evotown"},
    }
    data = json.dumps(body).encode("utf-8")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=_hook_timeout(cfg)) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            summary = raw.strip()[:2000] if raw.strip() else f"hook HTTP {resp.status}"
            return True, summary
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        return False, f"hook HTTP {exc.code}: {detail}"
    except OSError as exc:
        return False, str(exc)


def _trigger_hermes(cfg: dict[str, str], message: str, job: dict[str, Any]) -> tuple[bool, str]:
    url = (cfg.get("HERMES_HOOK_URL") or "http://127.0.0.1:18789/hooks/evotown").strip()
    token = (cfg.get("HERMES_HOOK_TOKEN") or cfg.get("EVOTOWN_HOOK_TOKEN") or "").strip()
    body = {
        "message": message,
        "job_id": job.get("job_id"),
        "kind": job.get("kind"),
        "refs": job.get("refs") or {},
        "timeoutSeconds": min(_hook_timeout(cfg), 600),
    }
    data = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=_hook_timeout(cfg)) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            summary = raw.strip()[:2000] if raw.strip() else f"hermes hook HTTP {resp.status}"
            return True, summary
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        return False, f"hermes hook HTTP {exc.code}: {detail}"
    except OSError as exc:
        return False, str(exc)


def _trigger_runtime(cfg: dict[str, str], job: dict[str, Any]) -> tuple[bool, str]:
    runtime = (cfg.get("EVOTOWN_RUNTIME") or "openclaw").strip()
    message = _format_dispatch_message(job)
    if runtime == "openclaw":
        return _trigger_openclaw(cfg, message)
    if runtime == "hermes":
        return _trigger_hermes(cfg, message, job)
    return False, f"connector dispatch not implemented for runtime={runtime}"


def _ingest_event(base: str, ingest: str, payload: dict[str, Any]) -> None:
    http_json("POST", f"{base}/api/v1/events", api_key=ingest, body=payload)


def _dispatch_wait_timeout(cfg: dict[str, str]) -> int:
    try:
        return max(30, int(cfg.get("EVOTOWN_DISPATCH_TIMEOUT") or "300"))
    except ValueError:
        return 300


def _dispatch_poll_interval(cfg: dict[str, str]) -> int:
    try:
        return max(2, int(cfg.get("EVOTOWN_DISPATCH_POLL_SEC") or "5"))
    except ValueError:
        return 5


def _dispatch_completion_mode(cfg: dict[str, str]) -> str:
    mode = (cfg.get("EVOTOWN_DISPATCH_COMPLETION") or "poll_run").strip().lower()
    if mode in {"hook_only", "hook_blocking", "blocking"}:
        return "hook_only"
    return "poll_run"


def _fetch_run_status(base: str, ingest: str, engine_id_value: str, run_id: str) -> dict[str, Any] | None:
    q = urllib.parse.urlencode({"engine_id": engine_id_value})
    status_code, raw = http_raw(
        "GET",
        f"{base}/api/v1/runs/{urllib.parse.quote(run_id)}/status?{q}",
        api_key=ingest,
        timeout=30,
    )
    if status_code != 200:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return None


def _post_run_completed(
    cfg: dict[str, str],
    base: str,
    ingest: str,
    *,
    run_id: str,
    job_id: str,
    status: str,
    exit_code: int,
    detail: str,
    signals: dict[str, Any] | None = None,
) -> None:
    eid = engine_id(cfg)
    version = cfg.get("EVOTOWN_ENGINE_VERSION") or "local"
    runtime = (cfg.get("EVOTOWN_RUNTIME") or "openclaw").strip()
    merged = {"dispatch_ok": status == "succeeded"}
    if signals:
        merged.update(signals)
    _ingest_event(
        base,
        ingest,
        {
            "run_id": run_id,
            "engine_id": eid,
            "event_type": "run.completed",
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "seq": 1,
            "engine_type": runtime if runtime in RUNTIMES else "custom",
            "engine_version": version,
            "task_id": job_id,
            "status": status,
            "exit_code": exit_code,
            "log_excerpt": detail[:2000],
            "signals": merged,
        },
    )


def _complete_dispatch_job(
    base: str,
    ingest: str,
    job_id: str,
    *,
    engine_id_value: str,
    run_id: str,
    status: str,
    exit_code: int,
    detail: str,
    signals: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    merged = {"dispatch_ok": status == "succeeded"}
    if signals:
        merged.update(signals)
    status_code, payload = http_json_soft(
        "POST",
        f"{base}/api/v1/jobs/{job_id}/complete",
        api_key=ingest,
        body={
            "engine_id": engine_id_value,
            "status": status,
            "exit_code": exit_code,
            "log_excerpt": detail[:8000],
            "result_summary": detail[:2000],
            "run_id": run_id,
            "signals": merged,
        },
    )
    if status_code >= 400:
        log(f"! complete HTTP {status_code}: {payload}")
        return None
    return payload


def _run_hook_worker(cfg: dict[str, str], job: dict[str, Any], out: dict[str, Any]) -> None:
    try:
        ok, detail = _trigger_runtime(cfg, job)
        out["ok"] = ok
        out["detail"] = detail
    except Exception as exc:  # noqa: BLE001
        out["ok"] = False
        out["detail"] = str(exc)
    finally:
        out["done"] = True


def _wait_for_agent_completion(
    cfg: dict[str, str],
    base: str,
    ingest: str,
    job: dict[str, Any],
    *,
    run_id: str,
    hook_box: dict[str, Any],
) -> tuple[str, int, str, str]:
    """Returns (status, exit_code, detail, completion_source)."""
    deadline = time.monotonic() + _dispatch_wait_timeout(cfg)
    poll_sec = _dispatch_poll_interval(cfg)
    eid = engine_id(cfg)
    mode = _dispatch_completion_mode(cfg)

    while time.monotonic() < deadline:
        if mode == "poll_run":
            run = _fetch_run_status(base, ingest, eid, run_id)
            if run and run.get("status") in _RUN_TERMINAL:
                st = str(run["status"])
                exit_code = int(run.get("exit_code") or 0)
                detail = (run.get("log_excerpt") or "").strip() or f"run {st}"
                return st, exit_code, detail, "run_status"

        if hook_box.get("done"):
            ok = bool(hook_box.get("ok"))
            detail = str(hook_box.get("detail") or "")
            if ok:
                return "succeeded", 0, detail, "hook"
            return "failed", 1, detail or "gateway hook failed", "hook"

        time.sleep(poll_sec)

    if hook_box.get("done"):
        ok = bool(hook_box.get("ok"))
        detail = str(hook_box.get("detail") or "")
        if ok:
            return "succeeded", 0, detail, "hook"
        return "failed", 1, detail or "gateway hook failed", "hook"

    return "failed", 1, f"timed out after {_dispatch_wait_timeout(cfg)}s waiting for agent", "timeout"


def _process_job(cfg: dict[str, str], base: str, ingest: str, job: dict[str, Any]) -> None:
    eid = engine_id(cfg)
    job_id = job["job_id"]
    run_id = job.get("run_id") or job_id
    version = cfg.get("EVOTOWN_ENGINE_VERSION") or "local"
    runtime = (cfg.get("EVOTOWN_RUNTIME") or "openclaw").strip()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    http_json("POST", f"{base}/api/v1/jobs/{job_id}/ack", api_key=ingest, body={"engine_id": eid})
    _ingest_event(
        base,
        ingest,
        {
            "run_id": run_id,
            "engine_id": eid,
            "event_type": "run.started",
            "ts": now,
            "seq": 0,
            "engine_type": runtime if runtime in RUNTIMES else "custom",
            "engine_version": version,
            "task_id": job_id,
            "payload": {"job_id": job_id, "kind": job.get("kind"), "title": job.get("title")},
        },
    )

    hook_box: dict[str, Any] = {"done": False, "ok": False, "detail": ""}
    hook_thread = threading.Thread(
        target=_run_hook_worker,
        args=(cfg, job, hook_box),
        name=f"evotown-hook-{job_id}",
        daemon=True,
    )
    hook_thread.start()

    if (job.get("kind") or "").strip() == "notify":
        ok, detail = _trigger_runtime(cfg, job)
        status = "succeeded" if ok else "failed"
        exit_code = 0 if ok else 1
        detail = detail or ("notify delivered" if ok else "notify hook failed")
        _post_run_completed(
            cfg,
            base,
            ingest,
            run_id=run_id,
            job_id=job_id,
            status=status,
            exit_code=exit_code,
            detail=detail,
            signals={"completion_source": "notify"},
        )
        payload = _complete_dispatch_job(
            base,
            ingest,
            job_id,
            engine_id_value=eid,
            run_id=run_id,
            status=status,
            exit_code=exit_code,
            detail=detail,
            signals={"completion_source": "notify"},
        )
        if payload and payload.get("follow_up_job"):
            f = payload["follow_up_job"]
            log(f"→ chained handoff job {f.get('job_id')}")
        log(f"✓ Job {job_id} notify → {status}: {detail[:120]}")
        return

    status, exit_code, detail, source = _wait_for_agent_completion(
        cfg, base, ingest, job, run_id=run_id, hook_box=hook_box
    )

    if source != "run_status":
        _post_run_completed(
            cfg,
            base,
            ingest,
            run_id=run_id,
            job_id=job_id,
            status=status,
            exit_code=exit_code,
            detail=detail,
            signals={"completion_source": source},
        )

    payload = _complete_dispatch_job(
        base,
        ingest,
        job_id,
        engine_id_value=eid,
        run_id=run_id,
        status=status,
        exit_code=exit_code,
        detail=detail,
        signals={"completion_source": source},
    )
    follow = (payload or {}).get("follow_up_job")
    if follow:
        log(f"→ chained handoff job {follow.get('job_id')} → {follow.get('target_team_id') or follow.get('target_engine_id')}")
    log(f"✓ Job {job_id} → {status} ({source}): {detail[:120]}")


def cmd_complete(
    cfg: dict[str, str],
    *,
    job_id: str,
    status: str,
    summary: str,
    exit_code: int,
) -> int:
    """Agent/runtime calls this after real work finishes (posts run.completed + job complete)."""
    ingest = ingest_token(cfg)
    if not ingest:
        die("EVOTOWN_ENGINE_INGEST_TOKEN required for complete")
    if status not in _RUN_TERMINAL:
        die(f"status must be one of {sorted(_RUN_TERMINAL)}")
    base = (cfg.get("EVOTOWN_URL") or "").rstrip("/")
    eid = engine_id(cfg)
    run_id = job_id
    _post_run_completed(
        cfg,
        base,
        ingest,
        run_id=run_id,
        job_id=job_id,
        status=status,
        exit_code=exit_code,
        detail=summary,
        signals={"completion_source": "agent_cli"},
    )
    payload = _complete_dispatch_job(
        base,
        ingest,
        job_id,
        engine_id_value=eid,
        run_id=run_id,
        status=status,
        exit_code=exit_code,
        detail=summary,
        signals={"completion_source": "agent_cli"},
    )
    if payload is None:
        die("complete failed")
    log(f"✓ Job {job_id} completed ({status})")
    return 0


def cmd_handoff(
    cfg: dict[str, str],
    *,
    to_engine: str,
    to_team: str,
    message: str,
    title: str,
    kind: str,
) -> int:
    ingest = ingest_token(cfg)
    if not ingest:
        die("EVOTOWN_INGEST_TOKEN required for handoff")
    if not to_engine and not to_team:
        die("specify --to-engine or --to-team")
    base = (cfg.get("EVOTOWN_URL") or "").rstrip("/")
    eid = engine_id(cfg)
    body = {
        "kind": kind,
        "source_engine_id": eid,
        "target_engine_id": to_engine or None,
        "target_team_id": to_team or None,
        "title": title,
        "message": message,
    }
    status, payload = http_json_soft("POST", f"{base}/api/v1/jobs/from-engine", api_key=ingest, body=body)
    if status >= 400:
        die(f"handoff failed HTTP {status}: {payload}")
    job = payload.get("job", {})
    log(f"✓ Handoff queued: {job.get('job_id')} → {to_engine or ('team:' + to_team)}")
    return 0


def _gateway_reachable(cfg: dict[str, str]) -> bool | None:
    runtime = (cfg.get("EVOTOWN_RUNTIME") or "openclaw").strip()
    if runtime == "openclaw":
        probe = (cfg.get("OPENCLAW_HOOK_URL") or "http://127.0.0.1:18789/hooks/agent").rsplit("/", 1)[0]
        try:
            urllib.request.urlopen(probe, timeout=2)
            return True
        except OSError:
            return False
    if runtime == "hermes":
        probe = (cfg.get("HERMES_HOOK_URL") or "http://127.0.0.1:18789").rsplit("/", 2)[0]
        try:
            urllib.request.urlopen(probe, timeout=2)
            return True
        except OSError:
            return False
    return None


def cmd_connector(cfg: dict[str, str], poll_sec: int, once: bool, long_poll: int) -> int:
    ingest = ingest_token(cfg)
    if not ingest:
        die("EVOTOWN_ENGINE_INGEST_TOKEN (evi_…) required for connector — run register --save-token first")
    if not ingest.startswith("evi_"):
        log("! Warning: connector should use per-engine evi_ token, not the IT bootstrap token.")
    base = (cfg.get("EVOTOWN_URL") or "").rstrip("/")
    eid = engine_id(cfg)
    if not ingest.startswith("evi_"):
        cmd_register(cfg)

    log(f"Connector {CONNECTOR_VERSION} for {eid} @ {base} (poll {poll_sec}s, long_poll {long_poll}s)")
    while True:
        try:
            version = cfg.get("EVOTOWN_ENGINE_VERSION") or "local"
            http_json_soft(
                "POST",
                f"{base}/api/v1/engines/{eid}/heartbeat",
                api_key=ingest,
                body={
                    "engine_version": version,
                    "connector_version": CONNECTOR_VERSION,
                    "gateway_reachable": _gateway_reachable(cfg),
                },
            )

            lease_url = (
                f"{base}/api/v1/jobs/lease?engine_id={urllib.parse.quote(eid)}&timeout={max(0, min(long_poll, 60))}"
            )
            status_code, raw = http_raw("GET", lease_url, api_key=ingest, timeout=max(10, long_poll + 10))
            if status_code == 200 and raw:
                job = json.loads(raw.decode("utf-8"))
                _process_job(cfg, base, ingest, job)
            elif status_code not in {204, 200}:
                log(f"! lease HTTP {status_code}: {raw.decode('utf-8', errors='replace')[:200]}")
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001 — keep daemon alive
            log(f"! connector loop error: {exc}")

        if once:
            return 0
        time.sleep(max(3, poll_sec))


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
    p_reg = sub.add_parser("register", help="Register this laptop engine (requires IT bootstrap ingest token)")
    p_reg.add_argument("--save-token", action="store_true", help="Write issued evi_ token to config file")
    p_reg.add_argument("--rotate", action="store_true", help="Rotate per-engine ingest token")
    p_conn = sub.add_parser("connector", help="Poll Evotown for jobs and trigger local OpenClaw/Hermes gateway")
    p_conn.add_argument("--poll", type=int, default=15, help="Seconds between lease polls (min 3)")
    p_conn.add_argument("--long-poll", type=int, default=25, help="Server-side lease wait seconds (max 60)")
    p_conn.add_argument("--once", action="store_true", help="Process at most one job then exit")
    p_hand = sub.add_parser("handoff", help="Queue handoff to another engine or team")
    p_hand.add_argument("--to-engine", default="", help="Target engine_id")
    p_hand.add_argument("--to-team", default="", help="Target owner_team")
    p_hand.add_argument("--title", default="", help="Short title")
    p_hand.add_argument("--message", required=True, help="Task message for the receiving agent")
    p_hand.add_argument("--kind", default="handoff", choices=["handoff", "notify", "dispatch"])
    p_done = sub.add_parser("complete", help="Mark dispatch job done after agent finished (ingest)")
    p_done.add_argument("--job-id", required=True, help="Dispatch job_id (also used as run_id)")
    p_done.add_argument("--status", default="succeeded", choices=sorted(_RUN_TERMINAL))
    p_done.add_argument("--summary", default="", help="Result summary / log excerpt")
    p_done.add_argument("--exit-code", type=int, default=None, help="Exit code (default 0 if succeeded)")
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
        return cmd_register(cfg, save_token=args.save_token, rotate=args.rotate)
    if args.command == "connector":
        try:
            return cmd_connector(cfg, args.poll, args.once, args.long_poll)
        except KeyboardInterrupt:
            log("\nConnector stopped.")
            return 0
    if args.command == "handoff":
        return cmd_handoff(
            cfg,
            to_engine=args.to_engine,
            to_team=args.to_team,
            message=args.message,
            title=args.title,
            kind=args.kind,
        )
    if args.command == "complete":
        exit_code = args.exit_code
        if exit_code is None:
            exit_code = 0 if args.status == "succeeded" else 1
        return cmd_complete(
            cfg,
            job_id=args.job_id,
            status=args.status,
            summary=args.summary or f"completed via CLI ({args.status})",
            exit_code=exit_code,
        )
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
