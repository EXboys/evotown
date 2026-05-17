# TASK-2026-001: Enterprise control plane spec and task foundation

## Status

Review

## Priority

P1

## Scope

Establish Evotown's independent product / engineering spec system and task workflow for the enterprise control plane direction.

This task covers:

- Creating `spec/` as Evotown's source of product and architecture decisions.
- Creating `tasks/` as Evotown's execution record system.
- Documenting the enterprise control plane direction without claiming it is already implemented.
- Keeping README and docs indexes linked to the new specs.

## Acceptance criteria

- [x] `spec/README.md` exists and lists core Evotown specs.
- [x] Enterprise control plane specs exist for positioning, ingest, assets, policy, Arena UX, security/privacy, and roadmap.
- [x] `tasks/README.md` documents the task workflow.
- [x] `tasks/board.md` lists this task.
- [x] Task artifacts exist for TASK-2026-001.
- [x] README / docs index link to the spec system.
- [ ] Maintainer reviews wording and decides whether to commit/push.

## Risks

- Product planning could be mistaken for shipped capability. Specs and docs must clearly say planning / target direction where appropriate.
- Evotown could appear too SkillLite-dependent. Specs must preserve runtime neutrality.
- Too much process could slow early product iteration. Keep task workflow lightweight.

## Validation

- Re-read modified README / spec / task files.
- Check `git status -sb` and diff summary.
- Run lint diagnostics for edited Markdown files if available.

## Regression scope

Docs-only. No backend, frontend, API, or deployment behavior should change.

