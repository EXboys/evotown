# TASK-2026-005: Enterprise console separation refresh

## Status

Review

## Scope

Replace the rejected command-tent visual direction with a clean enterprise management console that is visually separate from the Arena game experience.

## Acceptance criteria

- [x] Console removes game-themed / command-tent visual language.
- [x] Console uses a restrained enterprise layout with sidebar navigation, light background, clean cards, and standard status/risk badges.
- [x] Arena remains reachable as a separate route instead of being mixed into the management console.
- [x] Dashboard, Engines, Runs, Costs, and Risk views keep existing data behavior.
- [x] Run detail still shows signals and timeline.
- [x] Frontend build passes.

## Validation

- `npm run build` passed: `✓ 901 modules transformed` and `✓ built in 3.32s`.
- `/usr/bin/curl` route smoke test passed against the local Vite server on `127.0.0.1:5174`: `/dashboard 200`, `/runs 200`, `/risk 200`.
- ReadLints reported no errors for `EnterpriseConsole.tsx`.
- `rg` found no remaining command-tent/game-themed console terms in `EnterpriseConsole.tsx`.

