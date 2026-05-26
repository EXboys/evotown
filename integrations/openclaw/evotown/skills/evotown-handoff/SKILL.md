---
name: evotown-handoff
description: Queue a cross-agent or cross-team handoff through the Evotown control plane.
---

# Evotown handoff

When a task should continue on another engine or team, **do not** message them in chat directly. Queue a handoff on Evotown.

## CLI (employee machine)

```bash
evotown-agent-setup.py handoff \
  --to-team finance \
  --title "Expense review" \
  --message "Please verify the summary and approve or reject."
```

Or target a specific engine:

```bash
evotown-agent-setup.py handoff --to-engine hermes-bob --message "..."
```

Requires `EVOTOWN_INGEST_TOKEN` and prior `register`.

## HTTP (from automation)

```http
POST {EVOTOWN_URL}/api/v1/jobs/from-engine
Authorization: Bearer {EVOTOWN_INGEST_TOKEN}

{
  "kind": "handoff",
  "source_engine_id": "openclaw-alice",
  "target_team_id": "finance",
  "title": "Handoff",
  "message": "..."
}
```

The receiving machine's **Connector** will lease the job and trigger local OpenClaw/Hermes Gateway.

Load the **evotown-dispatch-complete** skill when executing Evotown dispatch jobs.

When **this** agent finishes the leased job, report completion (do not rely on hook HTTP alone):

```bash
evotown-agent-setup.py complete --job-id <job_id from task payload> --status succeeded --summary "..."
```

Or POST `run.completed` to `/api/v1/events` with the same `run_id` as the dispatch job.
