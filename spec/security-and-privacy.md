# Security and privacy

## Goal

Make Evotown useful for enterprise visibility without collecting unnecessary employee or secret data.

## Data principles

1. Collect structured run metadata before raw logs.
2. Redact secrets before upload whenever possible.
3. Treat artifacts as potentially sensitive.
4. Keep source run lineage for every promoted asset.
5. Separate observability from employee surveillance in product language and permissions.

## Sensitive data classes

- API keys and tokens
- customer data in prompts or artifacts
- source code and private repository paths
- local filesystem paths
- employee identifiers
- model responses containing confidential material

## Required controls

- token-scoped engine authentication
- HMAC or bearer auth for mutating ingest requests
- TLS for production deployments
- artifact size limits
- log excerpt limits
- retention policy for runs, artifacts, and events
- role-based access for enterprise console pages

## Redaction expectations

Connectors should redact before upload. Evotown should still apply server-side redaction as defense in depth.

Examples:

- replace secret-like values with stable fingerprints
- store file hashes instead of raw file content when possible
- keep full artifact bundles optional, not mandatory

## Employee privacy

Enterprise deployments should support team-level views by default and restrict per-employee drill-down to authorized roles.

Evotown should make visible:

- which policy collected which data
- why a run or artifact was retained
- who reviewed or promoted an asset

