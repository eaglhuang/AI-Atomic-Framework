# ATM command/gate latency score

This report is the product-proof view for ATM lightweighting. It consumes the
existing command receipts and gate telemetry; it does not create a new runtime
service or telemetry registry.

## Score contract

- Primary score: fixed-task mandatory waiting time in milliseconds.
- Per command/gate: wall duration, p50, p95, frequency, cumulative task wait,
  outcome counts, and inclusive/exclusive timing when nested spans are present.
- Nested spans are unioned so parent and child time are not double-counted.
- Multi-agent makespan and CPU time are reported separately; CPU sums are not
  presented as wall-time savings.
- Missing real samples are `unknown`, never zero. Uncovered mandatory paths
  prevent a product-performance claim.

## Ranking and acceptance

Rank by frequency-weighted cumulative task cost, then inspect p50/p95. Treat
p50 or p95 at least 1,000 ms as a hotspot and diagnose at least 5,000 ms first.
High-frequency short calls can outrank a rare slow call. Candidate acceptance
requires at least 20% lower fixed-task mandatory-wait p50 with no more than 10%
p95 regression; insufficient attribution is inconclusive.

## Reproducibility

Each run records workload, OS, cache mode, runner/commit, Node and lockfile.
AB/BA paired samples, A/A noise controls, failures, timeouts and retries stay
in the external evidence sink. Governed Git records retain only the compact
summary and digest. The first implementation reuses:

- `scripts/plan-performance-report-v4.ts`
- `packages/core/src/telemetry/observation.ts`
- `packages/cli/src/commands/telemetry.ts`
- `scripts/validate-gate-telemetry-coverage.ts`

The report is intentionally JSON/Markdown first. A GUI dashboard is deferred
until real samples show that a visual surface reduces operator time.

## Existing CLI integration

The existing telemetry report path projects the same runtime gate events into
this score without introducing a second store:

```text
node atm.dev.mjs telemetry --report --include-runtime --json
```

Read `evidence.latencyScore` for the structured score and
`evidence.latencyMarkdown` for the text report. Omitting `--include-runtime`
deliberately leaves the latency inventory unobserved; it remains `unknown`,
not zero.

## Latest paired doctor measurement (TASK-PRF-0104)

The external receipt contains 15 measured AB/BA pairs (15 baseline and 15
candidate runs) plus four A/A noise-control runs. The observed results are:

- baseline `node atm.mjs doctor --json`: p50 **15,002.931 ms**, p95
  **15,906.721 ms**;
- candidate `node atm.dev.mjs doctor --json`: p50 **4,790.618 ms**, p95
  **4,973.020 ms**;
- p50 reduction **68.07%**; p95 change **-68.74%**; all 34 measured rows
  retain exit code `0`;
- AB/BA ordering is 8/7 pairs and A/A p50 is **4,986.374 ms**.

Receipt: `C:\Users\User\atm-benchmark-sink\TASK-PRF-0104\doctor-paired-receipt-v2.json`
(`sha256:30a25242a9fdc8f4263e1cff6cbf9a0dcf599aaa94f22642c3b1ee1f44ff7782`).
Rerun harness: `C:\Users\User\atm-benchmark-sink\TASK-PRF-0104\run-doctor-paired.ps1`
(`sha256:a25873368ab08ce58861c709a475a277df2fb3c00ce1df82bf830a807fd61a40`).

This is strong directional evidence, not the final product claim: baseline
uses the existing frozen runner while candidate uses source-first, because the
frozen runner is still stale. A same-runner release comparison and the full
multi-gate 30-run matrix remain required before declaring the optimization
formally proven.
