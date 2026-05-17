# Context: Engine ingest backend MVP

## Files touched

- `backend/core/auth.py`
- `backend/domain/models.py`
- `backend/infra/engine_ingest.py`
- `backend/api/routers/engine_ingest.py`
- `backend/main.py`
- `.env.example`
- `docker-compose.yml`
- `docs/en/EVOTOWN-ENGINE-INGEST-V0.1.md`
- `docs/zh-CN/EVOTOWN-ENGINE-INGEST-V0.1.md`
- `docs/openapi/evotown-engine-ingest-v0.1.yaml`
- README files

## Implementation notes

- Ingest persistence uses `EVOTOWN_DATA_DIR` and writes `engine_ingest.db`.
- Auth uses `Authorization: Bearer <token>`.
- Token source is `EVOTOWN_ENGINE_INGEST_TOKEN`, falling back to `ADMIN_TOKEN` for local development.
- Router prefix is `/api/v1` to match the ingest spec.

## Compatibility

- Existing `/agents`, `/tasks`, `/monitor`, `/config`, `/arena`-related behavior should be unaffected.
- Existing `X-Admin-Token` admin auth remains unchanged.
- HMAC signing is documented as future hardening, not implemented in this MVP.

