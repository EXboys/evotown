# Evotown spec index

This directory is the product and engineering decision source for Evotown.

Evotown is a standalone project. Its specs should not inherit SkillLite-specific implementation constraints by default. SkillLite can be one connected runtime, but Evotown must stay runtime-neutral.

## Spec map

| Spec | Purpose |
|------|---------|
| [product-positioning.md](product-positioning.md) | What Evotown is, what it is not, and how community / enterprise modes relate. |
| [enterprise-control-plane.md](enterprise-control-plane.md) | Core enterprise control plane architecture and product modules. |
| [engine-ingest-api.md](engine-ingest-api.md) | Runtime-neutral engine ingest and connector contract direction. |
| [asset-registry.md](asset-registry.md) | Reusable skill / prompt / workflow / memory asset lifecycle. |
| [skills-market-and-connectors.md](skills-market-and-connectors.md) | Private Skills Market and connector / proxy node architecture. |
| [policy-center.md](policy-center.md) | Enterprise policy pull, violation reporting, and approval boundaries. |
| [arena-ux.md](arena-ux.md) | Role of the game page as Arena / visual simulation layer. |
| [security-and-privacy.md](security-and-privacy.md) | Data, secrets, artifacts, employee telemetry, and enterprise privacy boundaries. |
| [roadmap.md](roadmap.md) | Phased implementation plan and acceptance signals. |

## Decision rules

1. Evotown is the **control plane and evaluation layer**, not a replacement runtime.
2. OpenClaw, Hermes, SkillLite, and custom runners must remain first-class integration targets.
3. The game page stays, but enterprise governance features must live in a practical console.
4. Personal agent discoveries must pass review before becoming company-wide defaults.
5. Private Skills Market owns package distribution; Evotown owns run evidence, review, and evaluation.
6. Product docs may summarize specs, but specs are the source of truth for roadmap and architecture direction.

