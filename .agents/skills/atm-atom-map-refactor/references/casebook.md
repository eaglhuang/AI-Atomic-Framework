# ATM Atom/Map Refactor Casebook

Keep entries short. Add only after governed closeout.

## TASK-CID-0052 - Closeout Provenance Atom

Problem: closeout trust checks were embedded in broader task command logic, making source-done and governed-done easy to confuse.

Pattern: Policy Object plus Result Contract Object.

Owner module: `packages/cli/src/commands/tasks/closeout-provenance.ts`.

Proof: focused closeout provenance test plus `validate:cli`.

Lesson: trust checks need structured gap reports, not scattered booleans.

## TASK-CID-0053 - Dependency Gate Atom

Problem: `next` and `tasks claim` both needed dependency admission semantics. Separate implementations risked allowing source-done dependencies through one surface.

Pattern: Policy Object.

Owner module: `packages/cli/src/commands/tasks/dependency-gate.ts`.

Proof: focused dependency gate test, `typecheck`, `validate:cli`, and governed closeout through `taskflow close`.

Lesson: if two command surfaces answer the same admission question, extract one shared owner module and let callers format their own response.

## Forward Case - TASK-CID-0054 Lifecycle State

Expected problem: transition rules are easy to encode as scattered command preconditions.

Recommended pattern: Policy Object.

Suggested owner module: `packages/cli/src/commands/tasks/lifecycle-state.ts`.

Proof to require: allowed transition, fail-closed transition, and required-command recovery fixture.

Lesson to validate: lifecycle policy should return stable result codes, not just throw from CLI parsing paths.

## Forward Case - TASK-CID-0057 Residue Diagnostics

Expected problem: residue buckets and ambiguous state explanations can drift between status, next, and taskflow closeback.

Recommended pattern: Strategy Map plus Result Contract Object.

Suggested owner module: `packages/cli/src/commands/tasks/residue-diagnostics.ts`.

Proof to require: bucket-to-strategy fixtures, including no-residue done/done and source-done-governance-incomplete.

Lesson to validate: each bucket should return `atm.taskResidueDiagnosis.v1`; bucket strategies may call policy atoms but must not reimplement trust checks.

## TASK-CID-0073 - Taskflow Operator Guidance Surface (delivered)

Problem: `taskflow open` dry-run buried the `--write` write-readiness signal inside `orchestrationPlan.hostPolicy.fallbackBehavior`. Operators had to dig through nested JSON to learn whether `--write` would fail closed, and the CLI/spec/docs wording inconsistently labeled `tasks new` and `tasks import` as if they were normal operator surfaces.

Pattern: Result Contract Object (`writeReadinessHint`) plus Strategy Map (3-status lane labels: `ready` / `fallback` / `incomplete`).

Owner module: `packages/cli/src/commands/taskflow.ts` (helper `buildWriteReadinessHint` retained inline at ~70 lines; the surface stayed small enough that a sibling module would have been over-engineering).

Public surface: top-level `writeReadinessHint` field on `atm.taskflowOpenResult.v1`, new schema `atm.taskflowOpenWriteReadinessHint.v1`, additive (non-breaking).

Proof: `packages/cli/src/commands/taskflow/__tests__/taskflow-dryrun.spec.ts` fallback-mode + delegated-governed assertions; `scripts/validate-cli.ts` four label-and-hint assertions; closeback through `taskflow close --write` (no raw `git commit`, no backend bypass — although an emergency `tasks import --write --force` lease was used once after the planning card scope was amended).

Lesson: if a result contract grows a useful top-level summary field, document its schema (here `atm.taskflowOpenWriteReadinessHint.v1`) in the profile spec immediately. Otherwise the next refactor will tear the field out again. Equally important: when the refactor skill suggests focused tests or snapshot fixtures as side-effects, declare them in the planning card scopePaths/deliverables **before** opening — TASK-CID-0073 paid for this lesson with a force re-import.

## Forward Case - TASK-RFT-0001 next.ts atomic-map extraction

Expected problem: `packages/cli/src/commands/next.ts` (~3,900 lines, 93 top-level functions) co-locates channel selection, claim admission, claim-intent parsing, prompt-scoped task resolution, runner-mode wrapping, playbook builders, and batch checkpoint chaining. Each concern requires a different test fixture; co-location prevents independent stubbing.

Recommended pattern: Strategy Map (channel) + Policy Object (claim admission) + Result Contract Object (`taskScopedClaimCommand`) + Facade (`next.ts` thin entry).

Suggested owner modules:
- `packages/cli/src/commands/next/channel-strategy.ts` (Strategy Map: fast/normal/batch/quickfix/task-route-ready);
- `packages/cli/src/commands/next/claim-admission.ts` (Policy Object: returns `atm.nextClaimAdmission.v1`);
- `packages/cli/src/commands/next/task-scoped-claim-command.ts` (Result Contract Object: owns the field added by TASK-CID-0073);
- `packages/cli/src/commands/next/runner-mode.ts` (small Facade).

Proof to require: focused spec per atom with at least three cases (channel-per-mode, admission allowed/blocked/closeout-only-ok, claim-command shape discriminator, runner-mode mode-per-class). Plus `scripts/validate-next-atomic-map.ts` enforcing a 1,200-line ceiling on `next.ts`.

Lesson to validate: when a Facade is over 3,000 lines, do not extract one giant "next-internals.ts"; pick the named decision concerns (channel, admission, contract) and let everything else stay inline until it has its own decision shape.

## Forward Case - TASK-RFT-0002 hook.ts split by phase

Expected problem: `packages/cli/src/commands/hook.ts` (~3,000 lines) carries pre-commit, pre-push, commit-range guard, git-hook installation, and git-index diagnostics in one file. The pre-commit attribution finding (the one TASK-CID-0073 closeout retro hit) lives next to unrelated install-hook logic.

Recommended pattern: Strategy Map (by hook phase) + Facade.

Suggested owner modules:
- `packages/cli/src/commands/hook/pre-commit.ts`;
- `packages/cli/src/commands/hook/pre-push.ts`;
- `packages/cli/src/commands/hook/commit-range-guard.ts`;
- `packages/cli/src/commands/hook/git-hooks-installer.ts`;
- `packages/cli/src/commands/hook/git-index-diagnostics.ts`.

Proof to require: focused spec per phase module asserting blocking-finding shape, repair-hint text, and exit code parity with the pre-split version. Plus `scripts/validate-hook-atomic-map.ts` enforcing a 600-line ceiling on `hook.ts`.

Lesson to validate: hook phases must not share their blocking-finding builder; each phase produces its own envelope so a pre-commit fix never accidentally weakens a pre-push gate.

## Forward Case - TASK-RFT-0003 framework-development temp-claim lifecycle

Expected problem: `packages/cli/src/commands/framework-development.ts` (~2,800 lines) interleaves temp-claim lifecycle, closure packet schema, critical-path gate, sha256 normalization, and historical-delivery provenance. The closure packet schema is consumed by `hook/pre-commit.ts` and `taskflow.ts` but cannot be imported without dragging temp-claim runtime code.

Recommended pattern: Policy Object (temp-claim) + Result Contract Object (closure packet schema) + Facade.

Suggested owner modules:
- `packages/cli/src/commands/framework-development/temp-claim.ts` (Policy);
- `packages/cli/src/commands/framework-development/closure-packet-schema.ts` (Result Contract Object, pure types);
- `packages/cli/src/commands/framework-development/critical-path-gate.ts`;
- `packages/cli/src/commands/framework-development/sha256-normalization.ts`;
- `packages/cli/src/commands/framework-development/historical-delivery-provenance.ts`.

Proof to require: temp-claim three-case spec (fresh/conflict/expired), closure-packet schema four-case spec (valid/missing-field/sha256-mismatch/round-trip), critical-path gate true/false, sha256 normalize round-trip. Plus `scripts/validate-framework-development-atomic-map.ts` enforcing a 900-line ceiling on `framework-development.ts`.

Lesson to validate: pure-type modules (no runtime code) are the cheapest extraction to do first — they unblock other refactors immediately.

## Forward Case - TASK-RFT-0004 task-ledger invariant registry

Expected problem: `scripts/validate-task-ledger-governance.ts` (~2,300 lines) inlines 13 async invariant validators. Each invariant needs its own fixture, but they share helpers, so they can't be tested in isolation today.

Recommended pattern: Strategy Map (per invariant) plus shared envelope `atm.taskLedgerInvariantResult.v1`.

Suggested owner modules:
- `scripts/lib/task-ledger-invariant-registry.ts` (Strategy Map);
- `scripts/lib/task-ledger-fixture-builder.ts`;
- `scripts/lib/task-ledger-assertions.ts`;
- `scripts/validators/task-ledger/<invariant>.ts` (13 files, one per invariant: residue-classification, taskflow-close-orchestration, planning-only-audit-boundary, closure-packet-dirty-tree-hygiene, task-import-dispatch-metadata, task-import-refresh-claim-preservation, tasks-roster-update-contract, tasks-new-rejects-root-output, taskflow-host-opener-fallback, sandbox-diagnostics-actionable, last-transition-hash, emergency-use-pre-commit-audit, ledger-readers-atomization).

Proof to require: registry spec (count, order, runnable), three positive+negative focused specs (residue-classification, taskflow-close-orchestration), inline self-test fixtures for the remaining 10. Plus `scripts/validate-task-ledger-atomic-map.ts` enforcing 200 lines on the dispatcher.

Lesson to validate: when a validator script becomes load-bearing for CI, the dispatcher itself must be small enough to read in one screen. Per-invariant modules give CI a clear failure address.

## Forward Case - TASK-RFT-0005 captain-dispatch-mailbox lane split

Expected problem: `scripts/captain-dispatch-mailbox.ts` (~2,200 lines) combines layout/ledger/CLI/stop-loss with three operational lanes (inbox, outbox, reports). The lanes have distinct stop-loss accounting but share a ledger schema.

Recommended pattern: Strategy Map (per lane) + Facade.

Suggested owner modules:
- `scripts/captain-dispatch-mailbox/layout.ts`;
- `scripts/captain-dispatch-mailbox/ledger.ts`;
- `scripts/captain-dispatch-mailbox/cli.ts`;
- `scripts/captain-dispatch-mailbox/stop-loss.ts`;
- `scripts/captain-dispatch-mailbox/frontmatter.ts`;
- `scripts/captain-dispatch-mailbox/lanes/inbox.ts`;
- `scripts/captain-dispatch-mailbox/lanes/outbox.ts`;
- `scripts/captain-dispatch-mailbox/lanes/reports.ts`.

Proof to require: spec per lane (3 cases each) + layout/ledger/stop-loss (3 cases each). Plus `scripts/validate-captain-dispatch-atomic-map.ts` enforcing 400 lines on the entry script.

Lesson to validate: dispatch tooling that runs human-in-the-loop deserves the strictest split — operators must be able to read one lane's logic without paging through 2k lines.

## Forward Case - TASK-RFT-0006 police family role split

Expected problem: `packages/core/src/police/family.ts` (~2,000 lines, 30+ exported interfaces) defines 13 police roles inline. Adding a new role today requires editing the giant file; testing one role in isolation is impossible.

Recommended pattern: Strategy Map (per role) + shared Result Contract Object (`PoliceFinding` / `PoliceFamilyReport`).

Suggested owner modules:
- `packages/core/src/police/types.ts` (pure type module);
- `packages/core/src/police/suppression-keys.ts`;
- `packages/core/src/police/roles/<role>.ts` (13 files);
- `packages/core/src/police/family.ts` (Facade running the role registry).

Proof to require: role-registry spec, suppression-keys round-trip, three focused specs (dedup, quality, polymorph) covering positive/negative/boundary. Plus `scripts/validate-police-atomic-map.ts` enforcing 500 lines on `family.ts`.

Lesson to validate: when 30+ interfaces share a file, move ALL of them to a types module first. Pure-type extraction is the smallest reversible step and unblocks every other split.

## Forward Case - TASK-RFT-0007 evidence verb split

Expected problem: `packages/cli/src/commands/evidence.ts` (~1,800 lines) groups 7 verbs (add, run, verify, diff, validators, missing, git-head-backfill) plus 3 shared concerns (validator classification, command-runs normalization, missing-report computation). After TASK-CID-0073, `evidence run` is the user-facing operator path; the other verbs should not crowd it.

Recommended pattern: Strategy Map (per verb) + Facade.

Suggested owner modules:
- `packages/cli/src/commands/evidence/verbs/<verb>.ts` (7 files);
- `packages/cli/src/commands/evidence/validator-classification.ts`;
- `packages/cli/src/commands/evidence/command-runs.ts`;
- `packages/cli/src/commands/evidence/missing-report.ts`.

Proof to require: 3-case spec per verb (7 × 3) plus 3-case specs on the shared concerns. Plus `scripts/validate-evidence-atomic-map.ts` enforcing 250 lines on `evidence.ts`.

Lesson to validate: verbs that operators run directly (`evidence run`, `evidence add`) should each own one file; verbs that other code calls programmatically (`verifyTaskEvidence`, `computeMissingValidatorReport`) should be re-exported from the Facade for backwards compat.

## Forward Case - TASK-RFT-0008 taskflow size tripwire and commit-message strategy

Expected problem: `packages/cli/src/commands/taskflow.ts` (~1,640 lines) is currently under the refactor cliff but contains hardcoded commit message strings (`chore(taskflow): close <id> target governance bundle` / `docs(taskflow): close <id> planning bundle`) that adopters with strict conventional-commits cannot customize. Without a tripwire, no one will notice when the file next crosses 2,200 lines.

Recommended pattern: small Strategy Map for commit messages plus a size tripwire validator.

Suggested owner modules:
- `packages/cli/src/commands/taskflow/commit-messages.ts` (Strategy Map);
- `scripts/validate-taskflow-size-tripwire.ts` (fails at 2,200 lines, names TASK-RFT-0008 as the gate);
- `docs/specs/taskflow-profile-v1.md` updated to document the future `delegation.policy.commitMessage.targetTemplate` / `planningTemplate` profile fields.

Proof to require: commit-messages spec covering default templates, override behavior, and format-string-injection refusal. Tripwire spec asserting current line count is under 2,200.

Lesson to validate: refactor cards do not have to do a refactor. They can also be "lock in the current behavior + add an explicit cliff warning" cards. These are the cheapest insurance policy in the system.
