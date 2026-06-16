# Atomization Registration And Receipts

When a task creates or extends an atom or atom-map ownership boundary, ATM
should leave two things behind:

1. a formal registration change in the owner-shard / projection artifacts
2. a receipt proving that the registration was generated and validated

This document describes the lightweight script path for that flow.

## Receipt script

Use the built-in script:

```bash
node scripts/src/atomization-register-receipt.js register-path \
  --repo . \
  --task TASK-CID-0104 \
  --shard atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json \
  --path-pattern packages/cli/src/commands/evidence.ts \
  --atom-id atm.historical-batch-evidence \
  --capability "historical batch evidence slicing and atom health close gates" \
  --source-task TASK-CID-0104 \
  --map-id atm.task-closure-map
```

The script:

- updates the selected owner shard row
- rebuilds `atomic_workbench/atomization-coverage/path-to-atom-map.json`
- runs `npm run validate:atomization-coverage` by default
- writes a receipt under
  `atomic_workbench/atomization-coverage/receipts/<task-id>/`

Each receipt records:

- the registered row
- any referenced map ids
- before/after ownership snapshots
- validator results
- whether the registration is healthy enough to trust

## Task snapshot guard

For a lightweight anti-leak check, capture task snapshots before and after the
task and compare totals instead of diffing every atom manually:

```bash
node scripts/src/atomization-register-receipt.js snapshot --repo . --task TASK-CID-0104 --phase before
node scripts/src/atomization-register-receipt.js snapshot --repo . --task TASK-CID-0104 --phase after
node scripts/src/atomization-register-receipt.js verify-task \
  --repo . \
  --task TASK-CID-0104 \
  --expected-atom-delta 0 \
  --expected-map-delta 0 \
  --expected-path-delta 1
```

The snapshot tracks:

- atom registry count
- map registry count
- mapped path count
- stable digests for each inventory

This is intentionally cheap. It catches "we created ownership but forgot to
register it" without forcing a full per-atom review on every task.

## How this fits normal evidence and close

The script does not replace ATM evidence. It complements it.

- `evidence add` / `evidence historical-batch` now record atom health claims
  for task cards that declare `atomizationImpact`.
- close verification requires healthy atom-or-map evidence for tasks that
  declare atomization impact.
- the receipt script gives the forward path a fixed place to leave proof when
  a task creates or expands atom ownership.

## Recommended workflow

1. Capture a `before` snapshot for tasks that will create or expand ownership.
2. Update the owner shard through the receipt script.
3. Rebuild projection and run validators through the same script.
4. Capture an `after` snapshot.
5. Run `verify-task` with expected deltas.
6. Attach the resulting receipt paths in task evidence or historical batch
   evidence.
