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

## 2026-09-14 policy-window audit (negative observation)

A fresh read-only GitHub Actions query of workflow `ci` on protected `main`
returned 800 completed workflow records covering 2026-07-25 through
2026-09-14 (50.8 calendar days). The slice contained 180 overall successes
and 620 failures; all 800 records reported `run_attempt=1`. This establishes
that the repository now has enough calendar history to attempt a 30-day
export, but it does not establish a green Product CI lifecycle. The query did
not write a raw export to Git and did not infer Product CI conclusions or
failure classes from workflow-level conclusions.

The required external artifact and lifecycle receipt are still absent:
`C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/github-attempt-export.json`
and `C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/lifecycle-receipt.json`.
Until a provider-level export includes Product CI job identity, attempt
timestamps, explicit failure classes, and exclusion provenance, `TASK-PRF-0059`
remains open and no long-term-green claim is permitted.

## External export replay (2026-09-14)

An authenticated, read-only GitHub API collection produced 800 completed
protected-main attempts spanning 50.789502 calendar days. The raw export is
outside Git at
`C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/github-attempt-export.json`
with file SHA-256
`sha256:9eed187b6808c6a309dc5f77b4030d32dc292a6020f470bdb176138392959efc`.
The collector replay passed and wrote
`C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/lifecycle-receipt.json`
with file SHA-256
`sha256:375a15042e1abdfb1a2b4647021fd01695440ea35823c3cdd5e1a11b3831848b`;
its canonical source digest is
`sha256:60d67c230ccf496ffddb4398d47b4e084764dfe3f4bfbb66d40b87cf25bac056`
and receipt digest is
`sha256:70ebe5078383df3f91b23c27ac25202228c410fd4518b36507c2ee1e8408e8bb`.

The collector output is a wrapper whose `runs` array was replayed separately
from `lifecycle-runs.json` (file SHA-256
`sha256:fe3faa0f0d71e3f80840d929311d31c1e13b0dd27da865a07f104ff1392c2de4`).
That evaluator result is `unexplained-failure`: 800 records, 50.789502 days,
180 successes, 620 failures, zero retries, and 620 unresolved failures. The
Before TASK-PRF-0063, the card's literal command that fed
`lifecycle-receipt.json` directly to the evaluator returned
`invalid-input: history-empty`, revealing a collector/evaluator shape mismatch.
That historical result is preserved; the follow-up below records the fix.

This is complete negative evidence, not a green claim. The 30-day and 90-run
quantity gates are met, but the no-failure and lifecycle contract gates are
not. `TASK-PRF-0059` remains open pending a Product CI-specific repair window
and a contract fix for wrapper replay.

## TASK-PRF-0063 contract replay (2026-09-14)

The lifecycle receipt contract is now replayable without manually selecting
`runs`. `measure-product-ci-burn-in.ts` accepts the collector's
`atm.ciLifecycleEvidence.v1` wrapper, verifies its `receiptDigest`, and carries
the source and receipt digests into the report. The same retained 0059 receipt
therefore replays directly with the card's literal command.

The direct wrapper replay remains a negative observation: `claimStatus` is
`unexplained-failure`, `semanticVerdict` is `reject`, and the observed counts
remain 800 records, 50.789502 days, 180 successes, 620 failures, zero retries,
and 620 unresolved failures. `--report-only` still exits zero so negative
evidence can be archived, but the explicit semantic verdict prevents that
exit code from being interpreted as a green burn-in claim. A receipt with a
tampered `runs` array or missing lifecycle data is rejected as
`invalid-input`.

## TASK-PRF-0064 scoped replay (2026-09-14)

The product burn-in boundary is now explicit and digest-bound by
`scripts/product-ci-burn-in-workflow-scope.json`. It includes the standard and
release-candidate Product CI workflows, retains release-candidate runs, and
excludes every other workflow. Missing or mismatched workflow identity is
excluded with a machine-readable reason; an explicit source exclusion is
preserved. For retained runs, `productJobConclusion` drives burn-in while
`workflowConclusion` remains provenance.

Replay commands:

```text
node --strip-types scripts/collect-ci-burn-in-evidence.ts --input C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/github-attempt-export.json --scope-config scripts/product-ci-burn-in-workflow-scope.json --output C:/Users/User/atm-benchmark-sink/TASK-PRF-0064/scoped-lifecycle-receipt.json
node --strip-types scripts/measure-product-ci-burn-in.ts --input C:/Users/User/atm-benchmark-sink/TASK-PRF-0064/scoped-lifecycle-receipt.json --report-only
```

The policy digest is
`sha256:39a058e23bfe864620ca8b37f7c3d60e3195835d315d8585efae955c6dd11236`.
The scoped receipt has source digest
`sha256:60d67c230ccf496ffddb4398d47b4e084764dfe3f4bfbb66d40b87cf25bac056`,
receipt digest
`sha256:e583cb70d7e306e69a875767201c9f18af555e22032ba5739a2cf580a7a9cc58`,
630 retained runs, and 170 excluded `ci` workflow runs. The evaluator reports
627 product-job successes, 3 product-job failures, 18.157894 calendar days,
and `semanticVerdict: reject` with reasons
`insufficient-calendar-window` and `unexplained-failure-present`.

This is a corrected, replayable negative observation. It does not alter the
0059 export and does not authorize CI permission changes or npm publication.

## TASK-PRF-0066 Product CI step coverage (post-change)

The Product CI job now executes the repository build and full test suite in the
same required job as clean install, typecheck, lint, package smoke, workspace
packing, and clean-install validation.  The step policy is recorded in
`scripts/product-ci-burn-in-workflow-scope.json` and is digest-bound.

The external attempt export must include Product CI job steps with immutable
step names, execution status, and conclusions.  The collector excludes a run
when a required step is missing, duplicated, or not completed successfully;
the evaluator therefore cannot count a workflow-level success without complete
Product CI step provenance.  The unchanged TASK-PRF-0059 export remains a
negative replay until a new post-change provider export is collected.

## TASK-PRF-0121 CI build validation without publication authority

Product CI invokes `npm run build -- --validation-only`. This mode resolves the
sealed source SHA, builds in a detached temporary worktree, records the output
inventory and digest, and verifies that canonical release surfaces are unchanged.
It does not acquire a release-surface claim or publish bytes. The normal
publication path remains claim-gated and is still exercised only by the release
workflow. A successful validation-only build is therefore build reproducibility
evidence, not release-publication evidence.
