---
task_id: TASK-APO-0031
title: Standardize historical ledger restore without no-verify
status: planned
owner: codex-gpt-5.4-mini
priority: P1
depends_on: []
related_plan: docs/HOST_GOVERNANCE_INTEGRATION.md
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - packages/cli/src/commands/git-governance.ts
  - packages/cli/src/commands/hook.ts
  - packages/cli/src/commands/command-specs/git.spec.ts
  - scripts/validate-governance-commands.ts
  - scripts/validate-git-hooks-enforcement.ts
  - scripts/validate-task-ledger-governance.ts
  - docs/HOST_GOVERNANCE_INTEGRATION.md
  - atomic_workbench/atomization-coverage/path-to-atom-map.json
deliverables:
  - packages/cli/src/commands/git-governance.ts
  - packages/cli/src/commands/hook.ts
  - packages/cli/src/commands/command-specs/git.spec.ts
  - scripts/validate-governance-commands.ts
  - scripts/validate-git-hooks-enforcement.ts
  - scripts/validate-task-ledger-governance.ts
  - docs/HOST_GOVERNANCE_INTEGRATION.md
  - atomic_workbench/atomization-coverage/path-to-atom-map.json
validators:
  - npm run typecheck
  - npm run validate:cli
  - npm run validate:governance-commands
  - npm run validate:git-hooks-enforcement
  - npm run validate:task-ledger-governance
acceptance:
  - "`node atm.mjs git commit --actor <id> --task <closed-task> --message \"...\"` succeeds for a narrowly defined historical-ledger-restore staged shape when the packet proves an already closed task and preserved historical provenance."
  - "Pre-commit and git-governance diagnostics distinguish historical ledger restore from normal active-task delivery and stop recommending a fake `next --claim` path for already closed tasks."
  - "Non-restore ledger-only diffs remain blocked; the exception stays narrower than general `.atm/history/**` mutation."
  - "Regression coverage proves both the happy path and refusal cases in `validate:governance-commands`, `validate:git-hooks-enforcement`, and `validate:task-ledger-governance`."
  - "Public host guidance documents when this governed restore path is valid and makes clear that `--no-verify` remains an emergency fallback rather than the standard procedure."
  - "`npm run typecheck`, `npm run validate:cli`, `npm run validate:governance-commands`, `npm run validate:git-hooks-enforcement`, and `npm run validate:task-ledger-governance` all pass."
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the historical-ledger-restore commit attribution exception, validator fixtures, and docs if the flow broadens ledger-only commit permissions beyond the intended closed-history repair window.
atomizationImpact:
  ownerAtomOrMap: atm.git-governance-map
  mapUpdates:
    - atomic_workbench/atomization-coverage/path-to-atom-map.json
outOfScope:
  - Reopening or re-delivering already closed historical tasks
  - Editing .atm/runtime identity/session state to fake a new claim for old work
  - Allowing arbitrary ledger-only commits that are not provable historical restore packets
  - Rewriting original closed-task actor, session, or closure provenance fields
nonGoals:
  - Do not weaken normal governed task commit requirements for active tasks
  - Do not make --no-verify the recommended repair path
  - Do not introduce a second task store or alternate closure lifecycle
tags:
  - governance
  - git
  - task-ledger
  - historical-ledger-restore
---

# TASK-APO-0031: Standardize historical ledger restore without no-verify

## Context

Recent repair of `TASK-AAO-0063` restored a missing task ledger, evidence bundle,
closure packet, and lifecycle events correctly enough for `npm run validate:cli`
to pass again, but the final governed commit could not pass `node atm.mjs git
commit`.

The blocker was not functional correctness. It was commit attribution:

- the restored ledger belonged to an old closed `Antigravity` task session;
- the current operator identity was `codex-gpt-5.4-mini`;
- the hook path treated the staged restore as if it must have a current claim or
  a current/recent matching work session;
- the only safe way to land the repair was a controlled `git commit --no-verify`.

That outcome proves a governance gap: ATM can already validate historical
delivery and closure repair, but it does not yet expose a first-class governed
path for restoring a missing historical task ledger packet.

## Goal

Create a standard governed flow for historical ledger restore so a closed task's
missing task/evidence/event packet can be restored and committed without
requiring `--no-verify`, without faking a fresh claim, and without rewriting the
original provenance fields.

## Acceptance Evidence

- `node atm.mjs git commit --actor <id> --task <closed-task> --message "..."`
  succeeds for a narrowly defined historical-ledger-restore staged shape when
  the packet proves an already closed task and preserved historical provenance.
- Pre-commit and git-governance diagnostics distinguish historical ledger
  restore from normal active-task delivery, and they stop recommending a fake
  `next --claim` path for already closed tasks.
- Non-restore ledger-only diffs remain blocked; the exception must stay narrower
  than general `.atm/history/**` mutation.
- Regression coverage proves both the happy path and refusal cases in
  `validate:governance-commands`, `validate:git-hooks-enforcement`, and
  `validate:task-ledger-governance`.
- Public host guidance documents when this governed restore path is valid and
  makes clear that `--no-verify` remains an emergency fallback, not the standard
  procedure.
- `npm run typecheck`, `npm run validate:cli`, `npm run validate:governance-commands`,
  `npm run validate:git-hooks-enforcement`, and
  `npm run validate:task-ledger-governance` all pass.

## Implementation Notes

- Reuse the existing staged-shape classification pattern used by mirror-sync-only
  commits where possible, but add a distinct classifier for closed historical
  ledger restore packets.
- Treat the historical task's original actor/session/claim fields as provenance,
  not as a requirement to recreate or impersonate that old session.
- Keep the current commit author/trailers truthful to the present operator while
  allowing the restored packet to reference its original closed-task provenance.
- Reject staged packets that omit required restore members such as the task JSON,
  evidence JSON, closure packet, or task-events import/claim/close trail when
  the restore flow requires them.

## Rollback

Revert the implementing commit. If the implementation adds new classifier or
validator fixtures, remove those artifacts in the same revert so the repo falls
back to the current stricter behavior rather than leaving a partial exception
path behind.
