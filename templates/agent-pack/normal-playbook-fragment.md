<!-- doc_id: doc_templates_agent_pack_normal_fragment -->
<!--
  Reusable normal-channel playbook fragment for one explicit task card.
  Source of truth: docs/governance/batch-playbook.md
-->

## ATM normal channel (single task)

You have exactly one explicit task card. ATM owns the claim and close.

### Command sequence

```bash
# 1. Claim
node atm.mjs next --claim --actor <id> --prompt "<task id or description>" --json

# 2. Implement non-.atm deliverables declared by the task card

# 3. Run required validators

# 4. Capture evidence (same as batch step 2.3)
node atm.mjs evidence add \
  --task <task-id> --actor <id> --kind test --freshness fresh \
  --summary "<what passed>" --artifacts <real-files> \
  --validators <validator-name> --command "<command>" \
  --exit-code 0 \
  --stdout-sha256 sha256:<hash> --stderr-sha256 sha256:<hash> --json

# 5. Close the task
node atm.mjs tasks close --task <task-id> --actor <id> --status done --json

# 6. Commit deliverables + ledger entries together
git add <deliverables> \
        .atm/history/tasks/<task-id>.json \
        .atm/history/evidence/<task-id>.json \
        .atm/history/task-events/<task-id>/
git commit -m "<scope>: complete <task-id>"
```

### Don't

- ❌ `tasks reserve` / `promote` / `claim` manually before `next --claim`.
- ❌ Close without real non-`.atm` deliverables.
- ❌ Commit task closure separately from the deliverable it proves.

### Full reference

`docs/governance/batch-playbook.md`
