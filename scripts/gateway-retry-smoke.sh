#!/usr/bin/env bash
# 本地快速验证 Gateway 重试/降级（需先启动 backend，见下方说明）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1:8765}"
ADMIN_TOKEN="${ADMIN_TOKEN:-local-dev-admin}"
ALIAS="${ALIAS:-retry-test}"
PRIMARY="${PRIMARY:-gpt-4o-mini}"
FALLBACK="${FALLBACK:-qwen-plus}"

echo "==> Gateway health"
curl -sf "${BASE_URL}/api/gateway/v1/health" | python3 -m json.tool

echo ""
echo "==> 创建/更新别名路由（primary + fallback）"
ROUTE_JSON=$(cat <<EOF
{
  "alias": "${ALIAS}",
  "target_model": "${PRIMARY}",
  "fallback_models": ["${FALLBACK}"],
  "enable_fallback": true,
  "retry_policy": {"max_retries_same_model": 1}
}
EOF
)
curl -sf -X POST "${BASE_URL}/api/gateway/v1/model-routes" \
  -H "X-Admin-Token: ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${ROUTE_JSON}" | python3 -m json.tool

echo ""
echo "==> 列出路由"
curl -sf "${BASE_URL}/api/gateway/v1/model-routes" \
  -H "X-Admin-Token: ${ADMIN_TOKEN}" | python3 -m json.tool

echo ""
echo "==> Chat 测试（需配置 Gateway API Key 或 ADMIN + EVOTOWN_DEV_ALLOW_ADMIN_AS_GATEWAY=1）"
echo "    export GATEWAY_KEY=你的 key"
echo "    curl -s ${BASE_URL}/api/gateway/v1/chat/completions \\"
echo "      -H \"Authorization: Bearer \$GATEWAY_KEY\" \\"
echo "      -H \"Content-Type: application/json\" \\"
echo "      -d '{\"model\":\"${ALIAS}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}' \\"
echo "      -D - -o /tmp/gw-reply.json"
echo "    查看响应头: X-Evotown-Final-Model, X-Evotown-Upstream-Attempts"
echo "    查看审计: GET ${BASE_URL}/api/gateway/v1/requests (admin)"

echo ""
echo "==> 单元测试（不依赖真实上游）"
cd "${ROOT}/backend"
python -m pytest tests/test_gateway_retry.py -q
