# Evotown — Evolution Testing Platform

Puts evolution engines (e.g. SkillLite) in a controlled environment for **evolution effect validation**. Economy rules are configurable, reproducible, fully local, and **do not depend on virtual/cryptocurrency**.

**Language**: [English](en/README.md) | [中文](zh-CN/README.md)

## Prerequisites

- SkillLite installed (`skilllite evolution run`, `skilllite agent-rpc` available)
- Python 3.10+
- Node.js 18+
- Backend must run in a directory containing `.skills` or `skills`; each agent gets a copy at `~/.skilllite/arena/{agent_id}/.skills` for isolated evolution artifacts

## Quick Start

### Option A — Docker (Recommended)

Requires Docker Desktop (or Docker Engine + Compose plugin).

```bash
cd evotown

# 1. Create .env with your LLM API key (same directory as docker-compose.yml)
cat > .env << 'EOF'
OPENAI_API_KEY=sk-your-key-here
# OPENAI_BASE_URL=https://your-proxy/v1   # optional, remove if using OpenAI directly
EOF

# 2. First-time: build images and start
docker compose up -d --build

# Subsequent starts (no rebuild needed)
docker compose up -d

# Stop
docker compose down
```

Visit http://localhost — landing page, click "进入竞技场" for the arena.

> **Note**: `.env` must be placed in the `evotown/` directory (same level as `docker-compose.yml`).
> Docker Compose reads it automatically on startup.

### Option B — Local Dev (two terminals)

```bash
# Terminal 1 — Backend
cd evotown/backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8765

# Terminal 2 — Frontend
cd evotown/frontend
npm install
npm run dev
```

Visit http://localhost:5174

## Economy Rules (Jungle Law)

Configurable via `evotown_config.json` or environment variables:

| Config | Default | Env Var |
|--------|---------|---------|
| initial_balance | 100 | EVOTOWN_INITIAL_BALANCE |
| cost_accept | -5 | EVOTOWN_COST_ACCEPT |
| reward_complete | 10 | EVOTOWN_REWARD_COMPLETE |
| penalty_fail | -5 | EVOTOWN_PENALTY_FAIL |
| eliminate_on_zero | true | EVOTOWN_ELIMINATE_ON_ZERO |

Query current config via `GET /config/economy`.

## Directory Structure

```
evotown/
├── backend/              # FastAPI backend
├── frontend/             # React + Phaser 3 frontend
├── docs/
│   ├── en/               # English docs
│   └── zh-CN/            # 中文文档
├── en/README.md          # English README
├── zh-CN/README.md       # 中文 README
└── README.md             # This file (default)
```

## Release Notes

Evotown is developed inside the skillLite repo; **it is split into a separate repo on release** (e.g. `evotown` / `evotown-org/evotown`).

```bash
# Split example
git subtree split -P evotown -b evotown-main
```

## Related Docs

- [Reward Mechanism](docs/en/REWARD_MECHANISM.md) | [奖励机制](docs/zh-CN/REWARD_MECHANISM.md)
- [Agent Task Acceptance](docs/en/AGENT_TASK_ACCEPTANCE_ANALYSIS.md) | [任务接受逻辑](docs/zh-CN/AGENT_TASK_ACCEPTANCE_ANALYSIS.md)
- [Evolution Mechanism](docs/en/EVOLUTION_MECHANISM_ANALYSIS.md) | [进化机制](docs/zh-CN/EVOLUTION_MECHANISM_ANALYSIS.md)
- [13-EVOLUTION-ARENA.md](../todo/13-EVOLUTION-ARENA.md) — Full design
- [12-SELF-EVOLVING-ENGINE.md](../todo/12-SELF-EVOLVING-ENGINE.md) — Evolution engine
