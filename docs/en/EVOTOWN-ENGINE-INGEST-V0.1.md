# Evotown engine ingest API — v0.1 (draft)

**Status:** Draft specification for integrators. **This file is the canonical copy in the Evotown repository.** [SkillLite](https://github.com/EXboys/skilllite) may mirror the same document under `docs/en/` for contributors using the combined monorepo checkout.

**Scope v0.1:** Inbound ingest only + optional engine registration. Dispatch (Evotown → engine) is described as an optional pairing pattern, not required for v0.1.

---

## Base URL and versioning

- **Prefix:** `/api/v1`
- **Full example:** `https://{evotown-host}/api/v1`
- **Versioning:** Bump to `/api/v2` for breaking changes; v0.1 fields remain forward-compatible where possible.

---

## Authentication (MUST for production)

Every mutating request MUST include one of:

1. **`Authorization: Bearer <evotown_issued_token>`** — engine-scoped token issued by Evotown, or
2. **`X-Evotown-Timestamp` + `X-Evotown-Signature`** — HMAC-SHA256 over `"{timestamp}." + raw_body` with a shared secret (clock skew ≤ 5 minutes).

**Current MVP implementation:** bearer auth is implemented with `EVOTOWN_ENGINE_INGEST_TOKEN`; for single-node local development it falls back to `ADMIN_TOKEN`. HMAC signing is reserved for a later hardening pass.

Integrators SHOULD use TLS (HTTPS). Evotown SHOULD reject replayed `run_id` + identical payload (idempotency window implementation-defined).

---

## 1) `POST /engines/register` — optional

Registers or updates an engine record so Evotown can show provenance and optional dispatch URL.

**Request JSON**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `engine_id` | string | yes | Stable id, e.g. `openclaw-local`, `hermes-foo`. |
| `engine_version` | string | yes | Semver or git sha. |
| `display_name` | string | no | Human label. |
| `engine_type` | string | no | `openclaw` \| `hermes` \| `skilllite` \| `custom` (default: `custom`). |
| `owner_team` | string | no | Team or organization owner. |
| `deployment_kind` | string | no | `laptop` \| `server` \| `ci` \| `container` (default: `server`). |
| `dispatch_url` | string (URL) | no | If Evotown later pushes jobs, POST target for `RunJob` (see appendix). |
| `capabilities` | object | no | Opaque key/values (e.g. max timeout). |

**Response:** MVP returns `200` with `{ "registered": true, "engine": { ... } }`.

## 1.1) `GET /engines` — implemented MVP

Lists registered engines.

**Response:** `200` with `{ "engines": [ ... ] }`.

---

## 2) `POST /runs/{run_id}/complete` — **required (MVP)**

**`run_id`:** opaque string issued by Evotown (or pre-registered); URL-safe.

Finalizes a run. Evotown persists status, logs excerpt, artifact manifest, and `signals` for dashboards / evolution metrics.

**Request JSON**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `engine_id` | string | yes | Must match token scope or registered engine. |
| `engine_version` | string | yes | |
| `status` | string | yes | `succeeded` \| `failed` \| `cancelled`. |
| `exit_code` | integer | yes | Process or harness exit code; use `0` if N/A. |
| `finished_at` | string | yes | RFC3339 UTC. |
| `log_excerpt` | string | no | Truncated stdout/stderr or structured log text (≤ 64 KiB recommended). |
| `artifact_manifest` | array | no | See below. |
| `artifact_bundle_url` | string (URL) | no | HTTPS URL to a zip/tar Evotown MAY fetch (size limits implementation-defined). |
| `signals` | object | no | **Scoring / evolution hooks** — string keys, JSON values (booleans, numbers, strings, arrays). Examples: `task_completed`, `new_skill_paths`, `latency_ms`. |

**`artifact_manifest` item**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | Relative path inside bundle or workspace snapshot. |
| `sha256` | string | yes | Lowercase hex digest of raw bytes. |
| `bytes` | integer | yes | Length in bytes. |

**Response:** MVP returns `200` with `{ "accepted": true, "idempotent": false, "run_id": "<same>", "run": { ... } }`.

If the same `run_id` is submitted again, MVP returns `200` with `idempotent: true` and the stored run. Unknown `engine_id` returns `422`; engines should register first.

**Errors:** `401` auth, `422` schema validation, `413` payload too large.

## 2.1) `GET /runs` and `GET /runs/{run_id}` — implemented MVP

Lists stored external runs, optionally filtered by `engine_id`, or returns one run by id.

---

## 3) `POST /runs/{run_id}/artifacts` — optional (large blobs)

Multipart **`file`** part OR JSON with **`base64`** chunk (implementation SHOULD pick one). Used when manifests are not enough. v0.1 engines MAY skip this and only send `artifact_bundle_url` on `complete`.

---

## 4) `POST /runs/lease` — optional (pull model)

Engine pulls work instead of Evotown pushing. Evotown returns at most one job.

**Response `200` JSON** when work exists:

| Field | Type | Description |
|-------|------|-------------|
| `run_id` | string | |
| `callback_base` | string (URL) | MUST be the Evotown API prefix through `/api/v1` (no trailing slash). Engine POSTs to `{callback_base}/runs/{run_id}/complete`. |
| `payload` | object | Opaque task specification (messages, paths, git ref, etc.). |

**Response `204`:** no work available.

---

## Semantics

- **Truth:** After `complete`, Evotown’s stored run is authoritative for benchmarks and evolution rewards.
- **Engine freedom:** OpenClaw / Hermes / other layouts stay inside the engine; only **manifest + signals** need to be Evotown-shaped.
- **Privacy:** Do not send secrets in `log_excerpt` or `signals`; use references if needed.

---

## Appendix A — Dispatch pairing (non-normative for v0.1)

If Evotown pushes jobs to `dispatch_url`:

```http
POST {dispatch_url}/v1/execute
```

Example body:

```json
{
  "run_id": "01JABC...",
  "callback_url": "https://evotown.example/api/v1/runs/01JABC.../complete",
  "payload": { }
}
```

The engine MUST call Evotown’s `callback_url` (same contract as section 2) when finished.

---

## Appendix B — SkillLite (companion project)

[SkillLite](https://github.com/EXboys/skilllite) interoperates with OpenClaw-style skill trees via CLI (`import-openclaw-skills`, `claw migrate`); that is **orthogonal** to this ingest API. Engines may use SkillLite internally and still report to Evotown through this HTTP surface.

**Other language:** [简体中文版本](../zh-CN/EVOTOWN-ENGINE-INGEST-V0.1.md).
