# ATM Product CI burn-in

This report is a compact, reproducible record for `TASK-PRF-0003`. It distinguishes the versioned workflow contract from the live GitHub protected-main observation; the latter is checked by `node --strip-types scripts/validate-ci-product-lane.ts --remote`.

## Product contract

- Required check: `Product CI`.
- The `product-ci` job runs clean install, typecheck, scoped lint for the product-CI contract, the focused product contract, package-skeleton validation, workspace package smoke, and a second clean-install smoke. Full-repository lint remains a visible ATM Dogfood diagnostic.
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
| Protected-main policy | GitHub branch-protection API | live check required |
| Ten-run burn-in | GitHub Actions workflow-runs API | live check required |

## Verified remote observation

The live validator passed against the GitHub API after these ten newest workflow
runs. Every `Product CI` job completed successfully; the workflow-level failures
are the independent `ATM Dogfood` job and remain visible in GitHub Actions.

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
