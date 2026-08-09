# Plan 3.x / 4.x False-green Evidence Freeze

Verdict: **remain-open**. This is an evidence-preservation snapshot, not a completion certificate.

## Observed baseline

- Target and `origin/main`: `0d50ba508a866d92fc4e26501a060ac539024140`.
- Planning repository: `4b32b63056fe5b15612e5d10b9bb644e788ac8bb`, with 60 dirty paths.
- The target has 113 dirty paths. Its source transcript digest is intentionally marked unavailable instead of pretending that a mutable console transcript is sealed evidence.
- The 23 rescue worktrees are all retained under evidence hold; their paths and HEADs are in the JSON companion report.

## Lineage and measurement

`a548eb381` is credited as a real repair for the registry hash placeholder. It does not prove four-plan completion.

The cold `validate-skew-matrix` observation took 176353 ms and exited 1. All six current CLI × Plugin SDK smoke cases failed `governance-entry-readiness`. This is a different failure class from the earlier hash placeholder and from the 120000 ms test-facade timeout margin.

Warm and loaded comparisons were deliberately not run: after a deterministic readiness failure, additional timings would not measure the timeout policy. They must be repeated only after identity/governance readiness is isolated from the validator under test.

## Newly observed first-principles failure

ATM requires an explicit actor identity before a governed claim. The identity update changes the tracked actor registry, and framework doctor then blocks `governance-entry-readiness` until that registry is committed. Consequently, the required act of establishing the worker changes the validation baseline. This must be fixed as a governed contract, not hidden by a dirty-tree exemption.

## Control-plane accounting

The freeze itself made no product-state change and no rescue cleanup. Required control-plane writes were: initial task import; explicit actor identity; scoped claim; two path-bounded planning-source seals (`261d8936`, then `0fc02176`); and two single-use audited force-import repairs that preserved the active claim. The JSON companion names every operation, its time or commit, scope, and emergency lease where applicable.

## Closure boundary

`ATM-GOV-0325` remains unclosed. The initial null planning-source seal was repaired and the active ledger record now binds to `0fc02176`. Closure still requires fresh command-backed validators plus a decision on the identity/readiness defect; no task is promoted merely because the source seal is repaired.
