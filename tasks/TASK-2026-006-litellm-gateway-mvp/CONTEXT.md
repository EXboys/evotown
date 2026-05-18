# Context: LiteLLM-backed gateway MVP

## Technical boundaries

- Evotown owns enterprise attribution, persistence, console views, and future policy hooks.
- LiteLLM owns model provider routing, provider compatibility, retries, fallback, and provider-level cost knowledge.
- The MVP stores gateway metadata in `gateway.db`, separate from Arena and engine ingest persistence.

## Compatibility

- The API path is `/api/gateway/v1/chat/completions`, compatible with OpenAI SDK base URL configuration.
- Streaming requests are rejected in the MVP to avoid partial-response persistence gaps.
- `ADMIN_TOKEN` remains a local development fallback if `EVOTOWN_GATEWAY_API_KEYS` is unset.

## Configuration

- `EVOTOWN_GATEWAY_API_KEYS`: comma-separated Evotown gateway bearer keys.
- `LITELLM_BASE_URL`: LiteLLM OpenAI-compatible base URL.
- `LITELLM_MASTER_KEY`: bearer key used by Evotown when calling LiteLLM.
- Optional Docker profile: `litellm`.
