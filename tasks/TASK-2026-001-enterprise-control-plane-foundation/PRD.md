# PRD: Enterprise control plane spec and task foundation

## Problem

Evotown is evolving from a visual evolution arena into a broader enterprise control plane for independently deployed agent runtimes. Without its own specs and task workflow, product decisions remain scattered across README, docs, and chat context.

## Goals

- Give Evotown a standalone `spec/` system independent from SkillLite's repository-specific rules.
- Define the enterprise control plane direction as a product plan, not as shipped behavior.
- Add a lightweight `tasks/` workflow for execution traceability.
- Preserve runtime neutrality across OpenClaw-style stacks, Hermes, SkillLite, and custom runners.

## Non-goals

- Implementing enterprise control plane backend features.
- Implementing UI pages for Dashboard, Policies, Assets, or Reviews.
- Adding runtime connectors.
- Replacing the existing Arena page.

## Target users

- Evotown maintainers.
- Product / engineering contributors.
- Enterprise platform evaluators reading the roadmap.

## Product decisions

- Evotown remains an evolution arena and gains an enterprise control plane direction.
- The game page stays as Arena, a visual simulation layer.
- `spec/` is the durable source of product / architecture direction.
- `docs/` can provide readable summaries and public-facing docs.
- `tasks/` tracks execution work and validation evidence.

