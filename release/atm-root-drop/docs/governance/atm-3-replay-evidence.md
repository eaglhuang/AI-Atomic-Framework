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
- `node atm.mjs broker replay status --json`
- `node atm.mjs broker replay run --json`
- `node atm.mjs broker replay dogfood --surface docs/governance/atm-3-replay-evidence.md --json`

The diagnostic is intentionally fail-closed until the source cards can really
close. It checks for two registered, not-yet-delivered dogfood task candidates
with the declared intersection, a public frozen replay CLI surface, and a
420-cell matrix whose cells contain command or workload receipts. Use
`--allow-inconclusive` only when a larger validator needs to consume the JSON
report without failing the whole run.

The `broker replay` CLI is a frozen-runner public surface for producing and
checking replay evidence. `status` reports close readiness and remains
fail-closed while real dogfood or command-backed 420-cell evidence is missing.
`run` executes the controlled frozen broker-decision replay segment. `dogfood`
requires two registered, not-yet-delivered task candidates with the declared
intersection and fails closed when they are absent.

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

Plan 3.1 dual-captain dashboard and run manifest:

- `broker replay manifest` seals a pre-run manifest before payload reveal. The
  manifest records the run id, participant cards, provider/role scenario data,
  runtime actors and process ids, canonical worktree root, base/head/build/runner
  digests, the shared physical file, logical intent digests, private output
  digests, validator policy/union/selection-input digests, the negative-control
  reveal timestamp, thresholds, time window, and stop rule.
- `broker replay dashboard` projects the same canonical evidence into JSON and a
  human summary. The digest belongs to the canonical JSON snapshot; display text
  is not a separate source of truth.
- Readiness is fail-closed. It requires at least two participants, distinct
  actors and process ids, a single canonical worktree/root/base/head/build/runner
  view, at least two distinct logical intent digests on the shared file, sealed
  validator policy/union/selection digests, a negative-control reveal timestamp,
  an unmutated validator union, the admission facade marked required, no cleanup
  or manual recovery requirement, no true conflict, and no stale fallback.
- Provider names, producer labels, task ids, actor ids, dates, and local paths
  are data only. They are allowed to appear in observations but must not control
  readiness. Tests prove that producer labels cannot override canonical evidence
  and that incomplete setup fails closed.
- Focused receipt:
  - `node --strip-types tests/cli/plan3-dual-captain-dashboard.test.ts`

Plan 3.1 dogfood surface A ticket observations:

- ATM-GOV-0237 adds a read-only ticket-observation segment for the dashboard
  view model. The segment exposes ticket generation, digest, queue position,
  `waitedMs`, and release condition from canonical inputs without mutating
  broker queues or task lifecycle state.
- The zero-wait path is accepted only as a safe-compose observation where both
  participants are selected for immediate execution. Queued fallback cells must
  carry a positive event-derived wait and a release condition.
- Focused receipt:
  - `node --strip-types tests/cli/plan3-dashboard-ticket-observations.test.ts`

Plan 3.1 dogfood surface B lifecycle observations:

- ATM-GOV-0238 adds a read-only lifecycle-observation segment for the dashboard
  view model. The segment derives claim, proposal, compose, publish, wakeup,
  validation, and close from canonical digests/events.
- The zero-wait path is eligible only when two or more complete observations
  share one compose batch. Distinct compose batches or missing close packets
  fail back to non-zero-wait eligibility instead of being hidden behind a
  path-level conflict label.
- Focused receipt:
  - `node --strip-types tests/cli/plan3-dashboard-lifecycle-observations.test.ts`

Plan 3.1 two-card dogfood orchestrator:

- ATM-GOV-0242 adds a replay dogfood orchestrator that consumes the two real
  participant artifacts (`ATM-GOV-0237`, `ATM-GOV-0238`), the canonical task
  ledgers, git head/base, and dashboard snapshot. It emits safe-compose and
  sealed fallback cells from data instead of provider/task labels.
- Safe compose records one neutral-steward canonical write with complete
  attribution and zero wait only when both participant artifacts and the
  declared shared surface are present. The fallback cell is fail-closed with
  `canonicalWriteCount: 0`, positive wait, and a revalidation release condition.
- Focused receipt:
  - `node --strip-types tests/e2e/atm-3-real-task-dogfood.test.ts`
