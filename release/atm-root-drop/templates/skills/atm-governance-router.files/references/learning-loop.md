# ATM Governance Router Learning Loop

This file is a compatibility shim.

The active router learning loop now uses selective shards so future agents do
not load unrelated lessons by default.

Read order:

1. `index.md`
2. only the single matching shard

Current shards:

- `entry-friction.md`
- `route-interpretation.md`
- `boundary-confusion.md`
- `fallback-design.md`
- `tooling-mismatch.md`

Do not load all shards unless the current blocker truly spans multiple
categories.
