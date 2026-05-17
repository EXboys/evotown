# TASK-2026-003: Enterprise console frontend MVP

## Status

Review

## Priority

P1

## Scope

Make the engine ingest MVP visible in the Evotown frontend.

This task covers:

- Dashboard page for external engine/run summary.
- Engines page for registered engine records.
- Runs page for completed external runs.
- Landing page and Arena entry points to the console.
- Vite proxy support for `/api/v1`.

## Acceptance criteria

- [x] `/dashboard` renders an enterprise console overview.
- [x] `/engines` lists registered engines from `GET /api/v1/engines`.
- [x] `/runs` lists external runs from `GET /api/v1/runs`.
- [x] Landing page links to the console.
- [x] Arena page links to the console.
- [x] Frontend build passes.

## Validation

- `npm run build`
- `curl -I http://127.0.0.1:5174/dashboard`
- `curl -I http://127.0.0.1:5174/engines`
- `curl -I http://127.0.0.1:5174/runs`

## Regression scope

- Existing `/arena`, `/task-history`, and `/chronicle` routes should remain unchanged.
- Existing backend APIs are only read by the new console.

