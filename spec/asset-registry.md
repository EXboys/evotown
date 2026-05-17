# Asset registry

## Goal

Convert individual agent discoveries into reusable company assets without allowing unreviewed local changes to become organization-wide defaults.

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

