# Boundary Confusion Lessons

Use this shard for planning-source vs target-ledger truth mismatches,
dependency blockers, and governance-closure ambiguity.

## 2026-06-23 - Planning repo says done but target repo still blocks on stale import

- Trigger: planning-repo task was reconciled or closed, but the target repo
  keeps evaluating an older imported snapshot
- Symptom: downstream claim is blocked by a dependency that is already done in
  the planning source of truth
- Correct ATM route: compare planning truth and imported target snapshot before
  assuming the dependency blocker is real; if stale, use the governed refresh
  path instead of random lifecycle retries
- Durable rule: cross-repo dependency blockers must be checked for stale import
  truth before escalation
- Backlog link: `ATM-BUG-2026-06-23-020`

## 2026-06-28 - Dependency blocker may be an import-truth gap, not missing implementation

- Trigger: `next --claim` reports dependency blockers for prerequisite task ids,
  but the blocker detail says the prerequisite task snapshots are `missing`
- Symptom: the agent almost concludes the dependency work is still undone,
  despite the planning task cards already being marked `done` or reconciled
- Correct ATM route: compare the planning card status with the target ledger
  snapshot before redesigning the work; when dependency truth is missing from
  the target ledger, import or refresh the prerequisite task snapshots first
- Durable rule: missing dependency snapshots are not proof that prerequisite
  implementation is missing

## 2026-06-28 - Source done can still be governance-incomplete in the target lane

- Trigger: dependency blockers no longer say `missing`, but now report
  `source-done-governance-incomplete`
- Symptom: the agent almost treats the dependency as a product bug or redesign
  requirement even though the real gap is missing closure proof in the target
  ledger
- Correct ATM route: treat this as a closure-packet or reconciliation problem;
  use the governed attestation or `tasks reconcile` path instead of redoing the
  implementation or widening the card scope
- Durable rule: planning-source `done` is not the same as target-ledger
  governably closed
