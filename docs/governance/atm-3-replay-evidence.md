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
