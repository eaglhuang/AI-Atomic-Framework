# ATM product CI lifecycle evidence

`TASK-PRF-0058` adds a provider-neutral, offline collector for GitHub run-attempt exports. It converts explicit logical-run attempts into the `CiRun[]` input consumed by `scripts/measure-product-ci-burn-in.ts`.

## Contract

Input is `atm.githubCiAttemptExport.v1`. Every attempt must identify the protected branch, an allowed Product CI event, a completed status, immutable commit SHA, attempt start/end, Product CI conclusion, and (for an excluded attempt) a non-empty exclusion reason. Failed attempts must carry an explicit failure class; missing telemetry fails closed.

The collector groups attempts by logical `runId`, orders attempts by `runAttempt`, computes `firstFailureAt`, `retryCount`, `lastAttemptAt`, `repairAcceptedAt`, and `failureClass`, then orders logical runs newest-first. The canonical receipt is `atm.ciLifecycleEvidence.v1`; `receiptDigest` is the digest of its `runs` array and is stable across JSON key ordering.

## Offline replay

```text
node --strip-types scripts/collect-ci-burn-in-evidence.ts --input external/github-attempt-export.json --output lifecycle-receipt.json
node --strip-types scripts/measure-product-ci-burn-in.ts --input tests/fixtures/product-ci-burn-in/lifecycle-attempts.json --report-only
node --strip-types tests/cli/ci-burn-in-evidence-collector.test.ts
```

The collector writes a digest-bearing receipt wrapper; the evaluator consumes
the canonical wrapper directly (and verifies its `runs` digest). The committed
fixture is a sanitized `CiRun[]` replay fixture for unit coverage, while the
raw GitHub attempt export remains outside Git. This fixture is intentionally
too short and contains failures, so it is not evidence of a 30-day green
claim. A real claim still requires 90 eligible completed runs across 30
calendar days and explicit lifecycle data for every run.

## Governance boundary

This collector does not query GitHub, alter workflow policy, weaken `measure-product-ci-burn-in.ts`, or claim that current main is green. It makes the missing attempt-level evidence observable and rerunnable so an external export can be independently replayed before any burn-in claim is made.

## Current protected-main audit snapshot

On 2026-09-14, a read-only GitHub Actions query over the latest 100 `ci.yml`
runs on `main` returned 36 successes and 64 failures. The records span only
2026-09-06T15:45:42Z through 2026-09-14T03:31:44Z, and all 100 records report
`run_attempt=1`; no retry or repair sequence is present in this window. The
latest run (`34802911175`) is attempt 1 and has Product CI and ATM Dogfood jobs
with explicit start/end timestamps, but the exported records have not yet been
normalized into `atm.githubCiAttemptExport.v1` with failure classes and
exclusion provenance.

This snapshot is diagnostic evidence only. It fails the 30-day/90-run policy
and must not be used as a long-term-green claim. The real export and lifecycle
receipt remain external to Git until a complete policy-window collection is
available.

## 2026-09-14 deep policy-window audit

The latest read-only query against workflow `ci` and protected branch `main`
returned 800 completed records spanning 2026-07-25T08:34:51Z through
2026-09-14T03:31:44Z. The slice contains 180 workflow-level successes and 620
failures, with zero records having `run_attempt > 1`. These fields are only
workflow-run observations; they are not substituted for the required Product
CI job-level lifecycle fields. In particular, no failure class, repair
acceptance timestamp, or exclusion reason is inferred from a workflow
conclusion or an unrelated job timestamp.

This is a fresh negative observation: the calendar window is now long enough
to collect the policy sample, but the available data cannot support a
`long-term-green` result. A provider export with Product CI job identity and
attempt-level provenance must still be written outside Git and replayed by
the collector before this task can close.

## External replay receipt (2026-09-14)

The external raw export now exists at
`C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/github-attempt-export.json`
and contains 800 completed protected-main attempts across 50.789502 days.
Its file digest is
`sha256:9eed187b6808c6a309dc5f77b4030d32dc292a6020f470bdb176138392959efc`.
`collect-ci-burn-in-evidence.ts` accepted it and emitted a wrapper receipt at
`C:/Users/User/atm-benchmark-sink/TASK-PRF-0059/lifecycle-receipt.json`
(`sha256:375a15042e1abdfb1a2b4647021fd01695440ea35823c3cdd5e1a11b3831848b`,
canonical receipt digest
`sha256:70ebe5078383df3f91b23c27ac25202228c410fd4518b36507c2ee1e8408e8bb`).

Replaying the wrapper's `runs` array yielded `unexplained-failure` with 800
records, 180 successes, 620 failures, zero retries, and 620 unresolved
failures. The direct-wrapper failure was the pre-0063 contract defect and is
preserved as historical evidence. No Product CI-specific green claim is made.

## TASK-PRF-0063 replay-contract correction (2026-09-14)

The evaluator now accepts the canonical `atm.ciLifecycleEvidence.v1` wrapper
emitted by the collector and verifies that `receiptDigest` matches its
`runs` array before measurement. The literal task-card command can therefore
replay `lifecycle-receipt.json` directly; no out-of-band `lifecycle-runs.json`
extraction is needed.

The replay remains explicitly non-green: `claimStatus=unexplained-failure`,
`semanticVerdict=reject`, 800 records over 50.789502 days, 180 successes, 620
failures, zero retries, and 620 unresolved failures. Report-only process exit
status is not a claim of acceptance. Missing lifecycle fields, malformed
receipt metadata, or a digest mismatch return `invalid-input` and cannot be
used to satisfy the burn-in gate.
