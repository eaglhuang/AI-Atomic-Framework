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
- The command inventory is derived at runtime from the public
  `listCommandSpecs()` authority (currently 62 commands), not from a
  hand-maintained historical list. Commands without a workflow-specific gate
  receive a deterministic `command.<name>.execution` identity so a new command
  cannot silently create an unmeasured hole.

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

## Current command-cost inventory (TASK-PRF-0107 evidence)

These are command-level observations from the current candidate run, not a
claim that every ATM path is covered. Failed or blocked commands remain in the
inventory so a fast refusal cannot be mistaken for zero cost:

| command/gate | observed wall ms | outcome | interpretation |
|---|---:|---|---|
| `validate:public-npm-install` (registry 0.1.0) | 11,161 | blocked product result | release evidence is expensive and still exposes the chart failure |
| `npm run typecheck -- --pretty false` | 9,032 | pass | second-order hotspot; optimize only after correctness and release blockers |
| `check:encoding:touched` | 1,435 | pass | low-frequency hygiene cost; do not optimize before second-level gates |
| `atm-chart-public-runtime` test | 313 | pass | focused regression cost |
| `build:packages -- --packages cli` admission | 777.589 | failed before build | missing release-surface claim; this is a gate precondition cost, not a build success |

The inventory is deliberately separate from the paired p50/p95 sections below:
single observations identify candidates, while only repeated AB/BA plus A/A
receipts can establish a product-performance change. The build-admission
failure is retained as a failure sample and does not enter a candidate PASS
denominator.

## Standard validation hotspot inventory

The latest local standard-profile telemetry is a stronger prioritization signal
than a command-count comparison: the profile took **935,419 ms** in total. Its
largest validators were `validate-bootstrap` (**146,542 ms**),
`validate-skew-matrix` (**126,909 ms**), `validate-multi-agent-confidence`
(**80,337 ms**), `validate-script-parity` (**68,598 ms**), and
`validate-examples` (**66,990 ms**). The slowest two together account for
273,451 ms, so they are the first diagnostic targets before adding more
governance checks.

The current evidence does not yet prove that any one validator can be removed:
`validate-bootstrap` builds and exercises a pinned onefile runner, while
`validate-skew-matrix` protects release compatibility. The next optimization
experiment must therefore measure setup/build versus assertions, then try one
reusable input or fixture boundary at a time. A candidate is acceptable only if
the semantic matrix stays unchanged and the paired profile p50 falls without a
more-than-10% p95 regression.

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

The reproducible command-matrix validator runs each public command's help path
once and writes a bound receipt outside Git history:

```text
node --strip-types scripts/validate-gate-telemetry-coverage.ts --mode command-matrix --receipt <external-sink>/TASK-PRF-0111-command-matrix.json
node --strip-types scripts/validate-gate-telemetry-coverage.ts --mode command-matrix --receipt <external-sink>/TASK-PRF-0111-command-matrix.json --validate-only
```

The receipt binds every positive-duration sample to the runner entrypoint,
framework version, commit SHA, workload id, task id, run id, and outcome. The
validator fails closed for a missing command, missing identity, or
`durationMs: 0`.

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

## Route-resolution hotspot follow-up (TASK-PRF-0105)

The cumulative ranking identifies `next.route-resolution` as the first
mandatory-wait seam to optimize (about 380,415 ms in the observed task chain).
For an explicit task-ID prompt, the route is already deterministic; the
candidate therefore keeps status/title/dependency metadata for unrelated task
records and fully hydrates only the addressed task. Queue and plan prompts keep
the broad scan, so multi-AI private-read parallelism and shared-write routing
semantics are unchanged.

The source-first profiler measured `read-json-tasks` at **67 ms** for the
candidate, compared with the pre-change profile's **95 ms** under the same
workload shape (directional reduction about **29%**). The focused regression
test verifies that the addressed task retains `scopePaths` while the unrelated
task does not get unnecessary scope hydration. This is not yet a formal
acceptance result: a same-runner 30-sample AB/BA run with A/A noise control is
still required, and the compact external receipt must remain outside Git
history.

The change adds no command, gate, registry, daemon, database, or second state
source. If the same-runner measurement fails to reach the 20% p50 target or
causes a p95 regression above 10%, revert the single candidate commit and keep
the failed receipt as evidence.

The first external same-runner paired measurement is now available. It uses 15
AB/BA pairs plus 8 candidate A/A noise-control runs against the current task
ledger:

- broad-hydration baseline p50 **129.982 ms**, p95 **142.099 ms**;
- targeted candidate p50 **111.276 ms**, p95 **126.644 ms**;
- p50 reduction **14.391%**, p95 change **-10.876%**;
- candidate A/A noise-control p50 **108.349 ms**.

This is a real, reversible reduction but it does **not** meet the 20% p50
acceptance target. The result is therefore marked inconclusive for the formal
gate and retained only as a directional optimization; no product-wide claim
or frozen-runner release is authorized from it. Receipt:
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0105\route-resolution-paired-receipt.json`
(`sha256:0b44b7aab8db532b95a6195a75913884db2048c671ff0c7dbf97ddb1cb791b59`).
Rerun harness:
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0105\run-route-resolution-paired.mjs`
(`sha256:f9a0dfc242b5b564aff60e7063de412815843d7b239bdad8010e511e6900ed60`).

### Queue lookup candidate prefilter rerun (2026-09-15)

The candidate now filters active queue files by the requested prompt/task
selector before reading batch and task ledgers for terminal normalization. The
unselected `tasks queue` status path keeps its normalize-all cleanup behavior;
no conflict, dependency, or multi-AI private-read rule was removed. In the
same 15-pair AB/BA harness with eight candidate A/A controls, the fresh run
reported:

- broad-hydration baseline p50 **218.971 ms**, p95 **227.720 ms**, cumulative
  **3,257.203 ms**;
- targeted candidate p50 **197.338 ms**, p95 **211.837 ms**, cumulative
  **2,928.591 ms**;
- p50 reduction **9.879%**, p95 change **-6.975%**; candidate A/A p50
  **201.552 ms**.

This confirms a reversible reduction at the queue-lookup boundary, but the
20% p50 acceptance target is still not met. Per the stop rule, the result is
inconclusive rather than a product-wide performance claim; do not expand this
card into more route heuristics. Receipt:
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0105\route-resolution-paired-receipt-20260915.json`
(`sha256:a10e388a38f576c0c596e25d791606f2970491cb69663c64badb897549780246`).

## Governance-readiness Git process follow-up (TASK-PRF-0106)

The next source-first profile exposed `build-governance-readiness` at roughly
500–550ms. Its dirty-worktree helper previously started separate `git diff` and
`git ls-files` processes. The candidate now consumes one
`git status --porcelain=v1 -z` snapshot and parses only worktree/untracked
entries; staged-only files remain owned by the existing staged-file reader.
The parser regression fixture confirms that the old and new file sets have the
same 93-path digest.

The external 15-pair AB/BA measurement plus 8 candidate A/A controls reports:

- two-process baseline p50 **264.362 ms**, p95 **308.032 ms**;
- one-process candidate p50 **120.583 ms**, p95 **167.245 ms**;
- p50 reduction **54.387%**, p95 change **-45.705%**;
- candidate A/A p50 **117.800 ms**.

This clears the provisional 20% p50 target for the selected substep while
preserving classification semantics. Receipt:
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0106\git-status-paired-receipt.json`
(`sha256:0eaf2c6b3d590f61dfe2ecd40cc1cb2f6fe3a0e7cd4fac8e2789e749b0372777`).
Rerun harness:
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0106\run-git-status-paired.mjs`
(`sha256:7307e457f0eb240f35697ecc47da8cf42bf913c53e62bb4ffe30a2e78cd6e380`).

## Public npm chart lifecycle follow-up (TASK-PRF-0107)

The clean candidate tarball now passes the complete local install contract,
including `bootstrap`, `atm-chart render`, and `atm-chart verify`; the registry
version `@ai-atomic-framework/cli@0.1.0` remains a separate blocked result and
must not be relabeled as fixed until a trusted publish and post-publish rerun.
The candidate is still a single runtime: no broad schema directory was copied;
the five chart schemas remain logical embedded assets identified by sealed
digests.

The external installed-tarball AB/BA run used 30 interleaved samples per
runner, eight candidate A/A controls, and the same bootstrap → render → verify
workload in isolated temporary adopters. All 60 baseline/candidate runs and all
eight controls passed:

- frozen baseline chart render p50 **854.582 ms**, p95 **891.755 ms**;
- installed candidate chart render p50 **134.925 ms**, p95 **146.960 ms**;
- frozen baseline chart verify p50 **847.263 ms**, p95 **887.496 ms**;
- installed candidate chart verify p50 **136.559 ms**, p95 **150.538 ms**;
- candidate tarball install cost **1,848.443 ms** (reported separately from
  command latency), unpacked **2,651,636 bytes**, **66 entries**;
- candidate A/A render p50 **135.917 ms**, verify p50 **137.955 ms**.

These are valid local-tarball packaging measurements, not registry evidence;
the baseline is a frozen onefile and the candidate is the installed local
tarball, so the functional result is stronger than a version-only smoke but
the product publication gate remains open. Candidate contract receipt:
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0107\candidate-proof.json`
(`sha256:53e257bb2d20facad8841e972db9eebe550bb8981003e2d683359d87edc7fc42`).
Paired receipt:
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0107\chart-runtime-paired-receipt.json`
(`sha256:2b669ac8987e7cbabed14e6add1eaa2a148ef46f9e00025c5df449b8ec941cc6`).
Rerun harness:
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0107\run-chart-runtime-paired.mjs`
(`sha256:fe11d375974ea07a072b09abe36eb0b30bc1978aff3aafde72cef8955b835e72`).

The public registry rerun remains **blocked**: `@ai-atomic-framework/cli@0.1.0`
has **3,357,358 bytes / 78 files**, and its clean install still returns
`ATM_CHART_SCHEMA_SOURCE_MISSING` for both chart commands. Registry receipt:
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0107\registry-proof.json`
(`sha256:e855c5be6f136ca12ef32030aabad45153487e04018bbf6e253aa965cadcee17`).
This is the exact publication blocker that trusted publishing or a correctly
scoped `NPM_TOKEN` must clear; it is not evidence against the local candidate.

The first harness revision used Windows shell invocation for Node and produced
all-failure measurements; it was discarded as harness-invalid evidence. The
final receipt uses direct Node process spawning and records zero failures. No
broker, lock, or multi-AI ownership behavior changed.

### Fresh local-tarball rerun (2026-09-15)

The same harness was rerun against the current candidate source and frozen
baseline. It contains 30 interleaved AB/BA samples and 8 candidate A/A
controls; bootstrap, chart render, and chart verify passed in every sample.

- baseline chart render: p50 **879.239 ms**, p95 **897.402 ms**;
- candidate chart render: p50 **134.895 ms**, p95 **140.679 ms**;
- baseline chart verify: p50 **882.900 ms**, p95 **909.982 ms**;
- candidate chart verify: p50 **135.782 ms**, p95 **146.837 ms**;
- candidate A/A: render p50 **134.832 ms**, verify p50 **137.761 ms**;
- candidate tarball: **2,652,423 unpacked bytes / 66 entries**, versus the
  registry baseline **3,357,358 / 78** (about **21.0% / 15.4%** lower).

The receipt is still local-tarball evidence and does not authorize publishing:
`C:\Users\User\atm-benchmark-sink\TASK-PRF-0107\chart-runtime-paired-receipt.json`
(`sha256:f80b0317bd3bacb65d5771615480bc427a44bc0d5a84043dbb876bea2c4cf026`).
The candidate tarball digest is
`sha256:48818feaa42e80f7e2b12aef371abacc63cf1da0a832ca70d4d050eda5bc9298`.
The registry proof remains blocked until a new version is published and the
same clean-install matrix passes from npm.

### Sealed package-build admission (2026-09-15)

The declared `build:packages -- --packages cli` validator reached the isolated
sealed build, then stopped at publication because 11 pre-existing foreign
generated outputs were retained. The failure is therefore a real workspace
coordination blocker, not a TypeScript or package-content failure. The runner
receipt measured **39,715 ms** total elapsed and **11,590 ms** for the dominant
`typescriptBuild` phase (single run; not an optimization claim).

- broker ticket: `runner-sync-4611ea2b:417ab04cc22cd3c3b590fe97ec01b8a1f0fb8fc9`;
- disposition: `recovery-retained`;
- retained outputs: `packages/cli/dist/**` generated files, including the npm
  runtime manifest and runtime bundle;
- receipt: `.atm/history/evidence/TASK-PRF-0107.runner-sync-receipt.json`
  (`sha256:048483452d7c784c9940770633a2dcc0a29ab0e3667ab5df0bc2b03f28f5b543`).

This is now a high-value latency target: before changing the build, collect
repeated phase timings and separate unavoidable TypeScript work from the
coordination wait. Do not overwrite the foreign generated outputs merely to
turn this validator green.

### Current mandatory-gate ranking (2026-09-15)

The existing telemetry command was rerun with runtime history included
(`eventCount=995`, coverage **8/8**, no dropped or malformed events). The
frequency-weighted ranking now gives a concrete optimization order:

| rank | mandatory gate | samples | p50 / p95 ms | cumulative wait ms |
|---:|---|---:|---:|---:|
| 1 | `next.route-resolution` | 872 | 307 / 1,518 | 427,296 |
| 2 | `doctor.readiness` | 53 | 3,601 / 4,107 | 193,711 |
| 3 | `guard.framework-mode` | 3 | 0 / 0.9 | 1 |

The mandatory-task waiting score is **313.5 ms p50 / 3,462 ms p95**. Although
`doctor` has the higher per-run latency, `next` currently dominates total user
wait because it is exercised far more often. Therefore the next optimization
experiment should target `next.route-resolution` first, while a separate
doctor experiment should address its 3.6-second median. Both experiments must
retain the same route semantics and report AB/BA plus A/A timing evidence.

Non-mandatory close readiness is also expensive (`14,456 ms p50`, `31,290 ms
p95`, 157,427 ms cumulative), but it should not be optimized ahead of the two
mandatory gates unless task-level frequency or makespan data shows it is the
actual dominant path for adopters.

Telemetry receipt: `C:\Users\User\atm-benchmark-sink\TASK-PRF-0107\telemetry-report-20260915.json`
(`sha256:d76763a652180d003c379d4907ce90772482f492cebcc69b6ebabb6dab7165c2`).

### Live-registry confirmation and closure readiness (2026-09-18)

TASK-PRF-0107's source and test deliverables (`constants.ts`, `render-verify.ts`,
`build-cli-npm-runtime.ts`, `atm-chart-public-runtime.test.ts`) were already
committed on 2026-09-14/15; this session's contribution is a fresh, independent
confirmation against the actual live published package rather than a frozen
onefile baseline, plus completion of the previously blocked `build:packages`
validator.

**Functional matrix.** `npm run validate:public-npm-install --candidate-dir
packages/cli --version 0.1.0 --measure --measurement-runs 5` compared the
current HEAD candidate against the real registry package
`@ai-atomic-framework/cli@0.1.0` (tarball sha256
`e35de3cb1778691dd691b12666d8d379de5f4ffd97081690de2c63d963f43d14`):
`candidateCoreWorkflowPassed: true`, `candidateCoreWorkflowFailures: []`,
`candidateCommandsFreeOfModuleResolutionFailure: true`,
`unpackedBytesReductionPercent: 20.93`, `entryCountReductionPercent: 15.38`,
both above the script's own 20%/15% acceptance floor. Receipt:
`C:\Users\User\atm-benchmark-sink\ATM-PRODUCT-PROOF-20260918\prf-0107\measure-baseline0.1.0-vs-candidate-head.json`
(sha256 `58947793b23a494b2ce9c11c67729e49fad9614c5b4557a13be096905a5ec77b`).
The literal card validator `npm run validate:public-npm-install` (default args,
registry latest) still reports `status: blocked`,
`requiredSuccessCommandFailures: ["atm-chart-render","atm-chart-verify"]` — this
is the expected, documented state of the still-unpublished registry package,
not a regression; publishing the fix requires a separate Owner-approved publish
window (TASK-PRF-0053/0054/0113) and is out of this card's scope.

**Interleaved AB/BA against the live registry tarball.** 30 AB/BA pairs plus
8 candidate A/A controls, alternating which arm installs first each pair, each
sample doing a fresh `npm install` of the tarball into an isolated temp
directory followed by `bootstrap` → `atm-chart render` → `atm-chart verify`:

| metric | baseline (published 0.1.0) | candidate (HEAD) |
|---|---:|---:|
| render exit code (30/30) | `2` (`ATM_CHART_SCHEMA_SOURCE_MISSING`) | `0` |
| verify exit code (30/30) | `2` | `0` |
| install p50 / p95 ms | 1,662.5 / 1,729.8 | 1,609.0 / 1,691.6 |
| render p50 / p95 ms | 862.5 / 904.4 | 182.0 / 203.1 |
| verify p50 / p95 ms | 860.5 / 882.9 | 181.5 / 208.6 |

Candidate A/A control (16 runs, noise check): install p50 1,625.0 ms, render
p50 190.0 ms, verify p50 192.0 ms — within measurement noise of the candidate
arm above, and zero install failures across all 76 runs. This reconfirms the
2026-09-15 frozen-onefile-baseline result (render/verify p50 ~850-880 ms
baseline vs ~135-141 ms candidate) using the actual live registry artifact as
the baseline instead. Render/verify timing on the baseline arm reflects a fast
fail path (`exit 2`), not a successful-but-slow chart lifecycle; the functional
result (100% fail vs 100% pass across 30 samples) is the primary evidence, not
the latency delta. Raw data: `abab-chart-lifecycle.csv`
(sha256 `d7b7e68c04d956c8fa6c0eb3f54fb699b20a1dd266f902c7190d6539256f9e93`);
harness: `run-abab-chart-lifecycle.sh`
(sha256 `cc4fddedb9e75dbf2dcb8123a7e31fb4402670ab3fa6e9e2412e830c2035ec75`);
baseline tarball sha256 `e35de3cb1778691dd691b12666d8d379de5f4ffd97081690de2c63d963f43d14`;
candidate tarball sha256 `4edf69f4d6a309f66a84590729cc21cdbc31d4cb315f0d04cd5622501e20ac62`;
both under `C:\Users\User\atm-benchmark-sink\ATM-PRODUCT-PROOF-20260918\prf-0107\`.

**Previously blocked validator now green.** The 2026-09-15 note above recorded
`build:packages -- --packages cli` stopping at publication because a prior
runner-sync reservation had no active release-surface claim. With
`TASK-PRF-0107`'s claim scope explicitly including `release/atm-onefile/atm.mjs`
and `release/atm-root-drop`, and a fresh runner-sync queue-head reservation for
the current HEAD, the same validator now completes: `cli artifact budget ok:
2650708 bytes / 64 files`, exit 0. No workspace coordination blocker remains.

No broker, lock, or multi-AI ownership behavior changed by this confirmation
pass; all activity was read-only measurement and one documentation append.
