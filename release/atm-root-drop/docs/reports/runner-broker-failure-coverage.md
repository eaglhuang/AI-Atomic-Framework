# Runner Broker Failure-Mode Coverage — TASK-MAO-0021

> Scope: deterministic failure-mode coverage for the runner broker primitives
> introduced by TASK-MAO-0014..0017 plus the recovery analyzer (TASK-MAO-0020).
> Validator: `scripts/validate-runner-broker-failures.ts`
> Fixtures: `scripts/fixtures/runner-broker-failures/`

## 1. Coverage matrix

| Failure mode | Primitive | Fixture | Expected decision |
|---|---|---|---|
| Malformed envelope (version-publish without target) | runner-submit-pipeline | `malformed-envelope.json` | `reject-malformed` |
| Stale base (declared commit lags ref head) | runner-submit-pipeline | `stale-base.json` | `reject-stale-base` |
| Target ref currently frozen | runner-submit-pipeline | `frozen-target.json` | `freeze-await-rebase` |
| Orphaned `in-dev/HEAD` recovery | runner-bootstrap | `orphan-head-recovery.json` | `rollback-rc-to-in-dev` |

Additional canonical failure-mode assertions that do not need a fixture
(deterministic input is small) live in
`packages/core/src/broker/__tests__/runner-failure-modes.test.ts`.

## 2. Out of scope

- Network / process-level failures (broker daemon crash, SIGTERM mid-publish) are operator-runbook items, not primitive-level coverage.
- Cross-repo recovery is covered by TASK-MAO-0019 + TASK-MAO-0022.
- Lease lifecycle exhaustion regression is covered by `runner-version-lease.test.ts` (TASK-MAO-0017).

## 3. How to add a new failure mode

1. Drop a new `.json` fixture into `scripts/fixtures/runner-broker-failures/` with either a `expectedVerdict` (submit-pipeline scenario) or `expectedDecision` + optional `expectedFinding` (bootstrap-recovery scenario).
2. The validator script auto-discovers and exercises all fixtures.
3. Add an assertion to `runner-failure-modes.test.ts` for any failure mode whose inputs are smaller than a fixture.

This card delivers the validator harness and four canonical fixtures. Operator-runbook narrative for each failure mode lives in `runner-broker-recovery.md` (TASK-MAO-0020).
