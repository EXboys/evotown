# Roadmap

This roadmap is directional and should be updated as implementation reality changes.

## Phase 1: Observability foundation

Goal: make enterprise agent usage visible.

Deliverables:

- engine registry page
- improved runs page
- run detail with logs, signals, artifacts
- team and engine metrics
- README and docs positioning updates

Acceptance signals:

- a custom runner can register and report runs
- administrators can compare runs by engine and team
- Arena can consume run results as a visualization source

## Phase 2: Asset capture

Goal: turn individual output into reviewable assets.

Deliverables:

- asset data model
- `assets/propose` endpoint
- asset list and detail pages
- pending / approved / rejected states
- link every asset to source run

Acceptance signals:

- a run can propose a skill, prompt, or workflow
- reviewers can approve or reject assets
- approved assets are searchable

## Phase 3: Policy and control

Goal: make enterprise deployment safer.

Deliverables:

- policy data model
- `GET /api/v1/policies`
- policy violation ingest
- policy center UI
- approval queue for risky operations

Acceptance signals:

- connector can pull policy
- blocked actions appear in Evotown
- admins can see which policies produce violations

## Phase 4: Evaluation and recommendation

Goal: make asset reuse evidence-based.

Deliverables:

- evaluation jobs
- benchmark suites
- asset promotion and deprecation
- asset recommendation API
- asset performance dashboard

Acceptance signals:

- assets are promoted based on evaluation evidence
- worse versions can be rolled back
- users receive recommended approved assets for similar tasks

