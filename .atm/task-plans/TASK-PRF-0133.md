---
doc_id: doc_TASK-PRF-0133
task_id: TASK-PRF-0133
title: 'Isolate offline checks from the live real-model preflight run (#354; #311)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0132
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0133.*
- .atm/history/task-events/TASK-PRF-0133/**
- .atm/history/tasks/TASK-PRF-0133.json
- .atm/task-plans/TASK-PRF-0133.md
- research/paper-v2/prereg-v3-smoke/kit/preflight.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test-preflight-real-mode-isolation.sh
validators:
- bash research/paper-v2/prereg-v3-smoke/kit/preflight.sh
- bash research/paper-v2/prereg-v3-smoke/kit/test/test-preflight-real-mode-isolation.sh
deliverables:
- research/paper-v2/prereg-v3-smoke/kit/preflight.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test-preflight-real-mode-isolation.sh
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the preflight.sh isolation block and the new regression test/check.
nonGoals:
- Do not weaken any assertion, skip any preflight check, or change sandbox/security settings.
- 'Do not run the formal #311 experiment or real model probes (the regression test uses an empty CODEX_HOME).'
- Do not touch sealed archives v1-v9, tag, publish npm, or use paid APIs.
completed_at: "2026-10-19T09:22:30.126Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-19T09:22:30.126Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-19T09-22-30-126Z-close-21a5f8fefd22"
lastTransitionAt: "2026-10-19T09:22:30.126Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "6e8c939d3d04e74f444a0609f70c1573144e02bc"
---

# TASK-PRF-0133 — real-model preflight isolation

## Authority and scope

The user approved this fix on 2026-10-19, with evidence, commit and close run on the Grok Bot box. It unblocks the #311 v10 relaunch.

Related: [#354](https://github.com/eaglhuang/AI-Atomic-Framework/issues/354), [#311](https://github.com/eaglhuang/AI-Atomic-Framework/issues/311), [PR #347](https://github.com/eaglhuang/AI-Atomic-Framework/pull/347).

## Problem

With `PREFLIGHT_REAL_MODEL=1`, `preflight.sh` exports `PREFLIGHT_REAL_MODEL`, `PREREG_PREFLIGHT_RUN_DIR` and the live log root to every offline check:

- `test-seal-secrets.sh` seals the live `preflight.log` (it contains `== seal-secrets`) and fails its `secret` grep.
- `test-preflight-fail-fast.sh` runs a nested preflight that appends to the live log and flushes `FAIL should-fail` to stdout instead of stderr.

As a result, the v10 launch stopped at check 5 before any model call.

## Acceptance

- Offline `bash kit/preflight.sh` exits 0 (`preflight ok`).
- `bash kit/test/test-preflight-real-mode-isolation.sh` exits 0. It runs preflight with `PREFLIGHT_REAL_MODEL=1` and an empty `CODEX_HOME`, and asserts:
  - every offline check passes;
  - the only `FAIL` is `real-model`, at the login/PATH gate;
  - the live run dir holds only `preflight.log` and `retry-policy.json`;
  - no probe started.
- The same test fails on the unpatched `preflight.sh` (first failure `seal-secrets`).
- `preflight.sh` runs the regression as check `real-mode-isolation`, so CI "Smoke kit preflight" covers it. The nested run skips that check through `PREREG_REAL_MODE_ISOLATION_TEST`, so it cannot recurse. A separate workflow step was not used, because the push token lacks `workflow` scope.
