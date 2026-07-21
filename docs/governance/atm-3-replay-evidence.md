# ATM 3.0 replay evidence

ATM-GOV-0234 adds the sealed replay proof surface for ATM 3.0. The first
implementation was later found to overstate the strength of the proof, so this
document now distinguishes implemented guardrails from final closure evidence.

- Controlled replay workers execute the frozen runner in real child processes
  and must run broker commands such as `broker decision` against registered
  write-intent receipts. A process-only `--version` smoke is not sufficient.
- Worker receipts include runner digest, process id, start/end timestamps, exit
  code, output digests, and nested command receipts.
- Telemetry derives `maxConcurrentWorkers`, `overlapWindowMs`, `parallelOverlapRatio`, `serializedAdmissionRatio`, queue-only residency, throughput, cost, and correctness counters from those receipts.
- Runtime dogfood task selection reads registered `.atm/history/tasks/*.json`
  records at run time and filters by declared scope intersection. The selector
  does not hardcode task ids. Dogfood evidence now has a separate
  `atm.parallelReplayDogfoodEvidence.v1` segment so final closure can require
  two registered tasks, two actors, preserved declared intersection, canonical
  ticket state, `waitedMs`, successor wakeup, isolated proposal/compose traces,
  and sealed close-packet traces instead of accepting "selected two cards" as
  proof.
- Fault-injection evidence trips `queue-only` on duplicate side effects or other correctness counters instead of reporting a healthy replay.
- Throughput evidence no longer defaults to `1.25` when serial/parallel timing is
  absent; missing timing makes the replay inconclusive.

Acceptance receipts:

- `node --strip-types tests/e2e/atm-3-real-parallel-replay.test.ts`
- `node --strip-types tests/e2e/atm-3-parallel-replay-faults.test.ts`
- `node --strip-types tests/e2e/atm-3-real-task-dogfood.test.ts`
- `node --strip-types tests/performance/atm-3-paired-queue-compose.test.ts`

Closure diagnostic:

- `node --strip-types scripts/diagnose-plan3-evidence-closure.ts --json`

The diagnostic is intentionally fail-closed until the source cards can really
close. It checks for two registered, not-yet-delivered dogfood task candidates
with the declared intersection, a public frozen replay CLI surface, and a
420-cell matrix whose cells contain command or workload receipts. Use
`--allow-inconclusive` only when a larger validator needs to consume the JSON
report without failing the whole run.

Final closure verdict:

- ATM-GOV-0235 now includes an evidence-derived final verdict helper. The helper
  reads sealed replay evidence into safety metrics instead of accepting a caller
  supplied "healthy" boolean bundle. Evidence without broker command receipts
  remains open even when fixture timing looks healthy. Evidence without the
  dogfood lifecycle segment also remains open; a declared intersection string is
  no longer enough to close the plan.
- The formal final closure threshold is still the 420-cell matrix. Small
  focused tests prove the gate behavior; they do not by themselves close Plan
  3.0 performance acceptance.
- The ATM-GOV-0234 dogfood run surfaced backlog item
  `ATM-BUG-2026-07-21-222`. The batch checkpoint / runner-sync deadlock class
  now has focused recovery regressions and its item shard is marked fixed, but
  that fix is not a waiver for final closure gates: Plan 3.0 still needs fresh
  sealed 0234/0235 evidence before the source cards can close.
- Final verdict receipts:
  - `node --strip-types tests/cli/atm-3-final-closure.test.ts`
  - `node --strip-types tests/cli/parallel-admission-circuit-breaker.test.ts`
