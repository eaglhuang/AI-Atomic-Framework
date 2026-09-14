# Real protected-main CI burn-in export

This report is the delivery boundary for `TASK-PRF-0059`. It records the
provenance and replay contract for a future complete GitHub Actions export; it
does not claim that the current repository has passed the burn-in policy.

## Required external artifact

The raw provider export must be stored outside Git at:

`C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/github-attempt-export.json`

It must use schema `atm.githubCiAttemptExport.v1` and include every completed
protected-main Product CI attempt in the selected window. Each attempt needs
the immutable run id, `runAttempt`, job identity, branch, allowed event, commit
SHA, creation time, attempt start/end, Product CI conclusion, and a failure
class when it failed. Ineligible attempts must carry a non-empty exclusion
reason. No field may be synthesized from an unrelated timestamp.

The collector output must remain outside Git at:

`C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/lifecycle-receipt.json`

The report is complete only when the raw export and receipt digests are added
to the task evidence; this checked-in file intentionally contains no fabricated
digest.

## Replay commands

```text
node --strip-types scripts/collect-ci-burn-in-evidence.ts --input C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/github-attempt-export.json --output C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/lifecycle-receipt.json
node --strip-types scripts/measure-product-ci-burn-in.ts --input C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/lifecycle-receipt.json --report-only
```

The evaluator may return `invalid-input`, `insufficient-window`, or
`unexplained-failure`. Only an independently replayed `long-term-green` result
with at least 90 eligible completed runs over at least 30 calendar days can
satisfy the burn-in claim.

## Current status

The latest read-only audit found 100 runs spanning 2026-09-06 through
2026-09-14, with 36 successes, 64 failures, and no rerun attempts. This is
insufficient for the policy window. `TASK-PRF-0059` therefore remains open
until a complete external export is collected and replayed; no CI threshold,
workflow permission, npm publication, benchmark arm, or historical task record
is changed by this report.
