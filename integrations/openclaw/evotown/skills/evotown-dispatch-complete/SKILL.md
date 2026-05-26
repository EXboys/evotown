---
name: evotown-dispatch-complete
description: Report Evotown dispatch job completion after the agent finishes real work.
---

# Evotown dispatch complete

Evotown dispatch messages include a footer like `[evotown] job_id=job_…`. **Do not** treat the OpenClaw hook HTTP response as task completion.

When the user-visible work is done:

```bash
evotown-agent-setup.py complete \
  --job-id <job_id from the message> \
  --status succeeded \
  --summary "One-line outcome for the control plane"
```

On failure:

```bash
evotown-agent-setup.py complete --job-id <job_id> --status failed --exit-code 1 --summary "reason"
```

Requires `EVOTOWN_ENGINE_INGEST_TOKEN` (`evi_…`) in `~/.config/evotown/evotown.agent.env`.

Alternatively POST `run.completed` to `{EVOTOWN_URL}/api/v1/events` with the same `run_id` as in the message footer.
