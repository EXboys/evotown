# Enterprise control plane

## Goal

Provide a central organizational layer for agent runtimes deployed across employee machines, CI, servers, and containers.

## Core modules

### Engine registry

Tracks connected runtimes and their capabilities.

Minimum fields:

- `engine_id`
- `engine_type`: `openclaw`, `hermes`, `skilllite`, `custom`
- `engine_version`
- `owner_team`
- `deployment_kind`: `laptop`, `server`, `ci`, `container`
- `capabilities`: run ingest, events, artifacts, assets, policy pull
- `health`: last heartbeat, last run, error state

### Connector / proxy registry

Tracks the integration nodes that normalize runtime events and mediate enterprise network access.

Minimum fields:

- `connector_id`
- `tenant_id`
- `team_id`
- `deployment_kind`: central, team, workspace, laptop
- `runtime_targets`: OpenClaw, Hermes, SkillLite, custom
- `evotown_ingest_status`
- `market_proxy_status`
- `policy_cache_status`
- `last_seen_at`

### Run observatory

Turns task history into a company-wide run timeline.

Metrics:

- run count by employee, team, project, and engine
- success / failure / cancelled rates
- latency, queue time, and cost
- model usage and token usage
- high-risk tool calls
- artifact count and size
- recurring failure categories

### Policy center

Lets platform and security teams define guardrails that connectors or runtimes can apply.

Policy areas:

- model providers and models
- tool / MCP allowlist and denylist
- network domains
- workspace path access
- secret redaction
- artifact upload limits
- approval gates for risky operations

### Asset registry

Stores reusable organizational assets discovered during agent work.

Asset types:

- skill
- prompt
- workflow / playbook
- memory snippet
- tool config
- evaluation case

Package distribution and bootstrap bundles are owned by the private Skills Market; Evotown stores evidence, review state, and reuse outcomes.

### Review and promotion

Personal discoveries enter `pending` state first. Assets become company-wide reusable assets only after evaluation and review.

### Arena

The current game page stays as the visual simulation layer for evolution experiments, benchmarks, team learning, and demos.

### Chronicle

Chronicle should evolve into an organizational learning log that explains what improved, what failed, and which assets or policies caused measurable changes.

