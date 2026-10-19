---
doc_id: doc_TASK-PRF-0131
task_id: TASK-PRF-0131
title: 'Fix stale arm A no-commit matcher in prereg smoke kit test (PR #347; #345)'
status: done
owner: cursor-captain
priority: P1
depends_on:
- TASK-PRF-0130
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0131.*
- .atm/history/task-events/TASK-PRF-0131/**
- .atm/history/tasks/TASK-PRF-0131.json
- .atm/task-plans/TASK-PRF-0131.md
- research/paper-v2/prereg-v3-smoke/kit/test/test-arm-a-git-writable.sh
validators:
- bash research/paper-v2/prereg-v3-smoke/kit/test/test-arm-a-git-writable.sh
deliverables:
- research/paper-v2/prereg-v3-smoke/kit/test/test-arm-a-git-writable.sh
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert only the one-line test change and this task closeout.
nonGoals:
- Do not weaken any assertion, skip readonly-steward, or change sandbox/security settings.
- 'Do not run the formal #311 experiment or real model probes.'
- Do not merge, tag, publish npm, access credentials or use paid APIs.
completed_at: "2026-10-18T13:59:31.390Z"
completed_by_agent: "cursor-captain"
closedAt: "2026-10-18T13:59:31.390Z"
closedByActor: "cursor-captain"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-18T13-59-31-390Z-close-af310f69920e"
lastTransitionAt: "2026-10-18T13:59:31.390Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "2f729f13ddbc5e35c583085c5d50f0db8fd6e041"
---

# TASK-PRF-0131 — arm A no-commit matcher

## Authority and scope

Source card for a one-line follow-up fix on PR #347 (branch `fix/345-prereg-preflight`), imported through the official tasks import command. The user approved that this fix's evidence, commit and close run on the Grok Bot box, because the Codex environment cannot run the validator (no passwordless sudo; `ensure_other_can_reach` needs `sudo chmod`).

Related: [#345](https://github.com/eaglhuang/AI-Atomic-Framework/issues/345), [PR #347](https://github.com/eaglhuang/AI-Atomic-Framework/pull/347).

## Problem

TASK-PRF-0130 replaced the arm A failure message `arm A git commit did not move HEAD` in `test/test-real-model.sh` with the structured reason `a-no-commit`. `test/test-arm-a-git-writable.sh:18` still greps the removed string, so CI "Smoke kit preflight" fails.

## Acceptance

- Line 18 greps `reason = "a-no-commit"` in `test/test-real-model.sh`; no other line changes.
- `bash research/paper-v2/prereg-v3-smoke/kit/test/test-arm-a-git-writable.sh` exits 0 as command-backed evidence.
- The full `kit/preflight.sh` exits 0 on the delivery HEAD, including readonly-steward, without lowering assertions.
