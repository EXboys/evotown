#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$ROOT/integrations/openclaw/evotown"
OUT="$PLUGIN/evotown-openclaw-plugin.tgz"
tar -czf "$OUT" -C "$PLUGIN" openclaw.plugin.json package.json index.js README.md
echo "Packaged $OUT"
