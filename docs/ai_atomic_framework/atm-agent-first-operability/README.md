# ATM Agent-First Operability

This directory is the repo-local mirror for the AAO plan.

Use this mirror to import and claim the AAO queue in ATM:

```bash
node atm.mjs tasks import --from "docs/ai_atomic_framework/atm-agent-first-operability/AAO-Plan.md" --dry-run --cwd . --json
node atm.mjs tasks import --from "docs/ai_atomic_framework/atm-agent-first-operability/AAO-Plan.md" --write --cwd . --json
```

## Purpose

- Keep AAO separate from the ASA self-atomization mainline.
- Provide a parseable plan mirror for `TASK-AAO-0001 ~ TASK-AAO-0008`.
- Keep external bridge notes for `TASK-ATD-0023` and `TASK-ATD-0032` visible without reopening them here.

## Entry Points

- [Plan](./AAO-Plan.md)
- [Task index](./tasks/README.md)
