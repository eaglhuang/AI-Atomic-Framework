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
