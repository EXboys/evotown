# Engine ingest and connector contract

## Goal

Allow independently deployed engines to report into Evotown without depending on Evotown as their runtime.

## Current foundation

The v0.1 ingest API defines the first contract:

- `POST /api/v1/engines/register`
- `GET /api/v1/engines`
- `POST /api/v1/runs/{run_id}/complete`
- `GET /api/v1/runs`
- `GET /api/v1/runs/{run_id}`
- optional artifact upload
- optional run lease

See:

- [../docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md](../docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md)
- [../docs/openapi/evotown-engine-ingest-v0.1.yaml](../docs/openapi/evotown-engine-ingest-v0.1.yaml)

MVP implementation notes:

- Mutating endpoints use bearer auth.
- Token source is `EVOTOWN_ENGINE_INGEST_TOKEN`, falling back to `ADMIN_TOKEN` for local development.
- External ingest data is stored in `engine_ingest.db` under `EVOTOWN_DATA_DIR`.
- Unknown engines are rejected during run completion; register first.

## Integration modes

### HTTP ingest only

The external runtime reports completed runs. This is the lowest-friction path and should remain stable.

### Local connector

A small process runs near the employee workspace.

Responsibilities:

- detect local agent runs
- upload run events and artifacts
- pull policies
- redact secrets before upload
- propose reusable assets

### Gateway integration

Evotown may integrate with model gateways for routing, cost, and audit, but gateway mode must not be required.

## Future API direction

### v0.2: live events and policy pull

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

### v0.3: asset proposal

```text
POST /api/v1/assets/propose
GET  /api/v1/assets
POST /api/v1/assets/{asset_id}/review
GET  /api/v1/assets/recommend
```

### v0.4: evaluation and promotion

```text
POST /api/v1/evaluations
GET  /api/v1/evaluations/{evaluation_id}
POST /api/v1/assets/{asset_id}/promote
POST /api/v1/assets/{asset_id}/deprecate
```

