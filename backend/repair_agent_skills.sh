#!/bin/bash
# Repair agent-browser skills for all existing arena agents.
# This fixes broken symlinks caused by shutil.copytree without symlinks=True.

SOURCE="$(cd "$(dirname "$0")/arena_skills" && pwd)"
ARENA_DIR="$HOME/.skilllite/arena"

if [ ! -d "$SOURCE" ]; then
  echo "ERROR: arena_skills not found at $SOURCE"
  exit 1
fi

if [ ! -d "$ARENA_DIR" ]; then
  echo "ERROR: arena dir not found at $ARENA_DIR"
  exit 1
fi

echo "Source: $SOURCE"
echo "Arena:  $ARENA_DIR"
echo ""

for agent_dir in "$ARENA_DIR"/agent_*; do
  [ -d "$agent_dir" ] || continue
  agent=$(basename "$agent_dir")
  skills_dir="$agent_dir/.skills"
  mkdir -p "$skills_dir"

  for skill_src in "$SOURCE"/*/; do
    [ -d "$skill_src" ] || continue
    skill_name=$(basename "$skill_src")
    skill_dst="$skills_dir/$skill_name"

    if [ -d "$skill_dst" ] && [ -d "$skill_src/node_modules" ]; then
      # Skill exists but node_modules may have broken symlinks — recopy
      rm -rf "$skill_dst/node_modules"
      cp -RP "$skill_src/node_modules" "$skill_dst/node_modules"
      echo "[$agent] $skill_name: node_modules restored"
    elif [ ! -d "$skill_dst" ]; then
      # Skill missing entirely — copy fresh
      cp -RP "$skill_src" "$skill_dst"
      echo "[$agent] $skill_name: copied (was missing)"
    else
      echo "[$agent] $skill_name: no node_modules in source, skipped"
    fi
  done
done

echo ""
echo "=== Verification ==="
all_ok=true
for agent_dir in "$ARENA_DIR"/agent_*; do
  [ -d "$agent_dir" ] || continue
  agent=$(basename "$agent_dir")
  bin="$agent_dir/.skills/agent-browser/node_modules/.bin/agent-browser"
  if [ -L "$bin" ]; then
    echo "  $agent: ✅  symlink OK"
  elif [ -f "$bin" ]; then
    echo "  $agent: ❌  still a regular file (fix failed?)"
    all_ok=false
  else
    echo "  $agent: ❌  binary missing"
    all_ok=false
  fi
done

echo ""
if $all_ok; then
  echo "All agents fixed successfully!"
else
  echo "Some agents still have issues. Check output above."
  exit 1
fi

