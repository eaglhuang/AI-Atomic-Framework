# Task Reservation Lifecycle

ATM core now supports a neutral reservation lifecycle for multi-human and multi-AI collaboration.

## Lifecycle States

- `reserved`: task id is occupied, not claimable yet.
- `ready`: task can be claimed by an actor lease.
- `running`: task has an active claim/lease.
- `review`: implementation is waiting for review decision.
- `done`: closed with required evidence.
- `blocked`: waiting for dependency or external unblock.
- `abandoned`: intentionally stopped and no longer active.

Legacy `open` and `in_progress` states are preserved for compatibility, but queue selection prefers `ready`.

## CLI Workflow

1. Reserve task id:

```bash
node atm.mjs tasks reserve --task ATM-GOV-0103 --actor codex-main --title "Task title" --json
```

2. Promote to claimable:

```bash
node atm.mjs tasks promote --task ATM-GOV-0103 --actor codex-main --json
```

3. Claim directly from next-action routing:

```bash
node atm.mjs next --claim --actor codex-main --json
```

`next --claim` claims the selected imported task and returns claim evidence for downstream guard and git governance checks.
