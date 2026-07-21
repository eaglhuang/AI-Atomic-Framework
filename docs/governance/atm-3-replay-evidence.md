# ATM 3.0 replay evidence

ATM-GOV-0234 adds the sealed replay proof surface for ATM 3.0.

- Controlled replay workers execute the frozen runner as `node atm.mjs --version` in real child processes.
- Worker receipts include runner digest, process id, start/end timestamps, exit code, and output digests.
- Telemetry derives `maxConcurrentWorkers`, `overlapWindowMs`, `parallelOverlapRatio`, `serializedAdmissionRatio`, queue-only residency, throughput, cost, and correctness counters from those receipts.
- Runtime dogfood task selection reads registered `.atm/history/tasks/*.json` records at run time and filters by declared scope intersection. The selector does not hardcode task ids.
- Fault-injection evidence trips `queue-only` on duplicate side effects or other correctness counters instead of reporting a healthy replay.

Acceptance receipts:

- `node --strip-types tests/e2e/atm-3-real-parallel-replay.test.ts`
- `node --strip-types tests/e2e/atm-3-parallel-replay-faults.test.ts`
- `node --strip-types tests/e2e/atm-3-real-task-dogfood.test.ts`
- `node --strip-types tests/performance/atm-3-paired-queue-compose.test.ts`

Final closure verdict:

- ATM-GOV-0235 adds a data-driven final verdict helper for ATM 3.0 rollout closure. Healthy evidence must reset the circuit breaker with a sealed digest; any open inherited acceptance, blocker backlog item, failed readiness probe, non-real replay, missing dogfood intersection, missing rollback drill, parity gap, unexpected breaker trip, or queue-only residency keeps ATM 3.0 open and trips `queue-only`.
- The ATM-GOV-0234 dogfood run surfaced backlog item `ATM-BUG-2026-07-21-222`; it is treated as an ATM product follow-up and not as a waiver for final closure gates.
- Final verdict receipts:
  - `node --strip-types tests/cli/atm-3-final-closure.test.ts`
  - `node --strip-types tests/cli/parallel-admission-circuit-breaker.test.ts`
