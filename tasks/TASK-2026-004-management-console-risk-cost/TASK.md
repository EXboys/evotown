# TASK-2026-004: Management console risk/cost UI

## Status

Review

## Scope

Add visible enterprise management surfaces for cost, risk, and run detail timeline.

## Acceptance criteria

- [x] `/costs` route displays token/cost summary.
- [x] `/risk` route displays policy violations.
- [x] `/runs` supports click-through run detail.
- [x] Run detail shows signals, cost fields, timeline events, and policy violation events.
- [x] Backend supports `POST /api/v1/events` and `GET /api/v1/runs/{run_id}/events`.
- [x] Backend supports `POST /api/v1/policy/violations` and `GET /api/v1/policy/violations`.
- [x] Backend supports `GET /api/v1/costs/summary`.

## Validation

- `npm run build` passed.
- Risk and events API smoke checks passed against local backend.
- `ReadLints` reported no errors on edited code.

