# Historical Batch Evidence

This document explains the operator path for reconstructing governed evidence
after a real delivery landed as one coherent commit or commit bundle.

## Why this exists

ATM normally prefers one task, one validator run, one close, one commit. That
is still the default and still the strongest governance path.

Historical batch evidence exists for the cases where:

- a steward or writer wave delivered multiple task slices in one real package;
- the commands already ran and the code already landed;
- we still need per-task proof without pretending the evidence was collected
  live one card at a time.

The feature is intentionally strict: one shared batch envelope is allowed, but
each task still gets its own coverage slice and its own close-readiness verdict.

## Core rules

1. Historical batch is a normal operator aid, not a secret emergency bypass.
2. A shared validator pass does not automatically prove every task-specific
   acceptance item.
3. Every task slice must report whether coverage is `complete`, `partial`, or
   `blocked`.
4. Close is allowed only when the task slice says `okToCloseTask: true`.
5. Atom and atom-map health claims must be present for task slices that declare
   `atomizationImpact`.

## Main command

```bash
node atm.mjs evidence historical-batch \
  --tasks TASK-A,TASK-B \
  --commits abc123,def456 \
  --actor codex-main \
  --validators typecheck,test,"git diff --check" \
  --validator-command "npm run typecheck" \
  --validator-command "npm test" \
  --validator-command "git diff --check" \
  --write \
  --json
```

This writes:

- one shared envelope under `.atm/history/evidence/historical-batches/`
- one per-task evidence slice under `.atm/history/evidence/<task>.json`

The per-task slice records:

- declared deliverables
- matched files
- missing coverage
- validator classification (`taskSpecific`, `batchWide`, `advisory`)
- atom health claims
- `okToRecordEvidence`
- `okToCloseTask`

## Diagnostic-only unmatched mode

If you need to record a mixed package where some listed tasks did not actually
match the commit set, you must be explicit:

```bash
node atm.mjs evidence historical-batch \
  --tasks TASK-A,TASK-B \
  --commits abc123 \
  --actor codex-main \
  --validator-command "npm test" \
  --allow-unmatched \
  --approved-by captain \
  --approval-reason "diagnostic backfill" \
  --write \
  --json
```

That mode is for diagnostics and auditability. It does not auto-upgrade an
incomplete slice into a closable slice.

## Finalizing partial or diagnostic slices

When a historical batch intentionally produces a partial, blocked, or
diagnostic-only task slice, do not close the task and do not leave the residue
ambiguous. Finalize the slice with an explicit disposition:

```bash
node atm.mjs evidence historical-batch-finalize \
  --task TASK-B \
  --batch hist-batch-2026-06-16T01-40-43-634Z \
  --actor codex-main \
  --disposition keep-diagnostic \
  --reason "partial slice kept for audit only" \
  --write \
  --json
```

Allowed dispositions:

- `keep-diagnostic` records that the slice is retained as audit evidence only.
- `abandon` records that the slice should not be pursued as a close source.
- `remove-evidence` removes only the task evidence records that reference that
  batch slice, while retaining the batch envelope disposition log.

`historical-batch-finalize` is fail-closed for close-ready slices. If the slice
has `okToCloseTask: true`, use `taskflow close --historical-batch` instead.
The command is a residue disposition lane, not a task lifecycle transition.

## Closing from a historical batch slice

Once a task has a close-ready slice, run pre-close before any write:

```bash
node atm.mjs taskflow pre-close \
  --task TASK-A \
  --actor codex-main \
  --historical-batch <batch-id-or-path> \
  --json
```

Then dry-run the close:

```bash
node atm.mjs taskflow close \
  --task TASK-A \
  --actor codex-main \
  --historical-batch <batch-id-or-path> \
  --dry-run \
  --json
```

or, for the backend surface:

```bash
node atm.mjs tasks close \
  --task TASK-A \
  --actor codex-main \
  --status done \
  --historical-batch <batch-id-or-path> \
  --json
```

`taskflow close` is still the normal operator lane. `tasks close` remains the
backend surface.

When using `taskflow close --write`, inspect `closeWriteTransaction` in the
JSON result. A commit-bundle failure rolls back the close transition and leaves
the task not-done instead of reporting success with a stranded done ledger.

## One envelope vs per-task close approvals

Historical batch evidence separates **validator attestation** from **lifecycle
close**:

| Step | Approvals |
|---|---|
| `evidence historical-batch --write` | One shared envelope for the delivery commit range and validator set. Requires explicit `--allow-unmatched` + human approval when tasks do not all match the commit set. |
| `taskflow close --historical-batch --write` (per task) | One governed close bundle **per task**, even when they share the batch envelope. Each close still records its own transition, closure packet, and planning mirror update. |
| Out-of-scope delivery waiver | Separate from the batch envelope. Pre-close must show the waiver lease or reason before `--write`. |

Do not treat one batch envelope as permission to skip per-task pre-close,
dry-run, or checklist verification. See `docs/ATM_NEW_USER_WORKFLOW.md`
(Closeback operator runbook) for the full sequence and banned patterns.

## Relationship to ordinary evidence

Historical batch does not replace normal evidence capture. It fills the gap
when real delivery timing and governance timing diverged. For ordinary work,
use `evidence run` or `evidence add` during the task itself and close through
the standard path.

## Relationship to scope amendments

A historical-batch close still reads the task's scope-amendment history. When a
task grows linked surfaces (docs, help snapshots, tests, or generated artifacts)
through `tasks scope add`, each amendment records its class, phase, and
`mode: normal`, and that history stays visible in the close plan. This keeps the
strict-lane discipline intact: a reviewer can separate normal audited scope
growth from a genuine maintenance exception (`tasks scope repair`,
`mode: repair`) even when the real delivery landed as one batch.
