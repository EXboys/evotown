# Policy center

## Goal

Give enterprises visibility and control over agent behavior without requiring Evotown to replace every runtime.

## Policy categories

- model provider allowlist / denylist
- model name allowlist / denylist
- tool and MCP allowlist / denylist
- network domain rules
- workspace path rules
- secret redaction rules
- artifact upload size and file-type limits
- high-risk operation approval rules

## Pull-based first design

The first enterprise design should use pull-based policy:

```text
GET /api/v1/policies
POST /api/v1/policy/violations
```

Connectors or runtimes pull policies, enforce what they can, and report violations.

This works across employee laptops and self-hosted runners without requiring Evotown to sit inline for every operation.

## Policy violation record

Minimum fields:

- `violation_id`
- `run_id`
- `engine_id`
- `policy_id`
- `severity`
- `action`: `blocked`, `warned`, `reported`
- `resource`: model, tool, domain, file path, secret, artifact
- `timestamp`
- redacted context

## Approval queue

High-risk actions can become approval items:

- external network access outside allowlist
- filesystem access outside workspace
- secret-like content in artifact
- tool call requiring elevated permission
- asset promotion to company default

## Boundary

Evotown policy center is not a full EDR or MDM system. It can integrate with endpoint tools later, but the first product surface should focus on agent-specific policy.

