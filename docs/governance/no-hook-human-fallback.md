# No-Hook and Human Collaboration Fallback

When editor hooks are unavailable, ATM still protects mainline collaboration through claim, git governance, and evidence gates.

## Standard Flow (AI or Human)

1. Resolve actor identity:

```bash
node atm.mjs actor resolve --id <actor-id> --json
```

2. Reserve/promote/claim:

```bash
node atm.mjs tasks reserve --task <task-id> --actor <actor-id> --json
node atm.mjs tasks promote --task <task-id> --actor <actor-id> --json
node atm.mjs tasks claim --task <task-id> --actor <actor-id> --files <csv> --json
```

3. Prepare git identity:

```bash
node atm.mjs git prepare --task <task-id> --actor <actor-id> --json
```

4. Before commit:

```bash
node atm.mjs guard mutation --task <task-id> --actor <actor-id> --files <csv> --json
```

5. Commit with ATM trailers:

- `ATM-Task: <task-id>`
- `ATM-Actor: <actor-id>`
- `ATM-Claim: <lease-id>`
- `ATM-Evidence: <evidence-ref>`

6. Validate git governance:

```bash
node atm.mjs git check --task <task-id> --actor <actor-id> --json
```

7. Add and verify evidence:

```bash
node atm.mjs evidence add --task <task-id> --actor <actor-id> --kind test --json
node atm.mjs evidence verify --task <task-id> --gate close --json
```

8. Close task:

```bash
node atm.mjs tasks close --task <task-id> --actor <actor-id> --status done --json
```

## Safety Boundary

Without hooks, local edits are possible. The enforced boundary is:

- active claim lease
- git trailer + identity checks
- evidence gate for close/commit/PR
- CI or pre-commit governance checks before mainline merge
