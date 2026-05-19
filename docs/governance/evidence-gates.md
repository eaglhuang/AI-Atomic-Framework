# Evidence Gates

ATM provides evidence gates for task closure, commit governance, and PR governance.

## CLI

Add evidence:

```bash
node atm.mjs evidence add --task ATM-GOV-0104 --actor codex-main --kind test --summary "validator passed" --artifacts reports/governance.json --json
```

Verify evidence gates:

```bash
node atm.mjs evidence verify --task ATM-GOV-0104 --gate close --json
node atm.mjs evidence verify --task ATM-GOV-0104 --gate commit --json
node atm.mjs evidence verify --task ATM-GOV-0104 --gate pr --json
```

Close a task with gate enforcement:

```bash
node atm.mjs tasks close --task ATM-GOV-0104 --actor codex-main --status done --json
```

`tasks close --status done` enforces the `close` evidence gate before changing status.

## Gate Rules

- `close`: at least one non-waiver evidence record.
- `commit`: non-waiver evidence plus at least one verification record (`test`, `artifact`, `attestation`, or `commit`).
- `pr`: at least one `review` evidence and at least one verification record.
