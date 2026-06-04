# Evotown — Enterprise Agent Governance & Capability Platform

> **In one sentence:** Evotown is the **private control plane** for enterprise Agents — employees keep OpenClaw, Hermes, or SkillLite on their machines; IT unifies **models**, **Skills**, **knowledge**, and **compliance** in one self-hosted layer.

**Evotown is a middle platform for enterprise Agent runtime governance and capability assets** — connect multiple runtimes, accumulate Skills and enterprise knowledge, and provide observability, review, and private distribution.

Runners stay where they are (laptops, CI, servers, containers). Evotown is the **control plane** above them — **not** an IM suite, **not** a ChatGPT clone for every employee, and **not** a replacement for your Agent runtime. The repo also includes an **Evolution Arena** for benchmarks and reproducible experiments.

[中文](../zh-CN/README.md)

## Product preview

![Evotown enterprise landing page](/docs/screenshots/evotown-home.png)

*Homepage — enterprise Agent collaboration & governance platform.*

---

## Elevator pitch (30 seconds)

Your company already runs Agents on laptops (OpenClaw, Hermes, …). Evotown gives IT:

1. **One model gateway** — identity, quotas, audit, cost attribution (via LiteLLM)
2. **Private SkillHub** — review, team scope, signed packages, OpenClaw plugin
3. **Enterprise knowledge** — Feishu, Yuque, native KB
4. **Observability** — engines, runs, conversations, risk — without moving execution to the cloud

**IT deploys once; employees paste two lines of config.**

→ [Enterprise quickstart](../docs/zh-CN/ENTERPRISE_QUICKSTART.md)

---

## What Evotown is — and what it is not

| Evotown **is** | Evotown **is not** |
|----------------|-------------------|
| Agent **governance & capability middle platform** | Universal enterprise AI chat for all staff |
| **Runtime-neutral** control plane | Hosted Agent sandbox replacing local runtimes |
| Private gateway + SkillHub + knowledge | Competing with cloud LLM APIs |
| Open source, self-hosted | Generic iPaaS / integration bus |

**Principles:** runtime-neutral · evidence-based promotion · private deploy · control without lock-in

---

## Architecture

```text
  Laptops / CI / servers                 Your network
  OpenClaw · Hermes · SkillLite              Evotown control plane
       │  two-line config                   · Gateway → LiteLLM
       └──────────────────────────────────► · Skills Market · Knowledge · Console
```

| Layer | Role |
|-------|------|
| **Runtime** | Agents execute **locally** |
| **Evotown** | Gateway, accounts, SSO; Skills Market; knowledge; runs, costs, risk |
| **Business apps** | Bots, copilots — consume skills & knowledge via API |

---

## Compared to similar open-source projects

| Category | Examples | vs Evotown |
|----------|----------|------------|
| LLM gateway | LiteLLM | Evotown composes LiteLLM + enterprise layer |
| Chat / RAG | Onyx, Dify | End-user chat; Evotown = **Agent governance** |
| Agent platform | Synkora | Often hosts agents; Evotown keeps runtimes **local** |
| Control plane | Keviq, Kagenti | Closer; Evotown lighter, tuned for OpenClaw/Hermes rollout |

---

## Platform surfaces (MVP)

| Route | Purpose |
|-------|---------|
| `/login` | Console (`evk_` keys, OIDC SSO) |
| `/gateway` | Gateway + model routes |
| `/accounts` | Accounts & API keys |
| `/market` · `/skills` | Skills catalog & admin |
| `/knowledge` | Knowledge connectors + native KB |
| `/arena` | Evolution arena |

Specs: [spec/README.md](../spec/README.md) · [enterprise control plane](../spec/enterprise-control-plane.md)

---

## Enterprise landing

```bash
./scripts/enterprise-deploy.sh
```

Employee config:

```bash
OPENAI_BASE_URL=https://evotown.company.internal/api/gateway/v1
OPENAI_API_KEY=evk_xxxxxxxx
```

Docs: [Enterprise quickstart](../docs/zh-CN/ENTERPRISE_QUICKSTART.md) · [OpenClaw plugin](../integrations/openclaw/evotown/)

---

## Evolution testing

Controlled environment for **evolution effect validation** — OpenClaw, Hermes, custom harnesses, or optionally [SkillLite](https://github.com/EXboys/skilllite). See [ingest API](../docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md).

## Quick Start

### Docker

```bash
cd evotown && cp .env.example .env && docker compose up -d --build
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
- **Console / SSO:** `/login`, `EVOTOWN_OIDC_*`
- **Skill signing:** `EVOTOWN_SKILL_SIGNING_SECRET`
- **Gateway:** `LITELLM_BASE_URL` + `OPENAI_BASE_URL=…/api/gateway/v1`

## Related Docs

- [Evotown spec index](../spec/README.md)
- [Engine ingest API](../docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md)
- [Enterprise control plane spec](../docs/en/ENTERPRISE_CONTROL_PLANE_PRODUCT_SPEC.md)
- [Enterprise quickstart](../docs/zh-CN/ENTERPRISE_QUICKSTART.md)
- [Reward mechanism](../docs/en/REWARD_MECHANISM.md) · [Evolution mechanism](../docs/en/EVOLUTION_MECHANISM_ANALYSIS.md)
