# Standard Profile and Close/Commit Gate Deletion Review

## Scope

This report is the Wave 3 inventory requested by OPT-12 (ATM-BUG-2026-07-07-040 lineage). It catalogs close/commit enforcement surfaces and the `standard` validator profile, records existing downgrade precedents, and proposes downgrade candidates **without applying any downgrade changes**. Downgrade decisions require explicit human approval per item.

Method:

- Read-only review of CLI policy code, hook routing, git governance, taskflow close orchestration, and `scripts/validators.config.json`.
- Cross-check against historical evidence in `.atm/history/evidence/`, bundle manifests, task-events, and prior downgrade reports.
- Use `scripts/run-validators.ts` performance reporting (`--performance-baseline`, duration summaries) to identify cost-heavy validators that do not map to close/commit interception.

## Existing downgrade precedents

These are already accepted patterns in this repository:

| Surface | Current enforcement | Owner module | Precedent |
|---|---|---|---|
| Per-critical-commit git-head evidence in `next` readiness | `enforcement: disabled` | `packages/cli/src/commands/next.ts` | Reported as advisory only; hook/git wrapper still enforce git-head where required |
| Missing git-head on non-critical paths in pre-commit | Diagnostic metadata only | `packages/cli/src/commands/hook.ts` | Does not block commit; surfaces repair hints |
| Doctor readiness fields | `enforcement: warning` / `perCriticalCommitEnforcement: disabled` | `packages/cli/src/commands/doctor.ts` | Downgrades blocking doctor checks to warnings |
| Baseline comparison rationale | Diagnostic-only | `packages/cli/src/commands/baseline.ts` | Explicitly non-blocking |

These precedents show the safe pattern: **keep the diagnostic signal, remove or narrow the blocking surface, and add a regression test proving strict close/commit boundaries still hold.**

## Close/commit pipeline enforcement inventory

These are the runtime gates that actually intercept close or commit attempts (distinct from the broader validator profile).

### Pre-commit hook lane

| Gate code / behavior | Owner | Typical intercept | Recent evidence source |
|---|---|---|---|
| `ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION` | `packages/cli/src/commands/hook.ts` | closeout-only claim tries to mutate in-scope delivery files | `scripts/validate-task-direction-governance.ts` regression |
| `ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS` | `hook.ts` | staged files match multiple active task scopes | hook enforcement validator |
| `ATM_PRE_COMMIT_CROSS_FILE_INCONSISTENCY` | `hook.ts` | staged governance artifacts disagree across task/evidence/event files | hook enforcement validator |
| Git-head evidence staging / backfill hints | `hook.ts`, `git-governance.ts` | missing or stale git-head coverage on governed commits | `validate-git-head-evidence`, `validate-git-hooks-enforcement` |

**Recommendation:** keep all three blocking pre-commit codes. They map directly to real parallel-WIP and claim-intent failure modes (OPT-10 family). Do not downgrade.

### Governed git commit wrapper

| Gate / behavior | Owner | Typical intercept | Recent evidence source |
|---|---|---|---|
| Task-scoped commit bundle resolution | `packages/cli/src/commands/git-governance.ts` | foreign staged governance files, out-of-scope delivery, generated residue | CLI git tests, OPT-07/OPT-14 regressions |
| Branch commit queue busy/race | `git-governance.ts` | concurrent writers on same branch | `validate-branch-commit-queue` |
| Actor identity resolution | `git-governance.ts` | missing actor git identity before commit | identity-per-actor routing tests |
| Auto-generated residue cleanup vs governance artifacts | `git-governance.ts`, `framework-development/closure-packet-schema.ts` | residue misclassified as disposable (fixed for protected-override-audit in OPT-14) | `protected-override-audit-staging.test.ts` |
| Commit attempt timeout / status query | `git-governance.ts` (OPT-08) | hung pre-commit hook, lost commit attempt observability | `git-commit-timeout-and-status.test.ts` |

**Recommendation:** keep fail-closed bundle resolution and branch queue gates. Timeout/status are observability additions, not downgrade targets.

### Taskflow close lane

| Gate / behavior | Owner | Typical intercept | Recent evidence source |
|---|---|---|---|
| Closeback planning path missing/ambiguous | `taskflow/close-orchestration.ts`, `taskflow/write-readiness.ts` | dry-run looked ready but write failed on stale `source.planPath` (fixed in OPT-05) | `write-readiness.spec.ts` |
| Governed commit bundle readiness | `taskflow/commit-bundle-assembly.ts` | close bundle not stageable/commit-ready | `validate-taskflow-close-atomicity.ts` |
| Planning authority delivery invalid | `taskflow.ts` | planning_repo close without historical delivery | taskflow orchestration tests |
| Temp-index commit live-index residue | `commit-bundle-assembly.ts` (fixed in OPT-06) | phantom staged closeback diff after successful close | `commit-bundle-assembly.spec.ts` |
| Actor-scoped identity on close auto-commit | `commit-bundle-assembly.ts` (fixed in OPT-09) | author mismatch vs `git commit` wrapper | commit-bundle assembly spec |

**Recommendation:** keep closeback path and bundle readiness as blocking. OPT-05/06/09 fixes restored parity; do not downgrade these gates.

### Emergency / protected override lane

| Gate / behavior | Owner | Typical intercept | Recent evidence source |
|---|---|---|---|
| Emergency lane approval required | `packages/cli/src/commands/emergency/gate.ts` | protected flags (`--no-verify`, etc.) without lease | OPT-03 regression |
| Protected override audit persistence | `emergency/protected-override-audit.ts`, `git-governance.ts`, `commit-bundle-assembly.ts` | audit event written then deleted before query (fixed in OPT-14) | `protected-override-audit-staging.test.ts` |

**Recommendation:** keep emergency approval blocking. Audit persistence is evidence retention, not a downgrade candidate.

## Standard validator profile inventory

Source of truth: `scripts/validators.config.json` (`profiles.standard`, currently 89 named validators; one duplicate entry noted below).

Grouping for close/commit relevance:

| Family | Validators (count) | Close/commit relevance | Notes |
|---|---:|---|---|
| CLI / taskflow / git governance | 14 | **High** | Directly guards close, commit, queue, hook, taskflow atomicity |
| Docs / charter / terminology | 8 | Low for close/commit | Still valuable for framework repo hygiene |
| Schema / contract / package skeleton | 10 | Medium | Indirect; catches drift before release |
| Broker / team / AGR bench | 14 | Low for close/commit | Product-path gates; rarely intercept ordinary task close |
| Registry / seed / map / police | 12 | Low | Generator/provenance family |
| Release / version / security / trust | 11 | Medium | Mostly release-trust, not per-task close |
| Integration / language adapters | 9 | Medium | Adapter parity |
| Evidence / conversation / experience | 5 | Low | Experience-loop family |
| Test governance / facade | 2 | Medium | Meta-validation of validator runner itself |
| Misc / sentinel / bench | 4 | Low | Operational bench, adopter sentinel |

### Config hygiene finding (non-gate)

- `validate-rollout-metrics` appears **twice** in `profiles.standard.validators`. This is wasted work, not a separate gate. **Proposal:** dedupe the profile entry (safe, no enforcement change).

## Downgrade candidates (proposal only — requires human approval)

Criteria used:

1. No documented recent real intercept in close/commit path.
2. High duration cost in standard profile runs, or duplicate execution.
3. An existing precedent for diagnostic-only or profile removal.

| Candidate | Current placement | Owner entry | Intercept evidence | Proposal | Risk if downgraded |
|---|---|---|---|---|---|
| Duplicate `validate-rollout-metrics` | `standard` (twice) | `scripts/validators.config.json` | None (duplicate config) | Remove duplicate list entry | None |
| `adopter-sentinel` | `standard` | `scripts/adopter-sentinel.ts` | Telemetry for adopters, not framework close | Move to `full` only | Lose early adopter drift signal in standard runs |
| `validate-operational-bench` | `standard` | `scripts/validate-operational-bench.ts` | Bench artifact, not close interceptor | Move to `full` only | Lose bench regression in standard CI |
| `validate-agr-benchmark` / `validate-agr-conflict-benchmark` | `standard` | broker bench scripts | Benchmark gates, not ordinary task close | Move to `full` only | Broker bench regressions surface later |
| `validate-multi-agent-confidence` | `full` only today | docs/agent confidence | No close/commit intercept | Already non-standard; keep out of `standard` | N/A |
| `validate-next-warm-run-latency` | `full` (added OPT-13) | `scripts/validate-next-warm-run-latency.ts` | Performance budget, not functional gate | Keep in `full` only (slow onefile build) | N/A — this is the intended placement |

### Not proposed for downgrade

These must stay blocking or standard-profile because they directly guard close/commit integrity or have recent intercept evidence:

- `validate-git-hooks-enforcement`
- `validate-git-head-evidence`
- `validate-taskflow-close-atomicity`
- `validate-branch-commit-queue`
- `validate-task-direction-governance`
- `validate-framework-development-governance`
- `validate-cli` (includes OPT-11/14 focused regressions)
- `validate-task-ledger-governance`

## Strict boundaries that must not loosen

Any approved downgrade must preserve regression coverage for:

1. Same-commit provenance (`git-head.jsonl`, actor registry staging, failed-commit rollback — OPT-07).
2. Closure packet / closeback atomicity (`validate-taskflow-close-atomicity`, planning mirror residue — OPT-06).
3. Closeout-only claim mutation blocking (`ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION`).
4. Protected override audit durability (`protected-override-audit-staging.test.ts` — OPT-14).
5. Emergency lane lease requirements (`emergency/gate.test.ts` — OPT-03).

## Performance investigation hook

Use this command to refresh duration evidence before approving profile slimming:

```shell
node --strip-types scripts/run-validators.ts standard --performance-baseline <path-to-baseline.json> --performance-output artifacts/generated/validator-performance/latest.json --json
```

Inspect `performance.optimizationCandidates`, `slowestValidators`, and `familyHotspots` in the output JSON.

## Wave 3 engineering deliverables (completed elsewhere in this batch)

| OPT | Deliverable | Status in repo |
|---|---|---|
| OPT-11 | Resumable validator runner (`--status`, `--resume`, `--validator-timeout-ms`, orphan child cleanup) | Implemented in `scripts/run-validators.ts`; regression in `tests/cli/validator-run-resume-and-status.test.ts` |
| OPT-12 | This inventory report | This document |
| OPT-13 | Warm-run latency validator with CLI logic vs wrapper split | `scripts/validate-next-warm-run-latency.ts`; wired to `full` profile |
| OPT-14 | Protected override audit staging + residue classification fix | `git-governance.ts`, `commit-bundle-assembly.ts`, `closure-packet-schema.ts`; regression test |

## Next steps (human gate)

1. Review each downgrade candidate row above and mark approve / reject / defer.
2. For approved items, open a follow-up task card per change (do not batch silent profile edits).
3. For approved profile slimming, require: dedupe-only change first, then one validator move per commit with `validate:standard` green.
4. Re-run `node --strip-types scripts/run-validators.ts standard --performance-baseline ...` after any profile change to prove cost reduction without losing close/commit regressions.
