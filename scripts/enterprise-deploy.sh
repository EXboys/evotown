#!/usr/bin/env bash
# Evotown 企业一键部署：Docker + LiteLLM + 员工 API Key
#
# 用法（在 evotown 仓库根目录）：
#   ./scripts/enterprise-deploy.sh
#   EVOTOWN_PUBLIC_URL=https://evotown.company.internal ./scripts/enterprise-deploy.sh
#   ./scripts/enterprise-deploy.sh --check   # 生产巡检（health / gateway / SQLite / 加固）
#   ./scripts/enterprise-deploy.sh --gc      # 磁盘清理（dangling 镜像 + builder；可选主机缓存/journal）
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-$ROOT/.env}"
TEMPLATE="${TEMPLATE:-$ROOT/docs/templates/env.enterprise.example}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT/deploy-output}"
PUBLIC_URL="${EVOTOWN_PUBLIC_URL:-http://127.0.0.1:8080}"
UPSTREAM_BASE_URL="${UPSTREAM_BASE_URL:-}"
UPSTREAM_API_KEY="${UPSTREAM_API_KEY:-}"
UPSTREAM_MODEL="${UPSTREAM_MODEL:-gpt-4o-mini}"
TEAM_ID="${EVOTOWN_TEAM_ID:-default}"
ACCOUNT_NAME="${EVOTOWN_ACCOUNT_NAME:-Enterprise Agents}"

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "需要 Docker。请先安装 Docker Desktop 或 Docker Engine。"
docker compose version >/dev/null 2>&1 || die "需要 Docker Compose v2（docker compose）。"

# Safe pre-build cleanup: dangling images only + unused build cache.
# Never uses `docker image prune -af` (would drop unused-but-tagged rollback images).
prune_docker_light() {
  log "Docker 轻量清理（dangling images + builder cache）…"
  df -h / 2>/dev/null | tail -1 || true
  docker image prune -f || true
  # Drop build cache older than 7 days; keeps recent layer reuse for this deploy.
  docker builder prune -f --filter until=168h 2>/dev/null || docker builder prune -f || true
  df -h / 2>/dev/null | tail -1 || true
}

# Host-side GC for Linux prod boxes (pip / HF caches + systemd journal).
# Skips quietly on macOS / non-root. Monthly-ish: also prune stopped containers + unused networks.
prune_host_disk() {
  log "主机磁盘清理…"
  df -h / 2>/dev/null | tail -1 || true

  log "Docker 清理（dangling images + 全部未用 builder cache）…"
  docker image prune -f || true
  # --gc 场景：清掉全部未用 build cache（部署前的 light prune 仍保留近 7 天缓存）
  docker builder prune -af || docker builder prune -f || true
  docker container prune -f || true
  docker network prune -f || true

  if [[ "$(uname -s)" != "Linux" ]]; then
    log "非 Linux，跳过 pip/huggingface/journal 清理"
    df -h / 2>/dev/null | tail -1 || true
    log "磁盘清理完成"
    return 0
  fi

  local cache_root="${HOME:-/root}/.cache"
  if [[ -d "$cache_root/pip" ]]; then
    log "清理 $cache_root/pip"
    rm -rf "$cache_root/pip"
  fi
  if [[ -d "$cache_root/huggingface" ]]; then
    log "清理 $cache_root/huggingface"
    rm -rf "$cache_root/huggingface"
  fi

  if [[ "$(id -u)" -eq 0 ]] && command -v journalctl >/dev/null 2>&1; then
    log "压缩 journal 至 ≤200M"
    journalctl --vacuum-size=200M || true
  else
    log "跳过 journal vacuum（需要 root + journalctl）"
  fi

  df -h / 2>/dev/null | tail -1 || true
  docker system df 2>/dev/null || true
  log "磁盘清理完成"
}

gen_secret() {
  python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
}

is_env_placeholder() {
  local key="$1"
  local val="$2"
  [[ -z "$val" ]] && return 0
  case "$key" in
    API_KEY)
      [[ "$val" == "your-upstream-llm-api-key" || "$val" == "your-api-key-here" ]]
      ;;
    EVOTOWN_PUBLIC_URL)
      [[ "$val" == "http://127.0.0.1:8080" ]]
      ;;
    CORS_ORIGINS)
      [[ "$val" == "*" || -z "$val" ]]
      ;;
    *)
      return 1
      ;;
  esac
}

env_truthy() {
  local val="${1:-}"
  case "$(printf '%s' "$val" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

set_env_value() {
  local key="$1"
  local val="$2"
  local force="${3:-0}"
  [[ -n "$val" ]] || return 0

  local current=""
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    current="$(grep "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
  fi

  if [[ "$force" -eq 1 ]] || [[ -z "$current" ]] || is_env_placeholder "$key" "$current"; then
    if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
      if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
      else
        sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
      fi
    else
      printf '\n%s=%s\n' "$key" "$val" >>"$ENV_FILE"
    fi
  fi
}

ensure_env() {
  # Capture shell overrides before sourcing .env (template values must not clobber exports).
  local deploy_public_url="${EVOTOWN_PUBLIC_URL:-}"
  local deploy_base_url="${UPSTREAM_BASE_URL:-${BASE_URL:-}}"
  local deploy_api_key="${UPSTREAM_API_KEY:-${API_KEY:-}}"
  local deploy_model="${UPSTREAM_MODEL:-${MODEL:-}}"
  local had_public_url=0 had_base_url=0 had_api_key=0 had_model=0
  [[ -n "${EVOTOWN_PUBLIC_URL+x}" ]] && had_public_url=1
  [[ -n "${UPSTREAM_BASE_URL+x}" || -n "${BASE_URL+x}" ]] && had_base_url=1
  [[ -n "${UPSTREAM_API_KEY+x}" || -n "${API_KEY+x}" ]] && had_api_key=1
  [[ -n "${UPSTREAM_MODEL+x}" || -n "${MODEL+x}" ]] && had_model=1

  if [[ ! -f "$ENV_FILE" ]]; then
    [[ -f "$TEMPLATE" ]] || die "缺少模板 $TEMPLATE"
    cp "$TEMPLATE" "$ENV_FILE"
    log "已创建 $ENV_FILE"
  fi

  local changed=0

  set_env_value "ADMIN_TOKEN" "$(gen_secret)"
  set_env_value "EVOTOWN_ENGINE_INGEST_TOKEN" "$(gen_secret)"
  set_env_value "LITELLM_MASTER_KEY" "$(gen_secret)"

  if [[ "$had_base_url" -eq 1 ]]; then
    set_env_value "BASE_URL" "$deploy_base_url" 1
  fi
  if [[ "$had_api_key" -eq 1 ]]; then
    set_env_value "API_KEY" "$deploy_api_key" 1
  fi
  if [[ "$had_model" -eq 1 ]]; then
    set_env_value "MODEL" "$deploy_model" 1
  else
    set_env_value "MODEL" "$UPSTREAM_MODEL"
  fi
  if [[ "$had_public_url" -eq 1 ]]; then
    set_env_value "EVOTOWN_PUBLIC_URL" "$deploy_public_url" 1
  else
    set_env_value "EVOTOWN_PUBLIC_URL" "$PUBLIC_URL"
  fi
  set_env_value "PORT" "8080"
  set_env_value "LITELLM_BASE_URL" "http://litellm:4000/v1"
  set_env_value "EVOTOWN_ALLOW_PUBLIC_REGISTER" "0" 1
  set_env_value "EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY" "0" 1
  set_env_value "EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK" "0" 1
  set_env_value "EVOTOWN_CLAUDE_USE_GATEWAY" "1"
  set_env_value "EVOTOWN_CLAUDE_GATEWAY_BASE_URL" "http://backend:8765/api/gateway/anthropic"
  set_env_value "EVOTOWN_CLAUDE_EXECUTION_MODE" "sdk"
  set_env_value "EVOTOWN_CLAUDE_RUN_TIMEOUT_SEC" "600"
  changed=1

  if [[ "$changed" -eq 1 ]]; then
    log "已写入/补全 .env 密钥与默认值"
  fi

  # shellcheck disable=SC1090
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a

  PUBLIC_URL="${EVOTOWN_PUBLIC_URL:-$PUBLIC_URL}"
  # CORS：仅当 * / 空时写入公网 URL（已有显式域名不覆盖）
  set_env_value "CORS_ORIGINS" "${PUBLIC_URL%/}"
  # 重新 source，确保后续 create_employee_key 等看到最新 CORS
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a

  if [[ -z "${API_KEY:-}" || "${API_KEY}" == "your-upstream-llm-api-key" ]]; then
    die "请在 $ENV_FILE 中设置上游大模型 API_KEY（及 BASE_URL / MODEL），然后重新运行。"
  fi
}

wait_for_health() {
  local base="${PUBLIC_URL%/}"
  local attempts="${1:-60}"
  log "等待 Evotown 就绪：$base/health"
  for i in $(seq 1 "$attempts"); do
    if curl -fsS "$base/health" >/dev/null 2>&1; then
      log "服务已就绪"
      return 0
    fi
    sleep 2
  done
  die "超时：$base/health 不可达。请检查 docker compose logs backend frontend"
}

check_backend_health() {
  local base="${PUBLIC_URL%/}"
  local body
  body="$(curl -fsS "$base/health")" || return 1
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("status")=="ok"' <<<"$body"
}

check_env_hardening() {
  # Fail closed on known-insecure enterprise defaults in .env
  local failed=0
  if env_truthy "${EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY:-0}"; then
    log "  FAIL: EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY 必须为 0"
    failed=1
  fi
  if env_truthy "${EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK:-0}"; then
    log "  FAIL: EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK 必须为 0"
    failed=1
  fi
  if env_truthy "${EVOTOWN_ALLOW_PUBLIC_REGISTER:-0}"; then
    log "  FAIL: EVOTOWN_ALLOW_PUBLIC_REGISTER 必须为 0"
    failed=1
  fi
  local cors="${CORS_ORIGINS:-}"
  if [[ -z "$cors" || "$cors" == "*" ]]; then
    log "  FAIL: CORS_ORIGINS 不能为 * 或空（请设为 EVOTOWN_PUBLIC_URL）"
    failed=1
  fi
  return "$failed"
}

check_runtime_hardening() {
  local base="${PUBLIC_URL%/}"
  local body
  body="$(curl -fsS "$base/health")" || return 1
  python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d.get("status") == "ok"
if d.get("hardening_ok") is False:
    for w in d.get("security_warnings") or []:
        print(" -", w, file=sys.stderr)
    raise SystemExit(1)
' <<<"$body"
}

check_gateway_health() {
  local base="${PUBLIC_URL%/}"
  local body
  body="$(curl -fsS "$base/api/gateway/v1/health")" || return 1
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("status")=="ok"' <<<"$body"
}

check_data_writable() {
  docker compose exec -T backend python3 <<'PY'
import os
import sqlite3
from pathlib import Path

data = Path(os.environ.get("EVOTOWN_DATA_DIR", "/app/data"))
data.mkdir(parents=True, exist_ok=True)
probe = data / ".healthcheck_write_probe"
probe.write_text("ok", encoding="utf-8")
probe.unlink()

db = data / "gateway.db"
if db.exists():
    conn = sqlite3.connect(str(db))
    conn.execute("SELECT 1")
    conn.close()
    print(f"gateway.db ok ({db})")
else:
    test_db = data / ".healthcheck_sqlite_probe"
    conn = sqlite3.connect(str(test_db))
    conn.execute("CREATE TABLE IF NOT EXISTS t (x INT)")
    conn.execute("INSERT INTO t VALUES (1)")
    conn.close()
    test_db.unlink()
    print(f"sqlite write ok ({data}; gateway.db not yet created)")

print(f"data dir writable: {data}")
PY
}

check_docker_backend_healthy() {
  local status
  status="$(docker compose ps backend --format '{{.Health}}' 2>/dev/null | head -1)"
  [[ "$status" == "healthy" ]]
}

run_ops_health_check() {
  local base="${PUBLIC_URL%/}"
  local failed=0

  log "Evotown 生产巡检：$base"
  log "文档：docs/zh-CN/ENTERPRISE_DEPLOY_RUNBOOK.md"

  if ! docker compose ps --status running 2>/dev/null | grep -qE '(^| )backend( |$)'; then
    die "backend 容器未运行。请先：docker compose --profile litellm up -d"
  fi

  log "[1/5] Backend GET /health"
  if check_backend_health; then
    log "  OK"
  else
    log "  FAIL"
    failed=1
  fi

  log "[2/5] Gateway GET /api/gateway/v1/health"
  if check_gateway_health; then
    local litellm_ok
    litellm_ok="$(curl -fsS "$base/api/gateway/v1/health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("litellm_configured"))')"
    log "  OK (litellm_configured=${litellm_ok})"
  else
    log "  FAIL"
    failed=1
  fi

  log "[3/5] SQLite 数据目录 /app/data 可写"
  if check_data_writable; then
    log "  OK"
  else
    log "  FAIL"
    failed=1
  fi

  log "[4/5] Docker backend healthcheck"
  if check_docker_backend_healthy; then
    log "  OK"
  else
    log "  FAIL (expected healthy; got: $(docker compose ps backend --format '{{.Health}}' 2>/dev/null | head -1 || echo unknown))"
    failed=1
  fi

  log "[5/5] 生产加固（.env + /health hardening_ok）"
  local harden_failed=0
  if ! check_env_hardening; then
    harden_failed=1
  fi
  if ! check_runtime_hardening; then
    harden_failed=1
  fi
  if [[ "$harden_failed" -eq 0 ]]; then
    log "  OK"
  else
    log "  FAIL — 关闭 DEV 旁路、公开注册，并将 CORS_ORIGINS 设为 EVOTOWN_PUBLIC_URL"
    failed=1
  fi

  if [[ "$failed" -ne 0 ]]; then
    die "巡检未通过。请查看 docker compose logs backend frontend litellm；加固项见 docs/zh-CN/ENTERPRISE_DEPLOY_RUNBOOK.md"
  fi
  log "全部检查通过"
}

create_employee_key() {
  local base="${PUBLIC_URL%/}"
  local admin="${ADMIN_TOKEN:?ADMIN_TOKEN missing}"

  log "创建企业员工账号与 API Key…"
  local account_resp
  account_resp="$(curl -fsS -X POST "$base/api/v1/accounts" \
    -H "X-Admin-Token: $admin" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$ACCOUNT_NAME\",\"team_id\":\"$TEAM_ID\",\"owner_email\":\"it@company.internal\",\"notes\":\"enterprise-deploy.sh\"}")"

  local account_id
  account_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["account"]["account_id"])' <<<"$account_resp")"

  local key_resp
  key_resp="$(curl -fsS -X POST "$base/api/v1/accounts/${account_id}/keys" \
    -H "X-Admin-Token: $admin" \
    -H "Content-Type: application/json" \
    -d '{"label":"employee-default","scopes":["gateway.chat","console.read","console.write","agent.run"]}')"

  python3 -c 'import json,sys; print(json.load(sys.stdin)["secret"])' <<<"$key_resp"
}

write_employee_bundle() {
  local api_key="$1"
  local base="${PUBLIC_URL%/}"
  mkdir -p "$OUTPUT_DIR"

  cat >"$OUTPUT_DIR/evotown.agent.env" <<EOF
# Evotown 员工端配置 — 复制到本机 OpenClaw / Hermes 配置目录
# 仅需两行有效配置（其余为注释说明）：
EVOTOWN_URL=${base}
EVOTOWN_API_KEY=${api_key}
EOF

  cat >"$OUTPUT_DIR/openclaw.evotown.yaml" <<EOF
# OpenClaw — 引用 evotown.agent.env 中的两行配置
llm:
  openai_base_url: \${EVOTOWN_URL}/api/gateway/v1
  openai_api_key: \${EVOTOWN_API_KEY}

skills_market:
  manifest_url: \${EVOTOWN_URL}/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=openclaw
  auth_header: Authorization
  auth_prefix: "Bearer "
  auth_token: \${EVOTOWN_API_KEY}
  channel: stable
EOF

  cat >"$OUTPUT_DIR/hermes.evotown.yaml" <<EOF
# Hermes — 引用 evotown.agent.env 中的两行配置
model:
  base_url: \${EVOTOWN_URL}/api/gateway/v1
  api_key: \${EVOTOWN_API_KEY}

skills_market:
  manifest_url: \${EVOTOWN_URL}/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=hermes
  auth_header: Authorization
  auth_prefix: "Bearer "
  auth_token: \${EVOTOWN_API_KEY}
  install_scope: team
EOF

  cat >"$OUTPUT_DIR/coding-agent.env" <<EOF
# Coding Agent 服务端配置 — 写入服务器 $ENV_FILE（勿提交 git）
EVOTOWN_CLAUDE_USE_GATEWAY=1
EVOTOWN_CLAUDE_GATEWAY_BASE_URL=http://backend:8765/api/gateway/anthropic
EVOTOWN_CLAUDE_GATEWAY_API_KEY=${api_key}
EVOTOWN_CLAUDE_EXECUTION_MODE=sdk
EVOTOWN_CLAUDE_RUN_TIMEOUT_SEC=600
EOF

  set_env_value "EVOTOWN_CLAUDE_GATEWAY_API_KEY" "$api_key" 1
  set_env_value "CORS_ORIGINS" "${base}" 1

  cat >"$OUTPUT_DIR/IT_DEPLOY_SUMMARY.txt" <<EOF
Evotown 企业部署完成
====================

控制台：     ${base}/
Skills 市场：  ${base}/market
管理后台：   ${base}/skills

员工两行配置（evotown.agent.env）：
  EVOTOWN_URL=${base}
  EVOTOWN_API_KEY=${api_key}

模型网关（OpenAI 兼容）：
  OPENAI_BASE_URL=${base}/api/gateway/v1
  OPENAI_API_KEY=<同上 EVOTOWN_API_KEY>

Skills manifest（Bearer 同上 key）：
  ${base}/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=openclaw
  ${base}/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=hermes

配置文件目录：${OUTPUT_DIR}/
  - evotown.agent.env
  - coding-agent.env
  - openclaw.evotown.yaml
  - hermes.evotown.yaml

Coding Agent（/coding-agent）：
  将 coding-agent.env 中的变量合并进服务器 .env 后 docker compose up -d
  文档：docs/zh-CN/CODING_AGENT_AND_GATEWAY.md

引擎 ingest：
  服务器 .env：EVOTOWN_ENGINE_INGEST_TOKEN（IT bootstrap，仅 register/轮换，勿下发员工镜像）
  员工机：register --save-token 后写入 EVOTOWN_ENGINE_INGEST_TOKEN=evi_…

派活控制台：${base}/dispatch
员工机：evotown-agent-setup.py register --save-token && evotown-agent-setup.py connector
文档：docs/zh-CN/AGENT_DISPATCH.md、docs/zh-CN/MDM_AGENT_ROLLOUT.md

请将 evotown.agent.env 通过 MDM / 内网文档分发给员工，勿提交到 git。
EOF
}

main() {
  if [[ "${1:-}" == "--check" ]]; then
    [[ -f "$ENV_FILE" ]] || die "缺少 $ENV_FILE，请先运行部署或从模板创建"
    # shellcheck disable=SC1090
    set -a
    # shellcheck source=/dev/null
    source "$ENV_FILE"
    set +a
    PUBLIC_URL="${EVOTOWN_PUBLIC_URL:-$PUBLIC_URL}"
    run_ops_health_check
    return 0
  fi

  if [[ "${1:-}" == "--gc" || "${1:-}" == "--prune" ]]; then
    prune_host_disk
    return 0
  fi

  log "Evotown 企业一键部署（目录：$ROOT）"
  ensure_env

  prune_docker_light

  log "启动 Docker 服务（含 LiteLLM profile）…"
  docker compose --profile litellm up -d --build

  wait_for_health 90

  local api_key
  api_key="$(create_employee_key)"
  write_employee_bundle "$api_key"

  log "完成。员工配置见：$OUTPUT_DIR/evotown.agent.env"
  log "  CLI: sudo install -m 755 $ROOT/scripts/evotown-agent-setup.py /usr/local/bin/evotown-agent-setup.py"
  cat "$OUTPUT_DIR/IT_DEPLOY_SUMMARY.txt"
}

main "$@"
