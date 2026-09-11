# ATM Product CI burn-in

This report is a compact, reproducible record for `TASK-PRF-0003`. It distinguishes the versioned workflow contract from the live GitHub protected-main observation; the latter is checked by `node --strip-types scripts/validate-ci-product-lane.ts --remote`.

## Product contract

- Required check: `Product CI`.
- The `product-ci` job runs clean install, typecheck, scoped lint for the product-CI contract, the focused product contract, package-skeleton validation, an isolated `npm pack` → `npm install --ignore-scripts` → `atm --version` smoke, workspace package smoke, and a second clean-install smoke. Full-repository lint remains a visible ATM Dogfood diagnostic.
- `atm-dogfood` is a separate job with no dependency edge into `product-ci`; diagnostics remain visible without suppressing Product CI.

## Protected-main verification

- Command: `gh api repos/eaglhuang/AI-Atomic-Framework/branches/main/protection`.
- Required status: `Product CI` (or GitHub's workflow-qualified equivalent).
- Burn-in rule: the `Product CI` job in each of the ten newest `ci` workflow runs on `main` must have conclusion `success`; advisory ATM Dogfood may still be running or may report independently. At least two of those runs must use the `workflow_dispatch` `release_candidate` input, which gives the GitHub run the `release-candidate` display label.
- This checked-in document is not a substitute for the live API check and must never claim green status without it.

## Run ledger

| Source | Required evidence | Status |
| --- | --- | --- |
| Product workflow contract | `tests/cli/ci-product-lane-contract.test.ts` | versioned |
| Clean-install tarball proof | `npm run validate:package-install` | command-backed per run |
| Protected-main policy | GitHub branch-protection API | live check required |
| Ten-run burn-in | GitHub Actions workflow-runs API | live check required |

## Local clean-install evidence

`TASK-PRF-0013` adds `npm run validate:package-install`. The command packs
`packages/cli`, installs that exact tarball into a fresh temporary consumer with
`--ignore-scripts`, and invokes the installed `atm --version` bin. A local
run on 2026-09-10 produced:

| Measure | Result |
| --- | --- |
| Tarball | `ai-atomic-framework-cli-0.1.0.tgz` |
| Tarball bytes | `930475` |
| Unpacked bytes | `3357258` |
| Inventory entries | `78` |
| Tarball SHA-256 | `4c45755b8d56b21b3b8bb890466a164a11b5bf1fc3e3ee193b98fee274e149b5` |
| Public command | `atm --version` — success |
| Temporary consumer residue | removed after the run |

The validator emits a fresh JSON summary on every run; this table is a
human-readable snapshot and does not replace command-backed evidence.

## Historical remote observation (not current proof)

The table below is retained as historical evidence from the prior burn-in. It is
not a current claim of green protected-main CI. Re-run
`node --strip-types scripts/validate-ci-product-lane.ts --remote` against the
live GitHub API before making a release or product claim.

| Run | Classification | Source | Product CI |
| --- | --- | --- | --- |
| 33024583108 | release-candidate | `b8cdf3c727e6` | success |
| 33024581269 | release-candidate | `b8cdf3c727e6` | success |
| 33024579121 | standard | `b8cdf3c727e6` | success |
| 33024576906 | standard | `b8cdf3c727e6` | success |
| 33024574712 | standard | `b8cdf3c727e6` | success |
| 33024572530 | standard | `b8cdf3c727e6` | success |
| 33024570114 | standard | `b8cdf3c727e6` | success |
| 33024567885 | standard | `b8cdf3c727e6` | success |
| 33024565507 | standard | `b8cdf3c727e6` | success |
| 33024563526 | standard | `b8cdf3c727e6` | success |

## TASK-PRF-0014 current remote observation

Read-only GitHub inspection on 2026-09-10 disproves a current green burn-in
claim for the delivered local clean-install change. The newest visible `ci` run
on `main` was `34136912919` at SHA
`a85ed1203a3ddb279c9dc659d24373706bb2172e`. Its required `Product CI` job
concluded `success`; the overall workflow was red because the separate,
non-required `ATM Dogfood` lint step reported:

```text
tests/cli/write-ticket-scope-amendment.test.ts:6:1
../../packages/cli/src/commands/tasks/status-triangulation.ts import is duplicated
no-duplicate-imports
```

The run cannot count toward the ten-run burn-in because it is not a
release-candidate observation and the current ten-run window has no qualifying
pair of release-candidate runs. The local checkout now passes `npm run lint`,
but that result is not a remote run and does not repair the unpushed remote SHA.
The advisory Dogfood failure remains visible and must not be relabeled as a
Product CI failure.

The branch-protection API was also checked read-only and currently requires
the `Product CI` context with strict status checks. The remote burn-in
validator was executed against the live API and failed closed with:

```text
protected-main burn-in requires at least two release-candidate ci runs
```

This section is an explicit red/inconclusive evidence result for
`TASK-PRF-0014`, not a release claim. No push, branch-rule mutation, or npm
publication was performed.
