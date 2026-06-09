#!/usr/bin/env bash
# Evotown hosted Claude Code runner (non-interactive).
#
# Invoked via EVOTOWN_CLAUDE_CODE_COMMAND with placeholders:
#   {prompt} {model} {workspace} {run_id}
#
# Requires: `claude` CLI on PATH and ANTHROPIC_API_KEY (or `claude setup-token`).
set -euo pipefail

PROMPT=${1:-${EVOTOWN_AGENT_PROMPT:-}}
MODEL=${2:-${EVOTOWN_CLAUDE_MODEL:-claude-sonnet-4}}
WORKSPACE=${3:-${EVOTOWN_WORKSPACE_ROOT:-.}}
RUN_ID=${4:-${EVOTOWN_AGENT_RUN_ID:-}}

if [[ -z "${PROMPT}" ]]; then
  echo "missing prompt" >&2
  exit 2
fi

cd "${WORKSPACE}"

ARGS=(
  -p "${PROMPT}"
  --model "${MODEL}"
  --allowedTools "Read,Edit,Bash,Glob,Grep,Write"
)

if [[ -f .evotown/AGENT_CONTEXT.md ]]; then
  ARGS+=(--append-system-prompt-file .evotown/AGENT_CONTEXT.md)
fi

# Load workspace MCP servers when present (skipped with --bare).
if [[ -f .mcp.json ]]; then
  : # Claude Code auto-discovers .mcp.json in cwd for interactive; for -p without --bare it loads project config.
fi

export EVOTOWN_AGENT_RUN_ID="${RUN_ID}"
export EVOTOWN_WORKSPACE_ROOT="${WORKSPACE}"

exec claude "${ARGS[@]}"
