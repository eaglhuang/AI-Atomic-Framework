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

## Closing from a historical batch slice

Once a task has a close-ready slice, the operator lane can reuse it:

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

## Relationship to ordinary evidence

Historical batch does not replace normal evidence capture. It fills the gap
when real delivery timing and governance timing diverged. For ordinary work,
use `evidence run` or `evidence add` during the task itself and close through
the standard path.
