# Evotown enterprise control plane product spec

**Status:** Product planning draft. This document describes a target product direction; it does not imply all capabilities are implemented today.

**Source of truth:** Evotown specs now live under [`../../spec/`](../../spec/). This document is a readable planning narrative that summarizes the same direction.

**Positioning:** Evotown remains an evolution arena, but the enterprise product expands it into a central control plane for independently deployed agent runtimes. OpenClaw-style stacks, Hermes, SkillLite, and custom runners can keep running where they already run, while Evotown receives telemetry, artifacts, policy events, and reusable assets.

---

## 1. Product thesis

Single-machine agent runtimes are useful for individual productivity, but enterprises need an organizational layer:

- Observe agent usage across employee laptops, servers, CI, and containers.
- Compare runtime efficiency and output quality across engines and teams.
- Enforce model, tool, network, file, and secret policies.
- Convert individual discoveries into reusable company assets.
- Review, benchmark, approve, recommend, and roll back those assets.

Evotown should become that layer without forcing every team onto one runtime.

---

## 2. Product modes

Evotown should support two public modes with one shared backend:

| Mode | Audience | Primary value |
|------|----------|---------------|
| Community / Research | developers, framework authors, researchers | Evolution arena, benchmark experiments, visual simulation, reproducible comparisons |
| Enterprise Control Plane | platform teams, security, engineering leads | Fleet visibility, policy control, asset review, reusable skill / prompt / workflow registry |

The game page stays valuable, but it becomes the **Arena view** inside a broader console.

---

## 3. Core modules

### 3.1 Engine registry

Tracks runtimes connected to Evotown.

Minimum fields:

- `engine_id`
- `engine_type`: `openclaw`, `hermes`, `skilllite`, `custom`
- `engine_version`
- `owner_team`
- `deployment_kind`: `laptop`, `server`, `ci`, `container`
- `capabilities`: run ingest, events, artifacts, assets, policy pull
- `health`: last heartbeat, last run, error state

Initial implementation can extend the existing `POST /api/v1/engines/register` contract.

### 3.2 Run observatory

Turns the current task history into a company-wide run timeline.

Metrics:

- run count by employee, team, project, engine
- success / failure / cancelled rates
- latency and queue time
- token and model cost
- high-risk tool calls
- artifact count and size
- recurring failure categories

Views:

- Runs list
- Run detail
- Team summary
- Engine comparison
- Failure analysis

### 3.3 Policy center

Provides enterprise guardrails without replacing the runtime.

Policy categories:

- allowed model providers and models
- tool / MCP allowlist and denylist
- network domain allowlist / denylist
- workspace path access rules
- secret handling and redaction rules
- artifact upload limits
- approval gates for risky operations

The first version can be pull-based: local connectors call `GET /api/v1/policies`, apply what they can, and report violations.

### 3.4 Asset registry

Captures reusable organizational knowledge.

Asset types:

- skill
- prompt
- workflow / playbook
- memory snippet
- tool config
- evaluation case

Required metadata:

- `asset_id`
- `asset_type`
- source `run_id`
- author and team
- version
- status: `pending`, `approved`, `rejected`, `deprecated`
- tags and target scenarios
- benchmark results
- usage count and success rate after promotion
- rollback pointer

The important product rule: personal discoveries do not become company defaults automatically. They enter review first.

### 3.5 Review and promotion

Controls how assets become reusable.

Flow:

1. Runtime or connector proposes an asset.
2. Evotown stores it as `pending`.
3. Evaluation jobs run against benchmark tasks.
4. Human or policy-based review approves or rejects it.
5. Approved assets enter the company registry.
6. Evotown recommends approved assets for similar future runs.
7. Bad versions can be deprecated or rolled back.

### 3.6 Arena view

The existing game page should stay. Its role changes from "the whole product" to "visual simulation layer for evolution experiments."

Arena can visualize:

- teams as groups
- engines as agent species or runtime classes
- tasks as quests
- approved assets as equipment / abilities
- policy violations as blocked actions
- benchmark rounds as tournaments

This keeps Evotown memorable while the enterprise console remains practical.

### 3.7 Chronicle

Chronicle should evolve from a story view into an organizational learning log.

Examples:

- "Team A reduced repeated test failures by promoting workflow W."
- "Hermes runner improved latency on benchmark B after prompt asset P."
- "Policy blocked risky file access in run R."

---

## 4. API roadmap

The existing ingest API is the foundation. Add APIs in small increments.

### v0.1: run completion ingest

Current scope:

- `POST /api/v1/engines/register`
- `POST /api/v1/runs/{run_id}/complete`
- optional artifacts
- optional run lease

### v0.2: live events and policy pull

Add:

```text
POST /api/v1/events
GET  /api/v1/policies
POST /api/v1/policy/violations
```

Event types:

- `run_started`
- `step_started`
- `tool_call`
- `model_call`
- `artifact_written`
- `policy_violation`
- `run_finished`

### v0.3: assets

Add:

```text
POST /api/v1/assets/propose
GET  /api/v1/assets
POST /api/v1/assets/{asset_id}/review
GET  /api/v1/assets/recommend
```

### v0.4: evaluation and promotion

Add:

```text
POST /api/v1/evaluations
GET  /api/v1/evaluations/{evaluation_id}
POST /api/v1/assets/{asset_id}/promote
POST /api/v1/assets/{asset_id}/deprecate
```

---

## 5. UI roadmap

Target navigation:

- `Dashboard`: enterprise overview
- `Runs`: run list and run detail
- `Engines`: runtime registry and health
- `Policies`: guardrails and approval rules
- `Assets`: company skill / prompt / workflow registry
- `Reviews`: pending assets and risky operations
- `Arena`: game-style evolution simulation
- `Chronicle`: organizational learning log

Existing pages map naturally:

| Current page | Future role |
|--------------|-------------|
| `/arena` | Arena view |
| `/task-history` | Runs |
| `/chronicle` | Chronicle |
| `/agents/{id}/metrics` | Run / engine / team metrics data source |

---

## 6. Connector strategy

Evotown should not require one deployment style.

### Mode A: HTTP ingest only

The external runtime reports completed runs. This is the lowest-friction integration.

### Mode B: local connector

A small process runs near the employee workspace.

Responsibilities:

- detect local agent runs
- upload run events and artifacts
- pull policies
- redact secrets before upload
- propose reusable assets

### Mode C: gateway mode

An enterprise model gateway enforces model routing, cost controls, and audit logging. Evotown can integrate with a gateway, but should not require one.

---

## 7. Implementation phases

### Phase 1: Observability foundation

Goal: make enterprise usage visible.

Deliverables:

- engine registry page
- improved runs page
- run detail with logs, signals, artifacts
- team / engine metrics
- README and docs positioning updates

Success criteria:

- a custom runner can register and report runs
- administrators can compare runs by engine and team
- the Arena can consume run results as a visualization source

### Phase 2: Asset capture

Goal: turn individual output into reviewable assets.

Deliverables:

- asset data model
- `assets/propose` endpoint
- asset list and detail pages
- pending / approved / rejected states
- link every asset to source run

Success criteria:

- a run can propose a skill / prompt / workflow
- reviewers can approve or reject it
- approved assets are searchable

### Phase 3: Policy and control

Goal: make enterprise deployment safer.

Deliverables:

- policy model
- `GET /policies`
- policy violation ingest
- policy center UI
- approval queue for risky operations

Success criteria:

- connector can pull policy
- blocked actions appear in Evotown
- admins can see which policies produce violations

### Phase 4: Evaluation and recommendation

Goal: make asset reuse measurable.

Deliverables:

- evaluation jobs
- benchmark suites
- asset promotion / deprecation
- asset recommendation API
- asset performance dashboard

Success criteria:

- assets are promoted based on evidence
- worse versions can be rolled back
- users receive recommended approved assets for similar tasks

---

## 8. Product boundaries

Evotown should not become every runtime.

In scope:

- control plane
- ingest and telemetry
- policies and review workflows
- asset registry
- evaluation and visualization

Out of scope initially:

- replacing OpenClaw / Hermes / SkillLite runtimes
- full endpoint security / EDR
- full MDM agent
- mandatory model gateway
- automatic installation of every engine

---

## 9. Near-term README positioning

Suggested product sentence:

> Evotown is an evolution arena and enterprise control plane for independently deployed agent runtimes. Runners stay where they are; Evotown receives their runs, artifacts, policy events, and reusable assets for evaluation, governance, and reuse.

Suggested Arena sentence:

> Arena is the visual simulation layer for evolution experiments, benchmarks, and team-level learning.

