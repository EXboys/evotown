# Context: Enterprise console frontend MVP

## Files touched

- `frontend/src/components/EnterpriseConsole.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/LandingPage.tsx`
- `frontend/src/components/TownLayout.tsx`
- `frontend/vite.config.ts`

## Implementation notes

- `EnterpriseConsole` is one component with three route-backed tabs: dashboard, engines, and runs.
- Data loads from `/api/v1/engines` and `/api/v1/runs`.
- Vite now proxies `/api/v1` to the backend during local development.
- The page polls every 5 seconds so connector smoke tests appear without a manual page reload.

## Compatibility

- No frontend state store migration was needed.
- Existing Arena, Chronicle, and task history pages remain separate routes.
- No backend schema changes were introduced by this frontend task.

