#!/usr/bin/env bash
# Evotown 企业一键部署：Docker + LiteLLM + 员工 API Key
#
# 用法（在 evotown 仓库根目录）：
#   ./scripts/enterprise-deploy.sh
#   EVOTOWN_PUBLIC_URL=https://evotown.company.internal ./scripts/enterprise-deploy.sh
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

gen_secret() {
  python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
}

ensure_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    [[ -f "$TEMPLATE" ]] || die "缺少模板 $TEMPLATE"
    cp "$TEMPLATE" "$ENV_FILE"
    log "已创建 $ENV_FILE"
  fi

  # shellcheck disable=SC1090
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a

  local changed=0
  set_env_if_empty() {
    local key="$1"
    local val="$2"
    if ! grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
      printf '\n%s=%s\n' "$key" "$val" >>"$ENV_FILE"
      changed=1
      return
    fi
    local current
    current="$(grep "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
    if [[ -z "$current" ]]; then
      if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
      else
        sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
      fi
      changed=1
    fi
  }

  set_env_if_empty "ADMIN_TOKEN" "$(gen_secret)"
  set_env_if_empty "EVOTOWN_ENGINE_INGEST_TOKEN" "$(gen_secret)"
  set_env_if_empty "LITELLM_MASTER_KEY" "$(gen_secret)"

  if [[ -n "$UPSTREAM_BASE_URL" ]]; then
    set_env_if_empty "BASE_URL" "$UPSTREAM_BASE_URL"
  fi
  if [[ -n "$UPSTREAM_API_KEY" ]]; then
    set_env_if_empty "API_KEY" "$UPSTREAM_API_KEY"
  fi
  set_env_if_empty "MODEL" "$UPSTREAM_MODEL"
  set_env_if_empty "EVOTOWN_PUBLIC_URL" "$PUBLIC_URL"
  set_env_if_empty "PORT" "8080"
  set_env_if_empty "LITELLM_BASE_URL" "http://litellm:4000/v1"
  set_env_if_empty "EVOTOWN_ALLOW_PUBLIC_REGISTER" "0"

  if [[ "$changed" -eq 1 ]]; then
    log "已写入/补全 .env 密钥与默认值"
  fi

  # shellcheck disable=SC1090
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a

  PUBLIC_URL="${EVOTOWN_PUBLIC_URL:-$PUBLIC_URL}"

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
    -d '{"label":"employee-default","scopes":["gateway.chat","console.read"]}')"

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
  - openclaw.evotown.yaml
  - hermes.evotown.yaml

请将 evotown.agent.env 通过 MDM / 内网文档分发给员工，勿提交到 git。
EOF
}

main() {
  log "Evotown 企业一键部署（目录：$ROOT）"
  ensure_env

  log "启动 Docker 服务（含 LiteLLM profile）…"
  docker compose --profile litellm up -d --build

  wait_for_health 90

  local api_key
  api_key="$(create_employee_key)"
  write_employee_bundle "$api_key"

  log "完成。员工配置见：$OUTPUT_DIR/evotown.agent.env"
  cat "$OUTPUT_DIR/IT_DEPLOY_SUMMARY.txt"
}

main "$@"
