# Captain Parallel Ledger Analysis

Generated: 2026-07-18T18:58:24.511Z

This report mines `.atm/history/task-events` as a read-only ledger to measure task-level captain parallelism. It deliberately measures inter-task concurrency, not intra-task Team worker fan-out.

| Wave | Tasks | Actors | Makespan | Active window | Tasks/hour | Tasks/active hour | Overlap ratio | Avg concurrency | Max concurrency | Repair closures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| serial-baseline-rft-0020-0025 | 6 | 1 | 1.70h | 1.44h | 3.54 | 4.15 | 0.00% | 0.85 | 1 | 6 |
| parallel-wave-rft-0030-0082 | 53 | 53 | 23.39h | 19.76h | 2.27 | 2.68 | 0.00% | 0.84 | 1 | 0 |
| latest-rft-0078-0082 | 5 | 5 | 1.08h | 0.84h | 4.64 | 5.94 | 0.00% | 0.78 | 1 | 0 |
| lane-dogfood-hard-overlap-0204-0001-0002-0003-0010 | 5 | 5 | 11.67h | 11.67h | 0.43 | 0.43 | 11.23% | 1.17 | 3 | 0 |

## Interpretation

The task-event ledger does not show overlapping active claim windows for the main RFT wave. This supports the safety story, especially zero repair-closure, but it does not yet prove task-level makespan acceleration.

Serial baseline repair closures: 6; RFT parallel-era repair closures: 0.

## Comparison

- Throughput ratio, parallel wave vs serial baseline: 0.64x
- Active-time throughput ratio: 0.65x
- Active work density ratio: 0.99x
- Repair-closure delta: -6

## Lane Session Evidence

- Session event root: `.atm/history/session-events`
- Lane events: 0; lanes: 0; actors: 0; task-linked events: 0.
- Lane-session event overlap concurrency: max 0, overlap 0.00h, active window 0.00h.
- Event actions: none.
- Dogfood overlap sample `TASK-CODEX-0204` + `TASK-LANE-0001/0002/0003/0010`: max concurrency 3, overlap 1.31h.

## Observability Gaps

## Auto-Batch Pipeline

- Broker tickets: 0; wave tickets: 0; waitedMs p50/p95: n/a / n/a; batchRate: n/a; build/projection/commit signals: 0/0/0.
- Failure matrix: happy-path-wave=observability-gap, conflict=observability-gap, docs-only-runner-skip=observability-gap, worker-partial-failure=observability-gap, head-moved=observability-gap, build-retry=observability-gap, projection-retry=observability-gap, checkpoint-retry=observability-gap, lane-conflict=observability-gap, kill-switch=observability-gap, serial-fallback=observability-gap.

- Framework temp claims: 33 retained runtime lock files observed; 0 fresh, 33 stale. This is a runtime snapshot over retained lock files, not an append-only framework claim history; it must not be merged into task-event throughput.
- framework-mode temp claims: snapshot-only. Runtime lock files expose current or retained lock state, but do not provide an append-only historical claim/release window comparable to task-events.
- cross-repository planning or implementation: not-observable-from-this-ledger. Single-repo task events cannot prove work performed in external planning or implementation repositories without imported evidence.
- journaling/backlog lightweight writes: not-observable-from-this-ledger. Journal routes that do not emit task claim/close transitions are excluded from overlap and throughput calculations.

## Method

- Active window: first `claim` transition to first `close` / `toStatus: done` transition per task.
- Serial baseline: `TASK-RFT-0020` through `TASK-RFT-0025`.
- Parallel wave: `TASK-RFT-0030` through `TASK-RFT-0082`.
- Repair closure is counted separately and excluded from active window duration.
- Active-time normalized throughput uses the union of active claim windows and removes idle gaps with no active claim.
- Framework temp locks are reported as an observability snapshot only; they are not used as historical task-level overlap evidence.
