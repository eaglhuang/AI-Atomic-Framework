# Runner Broker Failure-Mode Coverage — TASK-MAO-0021

> Scope: deterministic failure-mode coverage for the runner broker primitives
> introduced by TASK-MAO-0014..0017 plus the recovery analyzer (TASK-MAO-0020).
> Validator: `scripts/validate-runner-broker-failures.ts`
> Fixtures: `scripts/fixtures/runner-broker-failures/`

## 1. Coverage matrix

`scripts/validate-runner-broker-failures.ts` now fails unless at least nine
scenario families are exercised. The current matrix covers ten families across
fixture-backed and deterministic in-process scenarios.

| Failure mode | Primitive | Evidence surface | Expected decision |
|---|---|---|---|
| Malformed envelope (version-publish without target) | runner-submit-pipeline | `malformed-envelope.json` | `reject-malformed` |
| Stale base (declared commit lags ref head) | runner-submit-pipeline | `stale-base.json` | `reject-stale-base` |
| Target ref currently frozen | runner-submit-pipeline | `frozen-target.json` | `freeze-await-rebase` |
| Orphaned `in-dev/HEAD` recovery | runner-bootstrap | `orphan-head-recovery.json` | `rollback-rc-to-in-dev` |
| Non-Broker `release/**` textual diff attempt | runner-submit-pipeline | built-in validator + unit test | `reject-malformed` |
| `in-dev-bump` aimed at a version ref | runner-submit-pipeline | built-in validator + unit test | `reject-malformed` |
| Version publish missing target ref | runner-submit-pipeline | built-in validator + unit test | `reject-malformed` |
| Patch-only ATM core change requiring steward rebuild | runner-submit-pipeline | built-in validator + unit test | `accept` with steward rebuild next action |
| Published stream still holding a stale lease | runner-bootstrap | built-in validator + unit test | `quarantine` with audit next action |
| Healthy published baseline | runner-bootstrap | built-in validator | `no-recovery-needed` |

The companion unit test
`packages/core/src/broker/__tests__/runner-failure-modes.test.ts` mirrors the
canonical small-input scenarios so primitive regressions are visible without
requiring new fixture files for every boundary.

## 2. Out of scope

- Network / process-level failures (broker daemon crash, SIGTERM mid-publish) are operator-runbook items, not primitive-level coverage.
- Cross-repo recovery is covered by TASK-MAO-0019 + TASK-MAO-0022.
- Lease lifecycle exhaustion regression is covered by `runner-version-lease.test.ts` (TASK-MAO-0017).

## 3. How to add a new failure mode

1. Drop a new `.json` fixture into `scripts/fixtures/runner-broker-failures/` with either a `expectedVerdict` (submit-pipeline scenario) or `expectedDecision` + optional `expectedFinding` (bootstrap-recovery scenario).
2. The validator script auto-discovers and exercises all fixtures.
3. Add an assertion to `runner-failure-modes.test.ts` for any failure mode whose inputs are smaller than a fixture.

This card delivers the validator harness, four canonical fixtures, and six
deterministic built-in scenario families. Operator-runbook narrative for each
failure mode lives in `runner-broker-recovery.md` (TASK-MAO-0020). The remaining
manual boundary is real process or host-loss recovery, which stays out of scope
for this local deterministic validator.
