<!-- doc_id: doc_templates_agent_pack_batch_fragment -->
<!--
  Reusable batch-channel playbook fragment.
  Editor adapters must include this verbatim instead of inventing their own
  batch flow text. Source of truth: docs/governance/batch-playbook.md
-->

## ATM batch channel

You are inside an active `batchId`. ATM owns the queue order, checkpoint,
and advance. You work on one queue head at a time.

### Command sequence

```bash
# 1. Start (or resume) the batch
node atm.mjs next --claim --actor <id> --prompt "<plan or task list>" --json

# 2. For each queue head:
#    2.1 Implement non-.atm deliverables declared by the task card
#    2.2 Run validators required by the task card
#    2.3 Capture evidence
node atm.mjs evidence add \
  --task <queue-head-task-id> --actor <id> --kind test --freshness fresh \
  --summary "<what passed>" --artifacts <real-files> \
  --validators <validator-name> --command "<command>" \
  --exit-code 0 \
  --stdout-sha256 sha256:<hash> --stderr-sha256 sha256:<hash> --json

#    2.4 Stage deliverables + evidence
git add <deliverables> .atm/history/evidence/<queue-head-task-id>.json

#    2.5 Checkpoint to close current task and advance the queue
node atm.mjs batch checkpoint --actor <id> --json

#    2.6 Commit deliverables + ledger entries together
git add .atm/history/tasks/<queue-head-task-id>.json \
        .atm/history/task-events/<queue-head-task-id>/
git commit -m "<scope>: complete <queue-head-task-id>"
```

For ordinary queue-head files, keep the lifecycle as:

```text
claim batch -> implement queue head -> validators -> evidence add -> batch checkpoint -> commit
```

Framework critical files still require the same claim, validators, and
command-backed evidence. If the close/checkpoint gate reports
`ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE`, do not edit ATM history by hand and do
not ignore the gate. Follow the gate repair path:

```text
governed delivery commit -> tasks close --historical-delivery <commit> -> closure commit
```

Use that only when ATM is repairing a framework critical delivery that already
landed in a scoped delivery commit. It is not a weaker evidence path.

### Do

- Trust ATM to own the queue order.
- Add evidence **before** checkpoint.
- One commit per task.

### Don't

- ❌ `tasks reserve` / `promote` / `claim` / `close` manually during a batch.
- ❌ `next --prompt` with a later task id to leave the batch.
- ❌ Commit before `batch checkpoint` succeeds.
- ❌ Close later tasks before the queue head is delivered.

### If stuck

```bash
node atm.mjs status --json
node atm.mjs batch status --batch <batchId> --json
```

Look at the `phase` field and the printed `requiredCommand`.

### Full reference

`docs/governance/batch-playbook.md`
