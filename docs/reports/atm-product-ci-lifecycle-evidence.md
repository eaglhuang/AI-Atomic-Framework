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

The collector writes a digest-bearing receipt wrapper; the evaluator consumes its `runs` array. The committed fixture is a sanitized `CiRun[]` replay fixture for the evaluator, while the raw GitHub attempt export remains outside Git. This fixture is intentionally too short and contains failures, so it is not evidence of a 30-day green claim. A real claim still requires 90 eligible completed runs across 30 calendar days and explicit lifecycle data for every run.

## Governance boundary

This collector does not query GitHub, alter workflow policy, weaken `measure-product-ci-burn-in.ts`, or claim that current main is green. It makes the missing attempt-level evidence observable and rerunnable so an external export can be independently replayed before any burn-in claim is made.
