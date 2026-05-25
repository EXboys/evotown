# Asset registry

## Goal

Convert individual agent discoveries into reusable company assets without allowing unreviewed local changes to become organization-wide defaults.

Evotown's asset registry is the evidence and review layer. The private Skills Market is the package distribution layer for installable skills and bootstrap bundles.

## Asset types

- `skill`
- `prompt`
- `workflow`
- `playbook`
- `memory_snippet`
- `tool_config`
- `evaluation_case`

## Required metadata

- `asset_id`
- `asset_type`
- source `run_id`
- author
- team
- version
- status
- tags
- target scenarios
- benchmark results
- usage count
- post-promotion success rate
- rollback pointer

## Lifecycle

```text
proposed -> pending -> approved -> promoted
                 \-> rejected
approved -> deprecated
promoted -> rolled_back
```

## Product rules

1. Every asset must be traceable to a source run or manual import record.
2. `pending` assets are visible to reviewers but not recommended by default.
3. `approved` assets can be searched and selected.
4. `promoted` assets can be recommended automatically.
5. `deprecated` assets remain auditable but should not be recommended.
6. Rollback must preserve the prior version and reason.

## First implementation slice

- Store assets and metadata.
- Link each asset to a source run.
- Provide asset list and detail views.
- Support `pending`, `approved`, `rejected`.
- Add manual reviewer action before automatic promotion.

## Skills Market handoff

For `skill` assets, approval should produce or update a package record in the private Skills Market.

Evotown should send or reference:

- source `run_id`
- candidate package URL or manifest
- validation result
- reviewer decision
- intended visibility: private, team, or company
- target runtimes: OpenClaw, Hermes, SkillLite, custom
- rollback pointer

Evotown may recommend approved skills based on evidence, but runtime installation should still resolve through the market manifest.

