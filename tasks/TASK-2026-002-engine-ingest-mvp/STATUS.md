# Status: Engine ingest backend MVP

## Current status

Review

## Progress

- Added engine ingest auth helper.
- Added Pydantic models for engine registration, artifact manifest items, and run completion.
- Added SQLite persistence for engines and external runs.
- Added `/api/v1` engine ingest router.
- Included the router in FastAPI startup.
- Updated env examples, Docker Compose env pass-through, OpenAPI, and EN/ZH docs.

## Blockers

None.

## Validation evidence

- `python3 -m compileall backend` completed successfully.
- Temporary venv FastAPI `TestClient` smoke test completed successfully:
  - `register 200 True openclaw-local`
  - `complete 200 True False`
  - `complete_retry 200 True True`
  - `get_run 200 run-001 True`
  - `engines 200 1`

## Next steps

- Add frontend pages for Engines / Runs in a follow-up task.
- Add live events and policy pull in a future API version.
- Add formal automated tests if the repository adopts pytest or another test runner.

