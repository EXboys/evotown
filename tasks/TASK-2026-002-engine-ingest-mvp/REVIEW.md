# Review: Engine ingest backend MVP

## Findings

No known blocking findings.

## Review notes

- MVP implements bearer auth only; HMAC signing remains future work and is documented as such.
- The router rejects unknown engines during run completion to preserve provenance.
- Data is stored in a separate SQLite database, reducing risk to existing Arena state.

## Validation checklist

- [x] Python compile check passed.
- [x] API smoke test passed in a temporary venv.
- [x] OpenAPI updated for implemented endpoints.
- [x] EN/ZH ingest docs updated.
- [x] Env var documented in `.env.example` and Docker Compose.
- [ ] Maintainer review.
- [ ] Commit / push decision.

## Residual risks

- No persistent automated test suite exists yet.
- Frontend does not expose the new engine/run data yet.
- HMAC signing and replay protection are not implemented.

