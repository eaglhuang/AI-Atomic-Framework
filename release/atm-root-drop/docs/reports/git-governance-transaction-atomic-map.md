# Git Governance Transaction Atomic Map

Task: `TASK-RFT-0101`

## Preservation Baseline

Commit `39b13905f` preserved 5,734 physical lines in
`packages/cli/src/commands/git-governance/implementation.ts`. Commit
`0a817b33f` preserved the initial 73-line transaction module required to load
that source. Both commits are recovery inputs with `ATM-Delivery: false`; they
are not functional delivery evidence for this task or `TASK-GIT-0028`.

The rehabilitation keeps the public Git command contract stable while
replacing the preservation carrier with a ten-line compatibility facade and
bounded implementation modules. The original 623-line staging test is now a
bounded facade with scenario support.

## Governance Invariant

A task-scoped commit may temporarily park only the exact foreign index entries
authorized by the caller. It must:

1. preserve path, mode, blob identity, and stage identity;
2. run in the order `park -> commit current bundle -> restore`;
3. restore after both successful and failed commit attempts;
4. record a durable diagnostic when restore fails; and
5. never broaden the index write set or duplicate transaction policy in a
   caller.

The implementation also preserves the established broker, lease, evidence,
line-budget, and branch-commit-window gates around that transaction.

## Primary Atom

```text
Atom: atm.task-scoped-commit-transaction
Pattern: Adapter/Port + Result Contract Object
Owner module: packages/cli/src/commands/git-governance/task-scoped-commit-transaction.ts
Callers: ordinary governed Git commit and taskflow close-bundle assembly
Public surface: TaskScopedCommitTransactionRequest, TaskScopedCommitTransactionResult,
  TaskScopedCommitTransactionPorts, executeTaskScopedCommitTransaction
Focused test: exact staged-entry restoration on success, commit failure, and restore failure
CLI regression: git-commit-task-scoped-staging and git-index-override-lease-consumption
```

`executeTaskScopedCommitTransaction` uses an explicit failure flag rather than
error truthiness, so valid JavaScript throws such as `undefined`, `null`,
`false`, or `0` still restore the index and propagate the original failure.

## Responsibility Map

| Surface | Responsibility |
| --- | --- |
| `implementation.ts` | Typed compatibility facade that re-exports the stable public surface. |
| `implementation/command-router.ts` | Operator action dispatch only. |
| `implementation/git-command-options.ts` | Canonical Git CLI option parsing. |
| `implementation/broker-hook-bypass-preflight.ts` | Broker conflict artifact and hook-bypass admission. |
| `implementation/admission-command.ts` | Admission, composer, and steward projection. |
| `implementation/push-command.ts` | Push execution and post-failure topology recovery. |
| `implementation/lease-command.ts` | Stage-override lease command. |
| `implementation/identity-check-command.ts` | Identity, check, prepare, and commit-status behavior. |
| `implementation/record-bundle-inspection.ts` | Record-only bundle ownership and staged inspection. |
| `implementation/record-commit-command.ts` | Record-commit orchestration. |
| `implementation/git-process-port.ts` | Host Git execution, sanitized environment, and attempt status I/O. |
| `implementation/git-head-evidence-transaction.ts` | Git-head evidence preparation and rollback. |
| `implementation/git-index-transaction.ts` | Exact index park/restore adapter and foreign-entry deferral. |
| `implementation/commit-bundle-resolution.ts` | Task-scoped bundle result construction. |
| `implementation/task-scope-staging.ts` | Task/framework staging inventory and scope checks. |
| `implementation/branch-commit-window.ts` | Serialized branch commit window with stale-owner recovery. |
| `implementation/commit-command.ts` | Commit preflight and ready-context construction. |
| `implementation/commit-execution.ts` | Governed commit execution, rollback, and final result. |
| `commit-bundle-filter.ts` | Pure task bundle membership and adapter evidence helpers. |
| `task-scoped-commit-transaction.ts` | Typed atomic park/commit/restore lifecycle. |

The extracted preservation adapters are compiler-checked and contain no
`@ts-nocheck`. Their pre-existing dynamic CLI payloads are isolated behind a
local `LegacyValue` boundary; this task does not claim that the whole legacy
Git command surface has acquired domain types. The transaction request,
result, entries, failure, and effect ports are the strongly typed seam.

## Dependency Direction

The compatibility facade delegates inward and owns no policy. The intended
dependency flow is:

```text
CLI facade
  -> command preflight
  -> bundle resolution
  -> index transaction adapter
  -> typed task-scoped commit transaction
```

The typed transaction module imports no CLI parser, Git process, task ledger,
or broker implementation. Host-specific effects enter only through ports.
Bundle resolution may depend on index adapters; index adapters must not import
bundle resolution. This direction prevents the transaction lifecycle from
being reconstructed by a caller.

## Scenario Contract

The focused contract covers:

- success: exact entries observe `park -> commit -> restore`, and the result
  returns the committed value plus the restored entries;
- commit failure: restore still receives the exact entries and the original
  thrown value is rethrown, including falsey JavaScript values;
- restore failure: `TaskScopedCommitTransactionError` exposes
  `ATM_GIT_INDEX_RESTORE_FAILED`, retains both commit and restore errors, and
  records task, lease, and entry identity; and
- integration: `git ls-files -s` is byte-for-byte equal before and after a
  task commit beside an authorized foreign staged entry.

## Physical Line Budget

The compatibility facade is 10 lines. Every extracted production module is at
or below 600 physical lines; the largest orchestration modules are exactly 600
lines and delegate execution and policy to owner atoms. The staging regression
facade is 478 lines, its fixture is 187 lines, its transaction scenario module
is 267 lines, and its standalone transaction-contract runner is 4 lines.
Neither the facade nor any extracted module contains `@ts-nocheck`.

## Proof Plan

The governed task validators are:

```text
node --strip-types tests/cli/git-commit-task-scoped-staging.test.ts
node --strip-types tests/cli/git-index-override-lease-consumption.test.ts
npm run typecheck
npm run validate:cli
git diff --check
node atm.mjs doctor --json
```

Additional extraction regression:

```text
node --strip-types tests/cli/git-governance-command-extraction.test.ts
node --strip-types tests/cli/git-record-commit.test.ts
```

Final command-backed results belong in ATM evidence. This report does not turn
a partial or externally blocked validator into proof.

## Out of Scope

- `TASK-GIT-0028` production wiring;
- new push recovery behavior;
- changes to task lifecycle, broker policy, hooks, schemas, baselines, or
  `.gitignore`;
- runner publication or push; and
- adjacent Git governance cleanup not required to preserve the transaction
  contract.

## Commit Split

The source, tests, atom mapping, and this report form the delivery commit.
Runner-sync output, when admitted by its separate steward lane, must remain a
separate publication commit. ATM lifecycle and closure evidence follow the
normal taskflow close playbook; preservation commits are never reused as
delivery proof.
