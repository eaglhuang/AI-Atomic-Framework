# ATM Product CI burn-in

This report is a compact, reproducible record for `TASK-PRF-0003`. It distinguishes the versioned workflow contract from the live GitHub protected-main observation; the latter is checked by `node --strip-types scripts/validate-ci-product-lane.ts --remote`.

## Product contract

- Required check: `Product CI`.
- The `product-ci` job runs clean install, typecheck, scoped lint for the product-CI contract, the focused product contract, package-skeleton validation, workspace package smoke, and a second clean-install smoke. Full-repository lint remains a visible ATM Dogfood diagnostic.
- `atm-dogfood` is a separate job with no dependency edge into `product-ci`; diagnostics remain visible without suppressing Product CI.

## Protected-main verification

- Command: `gh api repos/eaglhuang/AI-Atomic-Framework/branches/main/protection`.
- Required status: `Product CI` (or GitHub's workflow-qualified equivalent).
- Burn-in rule: the `Product CI` job in each of the ten newest completed `ci` workflow runs on `main` must have conclusion `success`; advisory ATM Dogfood may report independently. Two of those runs must be release-candidate runs when release-candidate labeling is available.
- This checked-in document is not a substitute for the live API check and must never claim green status without it.

## Run ledger

| Source | Required evidence | Status |
| --- | --- | --- |
| Product workflow contract | `tests/cli/ci-product-lane-contract.test.ts` | versioned |
| Protected-main policy | GitHub branch-protection API | live check required |
| Ten-run burn-in | GitHub Actions workflow-runs API | live check required |
