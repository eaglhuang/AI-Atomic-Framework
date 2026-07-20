# ATM 2.0 and 2.1 Final Closure

Task: ATM-GOV-0225
Verdict: fail

Closure state: fail-closed. Do not close ATM-GOV-0225 until the unresolved validation evidence below passes.

## Pass/Fail Matrix

| Requirement | Status | Evidence | Recovery command |
| --- | --- | --- | --- |
| All upstream task cards closed with released claims | pass | 12/12 dependencies done | `node atm.mjs tasks status --task <dependency> --json` |
| Real parallel dogfood met safety counters | pass | docs/reports/atm-2-1-real-parallel-dogfood.md | `node --strip-types scripts/run-real-parallel-dogfood.ts --mode validate` |
| 420-cell paired A/B v4 met rollout metrics and safety controller | pass | docs/reports/atm-2-1-paired-ab-v4.md | `node --strip-types scripts/run-paired-ab-v4.ts --mode validate` |
| Historical residue cleanup is non-destructive and consumable | pass | docs/reports/historical-governance-residue-cleanup.md | `node --strip-types scripts/cleanup-historical-governance-residue.ts --dry-run --json` |
| Runner parity, adopter migration, and integration adapter gates are closure validators | pass | node --strip-types tests/cli/atm-2-1-final-closure.test.ts; node --strip-types scripts/validate-atm-2-1-closure.ts --mode validate; npm run validate:standard; npm run validate:runner-entrypoints; npm run validate:integration-adapter; git diff --check | `rerun the failed ATM-GOV-0225 validator through node atm.mjs evidence run` |
| Standard validation profile has no failed cells | fail | npm run validate:standard run atm-gov-0225-standard-20260720: passed 47/58, failed 11, timeout 4 | `node --strip-types scripts/run-validators.ts standard --resume atm-gov-0225-standard-20260720 --json` |

## Dependency Closure

| Task | Status | Closed at |
| --- | --- | --- |
| ATM-GOV-0215 | done | 2026-07-20T15:31:27.541Z |
| TASK-ERR-0002 | done | 2026-07-20T15:29:42.440Z |
| ATM-GOV-0216 | done | 2026-07-20T15:52:59.193Z |
| ATM-GOV-0217 | done | 2026-07-20T16:10:22.103Z |
| ATM-GOV-0218 | done | 2026-07-20T16:38:17.124Z |
| ATM-GOV-0219 | done | 2026-07-20T17:04:41.094Z |
| ATM-GOV-0220 | done | 2026-07-20T17:29:03.100Z |
| ATM-GOV-0221 | done | 2026-07-20T17:47:59.149Z |
| ATM-GOV-0222 | done | 2026-07-20T18:04:36.658Z |
| ATM-GOV-0223 | done | 2026-07-20T18:19:39.510Z |
| ATM-GOV-0224 | done | 2026-07-20T18:43:04.995Z |
| TASK-TMP-0002 | done | 2026-07-20T18:57:50.060Z |

## Evidence Digests

| Artifact | Digest |
| --- | --- |
| docs/reports/atm-2-1-real-parallel-dogfood.md | `sha256:758ed951ef12d6aeb4d1f4b7479389c5cfe7dc1a6c6abf012439c0d1dd371904` |
| docs/reports/atm-2-1-paired-ab-v4.md | `sha256:bf91067964ef38d4708f8c06cf1c8abdeba845593884575a75ab69b6615e28a1` |
| docs/reports/historical-governance-residue-cleanup.md | `sha256:01f5027f56a8a63818acabfc8e96a3a23ec00de53b2edb2adf767f37cf28038d` |

## Command Evidence

| State | Command |
| --- | --- |
| pass | `git diff --check` |
| pass | `node --strip-types tests/cli/atm-2-1-final-closure.test.ts` |
| pass | `npm run typecheck` |
| pass | `npm run validate:cli` |
| pass | `npm run validate:git-head-evidence` |
| pass | `npm run validate:integration-adapter` |
| pass | `npm run validate:runner-entrypoints` |
| unresolved | npm run validate:atm-2-1-closure exits non-zero while any matrix row is fail |
| unresolved | npm run validate:standard exits non-zero and must pass before ATM-GOV-0225 can close |

## Failed Cells

- Standard validation profile has no failed cells: node --strip-types scripts/run-validators.ts standard --resume atm-gov-0225-standard-20260720 --json

## Standard Validation Detail

Run ID: `atm-gov-0225-standard-20260720`
Counts: 47/58 passed; 11 failed total, including 4 timeout.

Failed validators:
- validate-plugin-sdk
- validate-multi-agent-confidence
- validate-cli
- validate-task-direction-governance
- validate-framework-development-governance
- validate-branch-commit-queue
- validate-taskflow-close-atomicity

Timeout validators:
- validate-task-import
- validate-task-ledger-governance
- validate-git-hooks-enforcement
- validate-bootstrap

## Recovery Backlog

- Keep ATM-GOV-0225 open; its acceptance criteria require every standard validation cell to pass.
- Route the validate:standard failures through their owning task cards instead of widening ATM-GOV-0225 scope.
- Rerun `npm run validate:standard`, then rerun `npm run validate:atm-2-1-closure` with `ATM_STANDARD_VALIDATION_PASSED=1` only after standard passes.
