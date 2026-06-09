# Evotown — Enterprise Agent Governance & Capability Platform

> **In one sentence:** Evotown is the **private control plane** for enterprise Agents — employees keep running OpenClaw, Hermes, or SkillLite on their machines; IT uses Evotown to unify **models**, **Skills**, **knowledge**, and **compliance** in one place.

**Evotown is a middle platform for enterprise Agent runtime governance and capability assets** — connect multiple runtimes, accumulate **Skills** and **enterprise knowledge**, and provide **observability, review, and private distribution**.

Runners stay where they are (laptops, CI, servers, containers). Evotown is the **control plane** above them — **not** an IM suite, **not** a ChatGPT clone for every employee, and **not** a replacement for your Agent runtime.

The repo also ships an **Evolution Arena** for benchmarks, team learning, and reproducible evolution experiments.

**Language**: [English](en/README.md) | [中文](zh-CN/README.md)

## Product preview

![Evotown enterprise landing page](/docs/screenshots/evotown-home.png)

*Homepage — enterprise Agent collaboration & governance platform.*

---

## Elevator pitch (30 seconds)

Your company already runs Agents on laptops (OpenClaw, Hermes, …). Evotown gives IT a **self-hosted layer** to:

1. **Route models** through one gateway (identity, quotas, audit, cost attribution)
2. **Distribute Skills** from a private SkillHub (review, team scope, signed packages)
3. **Connect knowledge** (Feishu, Yuque, native KB) without locking a single vendor
4. **Observe runs** — engines, conversations, risk events — without moving execution into the cloud

**IT deploys once; employees paste two lines of config.** Business apps (DingTalk/Feishu bots, internal copilots) consume the same APIs.

→ **Recommended path:** [Enterprise quickstart (IT one-click + employee config)](docs/zh-CN/ENTERPRISE_QUICKSTART.md)

---

## What Evotown is — and what it is not

| Evotown **is** | Evotown **is not** |
|----------------|-------------------|
| Agent **governance & capability middle platform** | Universal “enterprise AI chat” for all staff |
| **Runtime-neutral** control plane (OpenClaw / Hermes / SkillLite / custom) | Hosted Agent sandbox that replaces local runtimes |
| Private **model gateway** + **SkillHub** + knowledge connectors | Competing with cloud LLM APIs (OpenAI, Azure, …) |
| Open source, **self-hosted**, evidence-based asset promotion | Low-code iPaaS or generic integration bus |
| Optional **Evolution Arena** for R&D and benchmarks | Required to use Agents in production |

**Product principles:** runtime-neutral · evidence-based asset promotion · private deploy · control without lock-in.

---

## Architecture

```text
  Employee laptop / CI / server          Your network (Docker / K8s)
  OpenClaw · Hermes · SkillLite              ┌─────────────────────────────┐
       │  two-line env config                │  Evotown control plane       │
       │  OPENAI_BASE_URL → gateway           │  · Gateway (→ LiteLLM)       │
       │  manifest → SkillHub               │  · Private Skills Market     │
       └──────────────────────────────────►│  · Knowledge + Console       │
                                             │  · Runs / cost / risk        │
                                             └──────────────┬──────────────┘
                                                            │
                                             Business apps (bots, copilots, CRM)
```

| Layer | Role |
|-------|------|
| **Runtime** | OpenClaw / Hermes / SkillLite / custom agents execute **locally** |
| **Evotown (this repo)** | Gateway, accounts, SSO; private Skills Market; knowledge; engine registry; runs, costs, risk |
| **Business apps** | DingTalk/Feishu bots, internal copilots, CRM agents — consume skills & knowledge via API |

---

## Core capabilities (enterprise MVP)

| Pillar | What you get |
|--------|----------------|
| **Govern** | Console accounts (`evk_` keys), OIDC SSO, team-scoped assets, skill review & deprecate, API key lifecycle |
| **Route** | OpenAI-compatible gateway in front of [LiteLLM](https://github.com/BerriAI/litellm); alias-based model routing; streaming; quotas & burst limits |
| **Distribute** | Private Skills Market — upload, manifest, employee download; package signing; OpenClaw official-format plugin |
| **Accumulate** | Knowledge connectors (Feishu / Yuque) + native KB with chunk citation search |
| **Observe** | Engine registry, runs timeline, gateway usage, conversations, cost & risk events |
| **Land fast** | `scripts/enterprise-deploy.sh`, `evotown-agent-setup.py` (check / sync / watch), MDM install scripts |

The **Arena** remains the visual simulation layer for evolution experiments and demos — optional for production Agent rollout.

---

## How Evotown compares (open source landscape)

Many projects cover **part** of this stack; few combine **runtime-neutral local Agents + private SkillHub + gateway governance** in one self-hosted control plane.

| Category | Examples | Overlap with Evotown |
|----------|----------|----------------------|
| LLM gateway only | LiteLLM, Portkey | Evotown **uses** LiteLLM for provider routing; adds enterprise identity, audit, SkillHub |
| Chat / RAG for end users | Onyx, Dify, LibreChat | End-user chat UI; Evotown focuses on **Agent runtime governance**, not replacing ChatGPT |
| Full-stack Agent platform | Synkora, LiteLLM Agent Platform | Often hosts agents & channels; Evotown **does not** host runtimes — they stay on employee machines |
| Agent control plane | Keviq Core, Kagenti | Closer on governance/orchestration; Evotown is lighter and optimized for **OpenClaw/Hermes enterprise rollout** |
| Skill / tool registry | MCP gateways, tool hubs | Partial overlap with private Skills Market only |

**Differentiation:** compose with existing runtimes · private SkillHub as a first-class asset · IT one-click deploy + employee two-line config · optional Evolution Arena for R&D.

---

## Platform surfaces (MVP)

| Route | Purpose |
|-------|---------|
| `/` | Enterprise landing page |
| `/login` | Console register / login (`evk_` API keys, optional OIDC SSO) |
| `/dashboard` … `/risk` | Enterprise console (engines, runs, gateway, costs, risk, …) |
| `/gateway` | Gateway usage + model route management |
| `/accounts` | Gateway accounts & API keys |
| `/market` | Skills catalog & employee install guidance |
| `/skills` | Admin: upload, review, deprecate skills |
| `/knowledge` | Knowledge sources (Feishu / Yuque / native), tree editor, chunk search |
| `/arena` | Evolution arena (Phaser map, observer panel) |
| `/task-history` | Task history and judge scores |
| `/chronicle` | Organizational learning log |

Specs: [spec/README.md](spec/README.md) · [enterprise control plane](spec/enterprise-control-plane.md) · [knowledge connector](spec/knowledge-connector.md) · [Skills market](spec/skills-market-and-connectors.md)

---

## Enterprise landing (recommended)

For teams with **OpenClaw / Hermes on employee laptops**:

```bash
# IT — one-click deploy (see script for env vars)
./scripts/enterprise-deploy.sh
```

Employee machine — two lines (from `deploy-output/evotown.agent.env`):

```bash
OPENAI_BASE_URL=https://evotown.company.internal/api/gateway/v1
OPENAI_API_KEY=evk_xxxxxxxx
```

| Doc | Link |
|-----|------|
| Enterprise quickstart (中文) | [docs/zh-CN/ENTERPRISE_QUICKSTART.md](docs/zh-CN/ENTERPRISE_QUICKSTART.md) |
| MDM rollout | [docs/zh-CN/MDM_AGENT_ROLLOUT.md](docs/zh-CN/MDM_AGENT_ROLLOUT.md) |
| API key lifecycle | [docs/zh-CN/ENTERPRISE_KEY_LIFECYCLE.md](docs/zh-CN/ENTERPRISE_KEY_LIFECYCLE.md) |
| OpenClaw plugin | [integrations/openclaw/evotown/](integrations/openclaw/evotown/) |
| Private Skills Market | [docs/zh-CN/PRIVATE_SKILLS_MARKET_DEPLOYMENT.md](docs/zh-CN/PRIVATE_SKILLS_MARKET_DEPLOYMENT.md) |

---

## Evolution testing (original focus)

Puts **evolution engines** in a controlled environment for **evolution effect validation** — OpenClaw-style stacks, Hermes, your own harness, or **optionally** [SkillLite](https://github.com/EXboys/skilllite). Evotown does not require a specific upstream; use the [ingest API](docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md) to attach runners. Economy rules are configurable, reproducible, fully local, and **do not depend on virtual/cryptocurrency**.

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- **Skills workspace:** backend expects a project tree with `.skills` or `skills` (layout depends on the agent backend you wire in).
- **SkillLite (optional):** only if you drive agents with the SkillLite CLI — then `skilllite evolution run` / `skilllite agent-rpc` and the default per-agent copy under `~/.skilllite/arena/{agent_id}/.skills` apply. Other engines use their own install paths and report via HTTP ingest instead.

## Quick Start

### Option A — Docker (Recommended)

Requires Docker Desktop (or Docker Engine + Compose plugin).

```bash
cd evotown

# 1. Create .env from the template (same directory as docker-compose.yml)
cp .env.example .env
# Edit API_KEY / BASE_URL / MODEL, ANTHROPIC_API_KEY (Coding Agent), and optional channel overrides

# 2. First-time: build images and start
docker compose up -d --build

# Subsequent starts (no rebuild needed)
docker compose up -d

# Stop
docker compose down
```

Visit [http://localhost](http://localhost) — landing page; open **Console**, **Skills Market**, or **Arena** from the nav.

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

Visit [http://localhost:5174](http://localhost:5174)

> **Data directory**: Local dev and Docker both persist arena state, task history, and logs under `evotown/data/`. Override with `EVOTOWN_DATA_DIR` when needed.

## Configuration

Copy `.env.example` to `.env` and fill in at least the main `BASE_URL`, `API_KEY`, and `MODEL`. Optional per-channel overrides (`JUDGE_*`, `DISPATCHER_*`, `SOCIAL_*`, `CHRONICLE_*`) let high-frequency flows use a cheaper model while judge and chronicle keep a stronger one. Docker Compose also accepts `OPENAI_API_KEY` / `OPENAI_BASE_URL` as aliases for the main channel.

External engine ingest uses bearer auth. Set `EVOTOWN_ENGINE_INGEST_TOKEN` for OpenClaw / Hermes / custom runners. For local dev only, `EVOTOWN_DEV_ALLOW_ADMIN_TOKEN_FALLBACK=1` allows ingest writes to fall back to `ADMIN_TOKEN`. Console APIs accept `X-Admin-Token` or Bearer `evk_` keys with `console.read` / `console.write` scopes (register at `/login`).

Optional enterprise env vars:

| Variable | Purpose |
|----------|---------|
| `EVOTOWN_PUBLIC_URL` | Public base URL for SSO callback and OpenClaw plugin manifest |
| `EVOTOWN_OIDC_*` | OIDC SSO for console login |
| `EVOTOWN_SKILL_SIGNING_SECRET` | HMAC signatures for skill packages |
| `LITELLM_BASE_URL` / `LITELLM_MASTER_KEY` | Upstream model gateway (enable `litellm` Docker profile) |

## External engine ingest (v0.1 draft)

Independent engines (OpenClaw-style runners, Hermes, custom harnesses, …) can report runs **into** Evotown over HTTP. Evotown remains the **system of record** for results and scoring signals.

Implemented MVP endpoints include engine registration and completed-run ingest under `/api/v1` (`/engines/register`, `/engines`, `/runs/{run_id}/complete`, `/runs`, `/runs/{run_id}`).

| Doc | Link |
|-----|------|
| Ingest API (English) | [docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md](docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md) |
| 引擎接入 API（中文） | [docs/zh-CN/EVOTOWN-ENGINE-INGEST-V0.1.md](docs/zh-CN/EVOTOWN-ENGINE-INGEST-V0.1.md) |
| OpenAPI draft | [docs/openapi/evotown-engine-ingest-v0.1.yaml](docs/openapi/evotown-engine-ingest-v0.1.yaml) |

## Centralized model gateway (LiteLLM-backed MVP)

Evotown sits in front of LiteLLM as an enterprise API gateway. Agents call Evotown's OpenAI-compatible endpoint; Evotown records ownership, conversations, usage, cost, and risk context before forwarding to LiteLLM.

```bash
OPENAI_BASE_URL=http://localhost:8765/api/gateway/v1
OPENAI_API_KEY=evk_xxxxxxxx   # issued from /accounts console or API
```

MVP endpoints:

- `POST /api/gateway/v1/chat/completions` — OpenAI-compatible chat completion proxy (**non-streaming and SSE streaming**).
- `GET /api/gateway/v1/model-routes` — alias → target model routing (admin).
- `GET /api/gateway/v1/usage/summary` — gateway requests, cost, token, model, and agent summary.
- `GET /api/gateway/v1/conversations` — conversation-level gateway rollup.
- `GET /api/gateway/v1/api-keys` — managed + legacy env key metadata.

### Gateway accounts & API keys

Managed keys live in `data/accounts.db` (override data dir with `EVOTOWN_DATA_DIR`). Admins create accounts and issue keys via the enterprise console **`/accounts`** tab or the REST API below. Secrets are shown **once** at creation (`evk_…` prefix); only SHA-256 hashes are stored.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/v1/accounts` | X-Admin-Token | Create gateway account |
| GET | `/api/v1/accounts` | X-Admin-Token | List accounts |
| PATCH | `/api/v1/accounts/{account_id}` | X-Admin-Token | Update / disable account |
| POST | `/api/v1/accounts/{account_id}/keys` | X-Admin-Token | Issue new API key (returns `secret`) |
| GET | `/api/v1/accounts/{account_id}/keys` | X-Admin-Token | List keys (metadata + monthly usage) |
| PATCH | `/api/v1/keys/{key_id}` | X-Admin-Token | Update label, scopes, monthly quotas |
| POST | `/api/v1/keys/{key_id}/revoke` | X-Admin-Token | Revoke a key |

**Gateway chat auth:** managed keys must include scope `gateway.chat`. Exceeding per-key **monthly token or cost limits** returns HTTP `429`. Optional **burst RPM** limits requests per 60s window. After a successful call that pushes usage over the monthly cap, the response stays `200` but sets `X-Evotown-Quota-Exceeded` and marks the audit row; the next request is blocked by pre-check.

**Backward compatibility:** `EVOTOWN_GATEWAY_API_KEYS` supplies legacy env bearer tokens. Set `LITELLM_BASE_URL` and `LITELLM_MASTER_KEY` for production. Docker Compose includes an optional LiteLLM service under the `litellm` profile.

**CI:** GitHub Actions runs backend tests and frontend build on push/PR to `main` (`.github/workflows/ci.yml`).

## Planning & specs

| Doc | Link |
|-----|------|
| Spec index | [spec/README.md](spec/README.md) |
| Enterprise control plane | [spec/enterprise-control-plane.md](spec/enterprise-control-plane.md) |
| Knowledge connector | [spec/knowledge-connector.md](spec/knowledge-connector.md) |
| Skills market | [spec/skills-market-and-connectors.md](spec/skills-market-and-connectors.md) |
| Roadmap | [spec/roadmap.md](spec/roadmap.md) |
| Product planning doc (English) | [docs/en/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md](docs/en/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md) |
| 产品规划（中文） | [docs/zh-CN/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md](docs/zh-CN/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md) |

## Arena UI notes

The arena frontend uses WebSocket for live updates. REST fallback polls `/agents` when the socket is down (~15s) or connected (~60s).

Arena economy and evolution knobs live in `backend/evotown_config.json` (see `backend/evotown_config.json.example`).

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
├── integrations/         # OpenClaw plugin bundle
├── scripts/              # enterprise-deploy.sh, evotown-agent-setup.py, MDM
├── data/                 # Default persistence (override with EVOTOWN_DATA_DIR)
├── .env.example          # LLM + arena env template
├── docker-compose.yml
├── docs/
│   ├── en/               # English docs
│   └── zh-CN/            # 中文文档
├── en/README.md          # English README
├── zh-CN/README.md       # 中文 README
└── README.md             # This file (default)
```

## Related Docs

- [Evotown spec index](spec/README.md)
- [Engine ingest API v0.1](docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md) | [引擎接入 API v0.1](docs/zh-CN/EVOTOWN-ENGINE-INGEST-V0.1.md) · [OpenAPI](docs/openapi/evotown-engine-ingest-v0.1.yaml)
- [Enterprise Control Plane Product Spec](docs/en/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md) | [企业控制面产品规格](docs/zh-CN/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md)
- [Enterprise quickstart](docs/zh-CN/ENTERPRISE_QUICKSTART.md) | [Solution overview (中文)](docs/zh-CN/SOLUTION.md)
- [Reward Mechanism](docs/en/REWARD_MECHANISM.md) | [奖励机制](docs/zh-CN/REWARD_MECHANISM.md)
- [Agent Task Acceptance](docs/en/AGENT_TASK_ACCEPTANCE_ANALYSIS.md) | [任务接受逻辑](docs/zh-CN/AGENT_TASK_ACCEPTANCE_ANALYSIS.md)
- [Evolution Mechanism](docs/en/EVOLUTION_MECHANISM_ANALYSIS.md) | [进化机制](docs/zh-CN/EVOLUTION_MECHANISM_ANALYSIS.md)
