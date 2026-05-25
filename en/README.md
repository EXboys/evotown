# Evotown — Enterprise Agent Governance & Capability Platform

**Evotown is a middle platform for enterprise Agent runtime governance and capability assets** — connect multiple Agent runtimes, accumulate Skills and enterprise knowledge, and provide observability, review, and private distribution.

Runners stay where they are (laptops, CI, servers, containers). Evotown is the **control plane** above them — not an IM suite and not a chat assistant for every employee. The repo also includes an **Evolution Arena** for benchmarks and reproducible experiments.

[中文](../zh-CN/README.md)

## What Evotown is

| Layer | Role |
|-------|------|
| **Runtime** | OpenClaw / Hermes / SkillLite / custom agents execute locally |
| **Evotown** | Engine registry, runs, costs, risk; private Skills Market; knowledge connectors + native KB; console auth |
| **Business apps** | DingTalk/Feishu bots, internal copilots — consume skills & knowledge via API |

**Principles:** runtime-neutral · evidence-based promotion · private deploy · control without lock-in

## Platform surfaces (MVP)

| Route | Purpose |
|-------|---------|
| `/` | Enterprise landing page |
| `/login` | Console register / login (`evk_` API keys) |
| `/dashboard` … `/risk` | Enterprise console |
| `/market` | Skills catalog |
| `/skills` | Admin skills management |
| `/knowledge` | Knowledge connectors + native KB |
| `/arena` | Evolution arena |
| `/task-history` | Task history |
| `/chronicle` | Learning log |

Specs: [spec/README.md](../spec/README.md) · [enterprise control plane](../spec/enterprise-control-plane.md) · [knowledge connector](../spec/knowledge-connector.md)

---

## Evolution testing

Puts **evolution engines** in a controlled environment for **evolution effect validation** — OpenClaw-style stacks, Hermes, your harness, or optionally [SkillLite](https://github.com/EXboys/skilllite). Use the [ingest API](../docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md) to attach runners. Economy rules are local and **do not depend on cryptocurrency**.

## Prerequisites

- Python 3.10+
- Node.js 18+
- Skills workspace under `.skills` or `skills` (layout depends on your agent backend)
- SkillLite is **optional**

## Quick Start

### Docker

```bash
cd evotown
cp .env.example .env
docker compose up -d --build
```

Visit http://localhost

### Local dev

```bash
cd evotown/backend && pip install -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port 8765
cd evotown/frontend && npm install && npm run dev
```

Visit http://localhost:5174

## Configuration

- **Engine ingest:** `EVOTOWN_ENGINE_INGEST_TOKEN`
- **Console:** register at `/login` or set `ADMIN_TOKEN`
- **Private Skills Market:** [PRIVATE_SKILLS_MARKET_DEPLOYMENT.md](../docs/zh-CN/PRIVATE_SKILLS_MARKET_DEPLOYMENT.md)
- **Gateway:** LiteLLM + `OPENAI_BASE_URL=http://localhost:8765/api/gateway/v1`

## Related Docs

- [Evotown spec index](../spec/README.md)
- [Engine ingest API](../docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md)
- [Enterprise control plane spec](../docs/en/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md)
- [Reward mechanism](../docs/en/REWARD_MECHANISM.md)
- [Evolution mechanism](../docs/en/EVOLUTION_MECHANISM_ANALYSIS.md)
