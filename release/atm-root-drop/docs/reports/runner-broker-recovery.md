# Runner Broker Bootstrap Recovery — TASK-MAO-0020

> Status: deferred slice (Phase B/C of ATM Core Runner Broker design)
> Owner module: `packages/core/src/broker/runner-bootstrap.ts`

## 1. Purpose

When the broker / runner sync steward stack becomes inconsistent — a publish
that crashed midway, an orphaned `in-dev/HEAD` control ref, a stranded
`rc-frozen` stream without a recorded publish, or a stale lease left on a
`published` stream — operator-readable diagnostic guidance must exist to
decide between **no recovery**, **rollback-rc-to-in-dev**, **reseed-from-version**,
or **quarantine**.

This card delivers a pure analysis module that turns runner-ref-store and
version-stream state into a `RunnerBootstrapPlan`. Applying the plan is
delegated to the existing operator lane (`taskflow close`, `tasks reset` under
emergency, runner sync steward CLI).

## 2. Recovery decisions and triggers

| Decision | Trigger | Operator action |
|---|---|---|
| `no-recovery-needed` | Broker is internally consistent | None |
| `rollback-rc-to-in-dev` | `in-dev/HEAD` orphaned, or `rc-frozen` stream never published | Transition rollback-rc; republish `in-dev/HEAD` on reachable commit |
| `reseed-from-version` | No version ref in store at all | Publish a baseline version ref from latest known-good source commit |
| `quarantine` | Lease held by an agent on a `published` stream | Release stale lease; audit publishing actor; resume |

## 3. Scope boundaries

- **In scope**: pure analysis of ref store + version stream state; emits a plan and findings.
- **Out of scope**: actually mutating the ref store, the stream, or the file system. That is the runner sync steward's responsibility.
- **Out of scope**: cross-repo recovery; this card is single-repo broker state only. Cross-repo dual-binding recovery is the domain of TASK-MAO-0019 + TASK-MAO-0022 ingestion.

## 4. Failure modes covered

See `packages/core/src/broker/__tests__/runner-bootstrap.test.ts` for the
deterministic test matrix. Each finding code maps to a documented operator
runbook entry. Additional adversarial scenarios are tracked under
TASK-MAO-0021 (runner-broker failure-mode coverage).
