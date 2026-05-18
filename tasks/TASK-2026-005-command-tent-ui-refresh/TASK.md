# TASK-2026-005: Enterprise console separation refresh

## Status

Review

## Scope

Replace the rejected command-tent visual direction by rebuilding the management console as a modern enterprise SaaS control plane that is visually separate from the Arena game experience.

## Acceptance criteria

- [x] Console removes game-themed / command-tent visual language.
- [x] Console uses a modern enterprise SaaS layout with a dark sidebar, light work area, clean cards, table-first data views, and standard status/risk badges.
- [x] Console isolates its typography from the global game serif font and uses a modern enterprise sans-serif stack.
- [x] Dashboard avoids duplicate sidebar/top-tab navigation at desktop widths.
- [x] Runs page uses a table-first observability layout with selected-run state, right-side detail panel, lightweight metrics, and a simplified timeline.
- [x] Arena remains reachable as a separate route instead of being mixed into the management console.
- [x] Dashboard, Engines, Runs, Costs, and Risk views keep existing data behavior.
- [x] Run detail still shows signals and timeline.
- [x] Frontend build passes.

## Validation

- `npm run build` passed after the full SaaS console rebuild: `✓ 901 modules transformed` and `✓ built in 3.67s`.
- `/usr/bin/curl` route smoke test passed against the local Vite server on `127.0.0.1:5174`: `/dashboard 200`, `/runs 200`, `/engines 200`, `/costs 200`, `/risk 200`.
- ReadLints reported no errors for `EnterpriseConsole.tsx`.
- `rg` confirmed there are no command-tent/game-themed terms, heavy glow utilities, or old dark-game-shell markers in `EnterpriseConsole.tsx`.

