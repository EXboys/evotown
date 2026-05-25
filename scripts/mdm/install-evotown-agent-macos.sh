#!/usr/bin/env bash
# macOS 员工机批量下发 Evotown agent 配置（Jamf / Intune 可调用）
set -euo pipefail

EVOTOWN_ENV_SOURCE="${EVOTOWN_ENV_SOURCE:-/Library/Application Support/Evotown/evotown.agent.env}"
CONFIG_DIR="${HOME}/.config/evotown"
SETUP="${EVOTOWN_SETUP_SCRIPT:-/usr/local/bin/evotown-agent-setup.py}"

mkdir -p "$CONFIG_DIR"
if [[ ! -f "$EVOTOWN_ENV_SOURCE" ]]; then
  echo "Missing IT env file: $EVOTOWN_ENV_SOURCE" >&2
  exit 1
fi
install -m 600 "$EVOTOWN_ENV_SOURCE" "$CONFIG_DIR/evotown.agent.env"

if [[ -x "$SETUP" ]] || [[ -f "$SETUP" ]]; then
  python3 "$SETUP" --config "$CONFIG_DIR/evotown.agent.env" check
  python3 "$SETUP" --config "$CONFIG_DIR/evotown.agent.env" sync
else
  echo "WARN: evotown-agent-setup.py not found at $SETUP — skipped sync"
fi

# 每 4 小时自动同步 SkillHub（launchd 可替代）
(crontab -l 2>/dev/null | grep -v evotown-agent-setup || true; \
  echo "0 */4 * * * python3 $SETUP --config $CONFIG_DIR/evotown.agent.env sync >/tmp/evotown-sync.log 2>&1") | crontab -

echo "Evotown agent configured for $(whoami)"
