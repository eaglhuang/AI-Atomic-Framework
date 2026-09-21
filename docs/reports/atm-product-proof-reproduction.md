# Reproducing the ATM product proofs

This runbook lets anyone outside the project rerun the evidence behind the three
ATM product proofs with public inputs only. It records the latest results so a
rerun can be compared against them. A proof counts as met only when a rerun
reproduces it; this document is not the evidence by itself.

Status as of 2026-09-22:

| Proof | Status |
|---|---|
| 1. Small, complete installable package | **Met** for `@ai-atomic-framework/cli@0.1.2`, with one unproven Windows caveat below |
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
node --strip-types scripts/validate-public-npm-install.ts --package @ai-atomic-framework/cli --version 0.1.2 --require-default-tag --measurement-runs 3 --output proof-0.1.2.md
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

| Metric | 0.1.0 | 0.1.1 | 0.1.2 |
|---|---|---|---|
| Compressed size (bytes) | 930,492 | 740,065 | 743,606 |
| Unpacked size (bytes) | 3,357,358 | 2,654,835 | 2,683,003 |
| Files | 78 | 66 | 69 |
| Installed `node_modules` (bytes) | 4,712,004 | 4,009,481 | 4,037,649 |
| Transitive packages | 6 | 6 | 6 |
| Install time | 1,840 ms | 1,642 ms | 1,213 ms |
| `atm --version` p50 | 696 ms | 170 ms | 159 ms |
| Core workflow (without `create`) | fails | passes | passes |
| `atm create` | fails | fails | passes |

On 2026-09-20 `create` was added to the matrix and 0.1.1 failed it: the npm
package shipped only `atomic-spec.schema.json`, so creating an atom failed
with `ATM_GENERATOR_TEST_FAILED` (missing test-report schema). The fix
(`180c79204`) ships the registry and test-report schemas, locates schemas the
way the installed layout places them, and adds `create` to the clean-install
smoke that runs in Product CI. It adds about 28 KB unpacked
(2,683,003 bytes, +1.1%). 0.1.2 was published with the fix and passes the full
matrix from the public registry, including `create`
(`coreWorkflowPassed: true`), so Proof 1 is met again for 0.1.2.

Compressed size is the byte length of the published tarball as the registry
serves it, fetched directly from `dist.tarball` rather than from a local pack,
so a rerun measures the same artifact a user downloads:

```bash
curl -sL -o cli.tgz "$(npm view @ai-atomic-framework/cli@0.1.2 dist.tarball)" && wc -c < cli.tgz
```

### Unproven Windows caveat

Proof 1 asks for an install that completes the core workflow in a clean
environment, and on Windows an install can fail on path length alone. The
deepest published file installs to a 165-character suffix under the project
root, so a project directory longer than 94 characters produces a path past the
260-character limit that applies unless long path support is enabled, which is
off by default.

This is measured but **not proven to fail**: the install succeeded on the
machine that measured it, because that machine has long path support enabled in
both the registry and git, so it is not a stock Windows host. Confirming or
dismissing it needs a host with that support off. Tracked as
`ATM-BUG-2026-09-21-001`. A build-time ratchet now caps the installed path
length at the measured 165 characters so it cannot grow unobserved.

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
Every quarantined test records a reason, a disposition and its root cause.

The sweep was introduced on 2026-09-20 with 534 of 599 files running and 65
quarantined, of which 54 had not been root-caused. As of the same day 581 of
600 files run and pass on Linux, and the 19 that remain are quarantined for a
named reason, none of them unexplained:

| Reason | Files | What it means |
|---|---|---|
| `stale-assertion` | 9 | Asserts governance data that has legitimately moved, or a report that is stale against its own sources |
| `environment-dependent` | 7 | Needs the sibling planning repository, full git history, or a Windows host |
| `writes-tracked-files` | 3 | Regenerates tracked artifacts, so it needs an output-root option first |

Four of these need an owner decision rather than an edit: two governance
reports are stale against their sources with no generator in the repository,
one review binds its freshness to the commit it was generated at and so
invalidates itself on the next commit, and `taskflow open` resolves its output
root from the profile path rather than `--cwd`.

Known limit: runs before the sweep step was added did not execute most
`tests/cli` suites, so "covers test" holds only for runs from that commit on,
and the 19 quarantined files are still not covered.

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

### The pre-registration is missing its decision rule

`scripts/fixtures/atm-external-benchmark/manifest.json` seals how the experiment
is *measured*: the two arms, four mutually distinct roles, six required
controls, AB/BA counterbalancing, environment pinning, and a definition for each
of the eight metrics. `validate-external-benchmark-protocol.ts` binds all of it
under a preregistration digest.

It does not seal how the experiment is *decided*. There is no success threshold,
no stopping condition, and no analysis method in the manifest, and Proof 3 asks
for all three in advance. The reason they have to be fixed before any data
exists is that afterwards there is always a defensible-looking reading that
favours whoever picks it, and the party who would be picking here is the party
whose product is on trial.

These are owner decisions and this project deliberately does not fill them in.
What has to be chosen and sealed, per metric, before the first paired run:

- the direction and size of difference that counts as a benefit, not merely a
  measured difference;
- how paired replicates are aggregated, and what is reported when a metric is
  unavailable, which the manifest already allows for tokens and billed cost;
- the stopping condition, including the budget and wall-clock cap at which the
  run halts, and whether a halted run is reported or discarded;
- what result would count as ATM failing to show net benefit, stated as plainly
  as the success case.

Until that rule is sealed and folded into the preregistration digest, a paired
run can produce numbers but cannot settle the question. Tracked as
`ATM-BUG-2026-09-22-001`.
