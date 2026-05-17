# PRD: Engine ingest backend MVP

## Problem

The v0.1 engine ingest contract existed as documentation, but Evotown did not yet expose backend endpoints for external engines to register and report completed runs.

## Goals

- Make the external engine ingest API real enough for connector prototypes.
- Keep the implementation runtime-neutral.
- Store external engine data separately from existing Arena state.
- Provide a simple bearer-token auth path for MVP integrations.

## Non-goals

- Full HMAC webhook signing.
- Live event streaming.
- Policy pull.
- Asset proposal and promotion.
- Frontend UI for engines or external runs.

## Target behavior

External engines can:

1. Register metadata with Evotown.
2. Report a completed run.
3. Retry the same completion call safely.
4. Read back registered engines and stored external runs.

## Product decision

Unknown `engine_id` is rejected for run completion. Engines must register first so Evotown can keep provenance clear.

