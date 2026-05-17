# TASK-2026-002: Engine ingest backend MVP

## Status

Review

## Priority

P1

## Scope

Implement the first backend slice of the Evotown engine ingest contract:

- Register external engines.
- List registered engines.
- Accept completed external runs.
- Return stored runs.
- Persist ingest data outside the Arena state database.
- Document the implemented MVP behavior and auth token.

## Acceptance criteria

- [x] `POST /api/v1/engines/register` stores or updates engine metadata.
- [x] `GET /api/v1/engines` lists registered engines.
- [x] `POST /api/v1/runs/{run_id}/complete` stores a completed run.
- [x] Repeating the same `run_id` is idempotent.
- [x] `GET /api/v1/runs` and `GET /api/v1/runs/{run_id}` expose stored runs.
- [x] Mutating ingest endpoints require bearer auth.
- [x] `EVOTOWN_ENGINE_INGEST_TOKEN` is documented and passed through Docker Compose.
- [x] OpenAPI and EN/ZH ingest docs reflect implemented MVP behavior.

## Validation

- `python3 -m compileall backend`
- Temporary venv smoke test using FastAPI `TestClient`:
  - register engine
  - complete run
  - repeat completion for idempotency
  - fetch run
  - list engines

## Regression scope

- Existing Arena routes should remain unchanged.
- Existing admin-token protected routes should remain unchanged.
- Ingest data writes to `engine_ingest.db`, not `arena_state.db`.

