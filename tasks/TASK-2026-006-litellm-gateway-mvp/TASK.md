# TASK-2026-006: LiteLLM-backed gateway MVP

## Status

Review

## Scope

Add a minimal centralized model gateway so OpenClaw, Hermes, SkillLite, and custom agents can call an Evotown OpenAI-compatible endpoint while Evotown forwards traffic to LiteLLM and records enterprise usage metadata.

## Acceptance criteria

- [x] Backend exposes `POST /api/gateway/v1/chat/completions` as a non-streaming OpenAI-compatible proxy.
- [x] Backend records gateway requests, conversations, token usage, cost, latency, and ownership metadata in SQLite.
- [x] Backend exposes gateway usage, conversation, request, and key-label read APIs.
- [x] Docker Compose includes an optional LiteLLM service profile and config file.
- [x] Console includes a Gateway page with usage cards, model/agent usage, conversations, and integration instructions.
- [x] README files document the LiteLLM-backed gateway configuration.

## Validation

- `npm run build` passed: `✓ 901 modules transformed` and `✓ built in 3.64s`.
- `/tmp/evotown-backend-venv/bin/python -m compileall backend` passed.
- `docker compose config --quiet` passed.
- Gateway read APIs returned `200`: `/api/gateway/v1/health`, `/usage/summary`, `/conversations`, `/api-keys`.
- Frontend routes returned `200`: `/dashboard`, `/gateway`, `/runs`, `/engines`, `/costs`, `/risk`.
- Gateway auth smoke test returned `403` without bearer token.
- Gateway upstream smoke test returned expected `502` with `Authorization: Bearer evotown_agent_key_dev` because LiteLLM was not running locally; request metadata was still recorded in `usage/summary`.
