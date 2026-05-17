# Arena UX

## Decision

Keep the game page.

The Arena is not the whole enterprise product, but it is a differentiator. It should become the visual simulation layer for evolution experiments, benchmarks, team learning, and demos.

## Product role

Arena should visualize:

- engines as runtime classes or species
- teams as groups
- tasks as quests
- approved assets as abilities or equipment
- policy violations as blocked actions
- benchmark rounds as tournaments
- progress over time as an evolution map

## Enterprise framing

Avoid describing Arena as "just a game" in enterprise docs.

Preferred language:

> Arena is the visual simulation layer for evolution experiments, benchmarks, and team-level learning.

## Navigation role

Target navigation:

- `Dashboard`: enterprise overview
- `Runs`: run list and run detail
- `Engines`: runtime registry and health
- `Policies`: guardrails and approval rules
- `Assets`: company registry
- `Reviews`: pending assets and risky operations
- `Arena`: visual simulation
- `Chronicle`: organizational learning log

## Existing page mapping

| Current page | Future role |
|--------------|-------------|
| `/arena` | Arena view |
| `/task-history` | Runs |
| `/chronicle` | Chronicle |
| `/agents/{id}/metrics` | Run / engine / team metrics data source |

