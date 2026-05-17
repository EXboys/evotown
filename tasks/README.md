# Evotown task workflow

This directory tracks non-trivial Evotown product and engineering work.

Use `spec/` for durable product and architecture rules. Use `tasks/` for execution records: scope, acceptance criteria, context, status, review notes, validation, and follow-up work.

## Task folder shape

```text
tasks/
├── board.md
└── TASK-YYYY-NNN-short-slug/
    ├── TASK.md
    ├── PRD.md
    ├── CONTEXT.md
    ├── STATUS.md
    └── REVIEW.md
```

## Required files

- `TASK.md`: execution scope, acceptance criteria, risks, validation, regression scope.
- `PRD.md`: product intent, user problem, target behavior, non-goals.
- `CONTEXT.md`: implementation context, boundaries, dependencies, compatibility notes.
- `STATUS.md`: current state, progress log, blockers, next steps.
- `REVIEW.md`: review findings, readiness, validation evidence, residual risks.

## Status values

- `Planned`
- `In Progress`
- `Blocked`
- `Review`
- `Done`
- `Deferred`

## Rules

1. Product and architecture decisions should link to `spec/`.
2. Task artifacts should stay in English for easier review and automation.
3. Do not mark a task `Done` unless acceptance criteria and validation evidence are recorded.
4. Keep `board.md` in sync when task status changes.

