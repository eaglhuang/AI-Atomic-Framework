# ATM isolated pilot readiness

Status: **blocked-before-run**. This is an internal readiness record, not a benchmark result and not evidence of ATM superiority.

The pilot is intentionally not started because the required real execution inputs are absent:

- approved external repositories and immutable repository digests;
- provider/model credentials with a hard token and cost budget;
- a disposable isolated worktree or container with negative-control checks;
- an external location for raw Git, provider, timing, and adjudication evidence.

Consequently, all outcome metrics remain `null`, no synthetic provider or fixture is accepted, and the packet contains no fabricated runs or raw references. The record may be resumed only after those inputs are sealed. Once ready, execute the paired pilot and rerun:

```text
node --strip-types scripts/run-atm-external-benchmark.ts --verify-packet --stage pilot --packet docs/reports/atm-isolated-pilot.json
```

The pilot remains internal and cannot be included in the formal holdout or used for an external product claim.
