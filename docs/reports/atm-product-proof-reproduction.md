# Reproducing the ATM product proofs

This runbook lets anyone outside the project rerun the evidence behind the three
ATM product proofs with public inputs only. It records the latest results so a
rerun can be compared against them. A proof counts as met only when a rerun
reproduces it; this document is not the evidence by itself.

Status as of 2026-09-20:

| Proof | Status |
|---|---|
| 1. Small, complete installable package | **Not met** — `atm create` fails in the published 0.1.1; fixed on `main`, not yet released |
| 2. Sustained delivery reliability | **Not yet met** — calendar window too short (see below) |
| 3. Net benefit over a simple baseline | **Not proven** — no paired experiment has run |

## Prerequisites

- Node.js 24 and npm, network access to `https://registry.npmjs.org`.
- For Proof 2: the GitHub CLI (`gh`) authenticated with read access to the
  repository. If `gh` is not on the `PATH` that Node sees, set `ATM_GH_BIN` to
  its full path.
- A clone of this repository for the measurement scripts. The package under
  test is always installed from the public registry, never from the clone.

## Proof 1 — installable package

Clean-install a fixed published version into an empty directory and run the
core workflow command matrix (`--version`, `doctor`, `next`, `tasks`,
`bootstrap`, `atm-chart render`, `atm-chart verify`, `create`):

```bash
node --strip-types scripts/validate-public-npm-install.ts --package @ai-atomic-framework/cli --version 0.1.1 --require-default-tag --measurement-runs 3 --output proof-0.1.1.md
```

Pass criteria in the JSON receipt: `status: "verified"`,
`validation.coreWorkflowPassed: true`, `validation.moduleResolutionFailures: 0`,
`cleanConsumer: true`, `usedWorkspaceLink: false`. Rerun with `--version 0.1.0`
for the comparison baseline; `0.1.0` fails `atm-chart render` and
`atm-chart verify` with `ATM_CHART_SCHEMA_SOURCE_MISSING` because it did not
ship the `governance/default-guards` schema source.

Measure the full installed footprint, which tarball size alone cannot show:

```bash
node --strip-types scripts/measure-npm-dependency-footprint.ts 0.1.0 0.1.1 --output footprint.json
```

Latest results (Windows, Node v24.12.0; `--version` p50 over 3 runs, other
commands single runs):

| Metric | 0.1.0 | 0.1.1 |
|---|---|---|
| Unpacked size (bytes) | 3,357,358 | 2,654,835 |
| Files | 78 | 66 |
| Installed `node_modules` (bytes) | 4,712,004 | 4,009,481 |
| Transitive packages | 6 | 6 |
| Install time | 1,840 ms | 1,642 ms |
| `atm --version` p50 | 696 ms | 170 ms |
| Core workflow (without `create`) | fails | passes |
| `atm create` | fails | fails |

On 2026-09-20 `create` was added to the matrix and 0.1.1 failed it: the npm
package shipped only `atomic-spec.schema.json`, so creating an atom failed
with `ATM_GENERATOR_TEST_FAILED` (missing test-report schema). The fix
(`180c79204`) ships the registry and test-report schemas, locates schemas the
way the installed layout places them, and adds `create` to the clean-install
smoke that runs in Product CI. It adds about 28 KB unpacked
(2,683,003 bytes). Proof 1 is not met again until a release that contains the
fix passes this matrix from the public registry.

Earlier prereleases show why each dimension is measured separately:
`0.1.0-beta.0` cannot be installed (it depends on an unpublished package), and
`0.1.0-beta.1` unpacks to 4.66 MB but installs 31 MB because it pulls
`typescript` at runtime.

Limits: sizes and timings were measured on one Windows host. Linux clean
installs, including the core workflow, run on every Product CI execution but
were not size- or time-benchmarked.

## Proof 2 — sustained delivery reliability

Policy: at least 30 calendar days and 90 eligible Product CI runs on protected
`main`, covering build, test, package and clean install. Every failure in the
window stays in the report; a failure stops blocking the verdict only when it
has a specific root-cause class and an accepted repair (a green rerun, or a
later green run named in a fix-forward disposition). See
`docs/reports/atm-product-proof-checkpoints.md` for the policy decision.

```bash
node --strip-types scripts/export-github-ci-attempts.ts --repo eaglhuang/AI-Atomic-Framework --since 2026-08-10 --dispositions docs/reports/product-ci-failure-dispositions.json --output ci-export.json
node --strip-types scripts/collect-ci-burn-in-evidence.ts --input ci-export.json --scope-config scripts/product-ci-burn-in-workflow-scope.json --output ci-receipt.json
node --strip-types scripts/measure-product-ci-burn-in.ts --input ci-receipt.json --report-only
```

The exporter keeps every rerun attempt, lists every run it drops with a reason
(`droppedRuns`), and fails if a completed run has no job data. The collector
excludes runs that are not Product CI burn-in runs; the eligible window starts
at `2026-08-26T23:44:22Z`, when the `Product CI burn-in` run name was
introduced, so the 30-day threshold cannot be met before
`2026-09-25T23:44:22Z`. Each entry in
`docs/reports/product-ci-failure-dispositions.json` names its failing job so
the root cause can be checked in the public CI logs.

Latest result: after the CLI test sweep landed, the exporter returned 779 runs since 2026-08-10 (none dropped); the collector kept 653 eligible runs and excluded 126 as `out-of-scope-workflow`. The window is 23.7 days, starting `2026-08-26T23:44:22Z`. There were 649 successful and 4 failed runs; all 4 were repaired and explained, 0 were unexplained, and there were 0 reruns. The fourth failure (run 35455553721) was the sweep's first run, which exposed a test that depended on clone depth. The current streak restarted at 1. Verdict `reject` with the single reason `insufficient-calendar-window`.

Test coverage: Product CI runs a `CLI test sweep` step
(`scripts/run-cli-test-sweep.ts`) that executes every `tests/cli/*.test.ts`
file except those in the quarantine in `scripts/cli-test-sweep.config.json`. A
test fails the sweep if it exits non-zero, times out, or modifies the worktree.
Every quarantined test records a reason and a disposition. When the sweep was
introduced (2026-09-20), 534 of 599 files ran and passed on Linux (WSL2 Ubuntu,
Node 24.21, shallow clone; 168 s wall clock). The 65 quarantined files are 54
that fail on `main` and have not been root-caused yet, 6 that pass but rewrite
tracked files, and 5 that pass on Windows but fail on Linux. Since then two
quarantined tests were root-caused with a debugger as stale fixtures and
restored (`steward-receipt-pre-commit-gate`) or fixed by the `atm create`
repair (`create`), and one (`tasks-repair-claim`) was reclassified as a stale
assertion; 63 files remain quarantined.

Known limit: runs before the sweep step was added did not execute most
`tests/cli` suites, so "covers test" holds only for runs from that commit on,
and the 63 quarantined files are still not covered.

## Proof 3 — net benefit over a simple baseline

Not proven. The paired executor exists (`TASK-PRF-0114`) and can be exercised
at no cost with the simulated driver; simulated packets verify only under the
`dry-run` stage and are rejected for every evidence stage:

```bash
node --strip-types scripts/run-atm-external-benchmark.ts --execute --plan <trial-plan.json> --driver simulated --workspace-root <dir-outside-repo> --sink <dir-outside-repo>
node --strip-types scripts/run-atm-external-benchmark.ts --verify-packet --stage dry-run --packet <sink>/<plan>/<pair>/packet.json
```

Latest dry-run result: on 2026-09-19 the simulated pipeline was run in a clean
WSL2 Ubuntu environment (Linux 6.6.87.1, Node v24.21.0) against a local
single-commit fixture repository, with `pairsPerScenario: 2`. It produced two
packets (replicate 0 ran AB, replicate 1 ran BA), gave each of the four arms
its own fresh clone and removed all four afterwards, and wrote raw evidence to a
sink outside the repository. Both packets verified under `--stage dry-run`;
the same packet verified under `--stage pilot` was rejected with
`packet stage mismatch`. Usage was 0 tokens and US$0. This shows only that the
executor pipeline runs on Linux; it says nothing about net benefit, because no
model was called and no independent role took part. A clean environment does
not replace the independent roles below.

A real experiment still needs: sealed scenario tasks from an independent
hidden-corpus custodian, an independent adjudicator, attributable provider cost
telemetry, a real provider driver, and approved token, cost and wall-clock caps.
Until a paired experiment runs, no claim of net benefit is made.
