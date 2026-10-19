---
doc_id: doc_TASK-PRF-0134
task_id: TASK-PRF-0134
title: 'Real-model probe: launcher-side git on steward-owned Arm B repo (#356; #311)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0133
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0134.*
- .atm/history/task-events/TASK-PRF-0134/**
- .atm/history/tasks/TASK-PRF-0134.json
- .atm/task-plans/TASK-PRF-0134.md
- research/paper-v2/prereg-v3-smoke/kit/**
validators:
- bash research/paper-v2/prereg-v3-smoke/kit/preflight.sh
- bash research/paper-v2/prereg-v3-smoke/kit/test/test-probe-cross-owner-git.sh
deliverables:
- research/paper-v2/prereg-v3-smoke/kit/test/test-real-model.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test-probe-cross-owner-git.sh
- research/paper-v2/prereg-v3-smoke/kit/preflight.sh
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert probe_git / inspect_probe_attempt safe.directory scoping and the cross-owner-git check.
nonGoals:
- Do not weaken any assertion, skip any preflight check, or change sandbox/security settings.
- Do not write global git config (safe.directory is scoped per command to the probe repo).
- 'Do not run the formal #311 experiment or real model calls (rehearsal uses a stub codex executable).'
- Do not touch sealed archives v1-v9, tag, publish npm, or use paid APIs.
completed_at: "2026-10-19T10:32:28.456Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-19T10:32:28.456Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-19T10-32-28-456Z-close-5103f8c2d567"
lastTransitionAt: "2026-10-19T10:32:28.456Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "135cebb4b77106af5569049f9b951b919ff1a11e"
---

# TASK-PRF-0134 — cross-owner git in the real-model probe

## Authority and scope

The user approved this fix on 2026-10-19 (#356). It unblocks the #311 v10c relaunch.

Related: [#356](https://github.com/eaglhuang/AI-Atomic-Framework/issues/356), [#311](https://github.com/eaglhuang/AI-Atomic-Framework/issues/311), [#354](https://github.com/eaglhuang/AI-Atomic-Framework/issues/354), [PR #355](https://github.com/eaglhuang/AI-Atomic-Framework/pull/355).

## Problem

Under `unix-user`, `run_real_attempt` hands Arm B's probe repo to `prereg-steward` (`own_worktree`). Then `base_sha="$(git -C "$repo" rev-parse HEAD)"` runs as the launcher user. Git refuses the repo ("dubious ownership"), and v10b stopped before Arm B's model call. `inspect_probe_attempt` also reads the repo before `finish_probe_steward` releases it. Without a fix it would misclassify a real commit as `a-no-commit`/`b-no-accepted-write` (`rev-parse` fails → `head=None`).

## Fix

- `probe_git <repo> ...` = `git -c safe.directory=<repo> -C <repo> ...` for the base sha.
- `inspect_probe_attempt` uses the same per-command `safe.directory=<repo>` for `rev-parse`, `show` and `apply --reverse --check`.
- No global git config is written.

## Audit (same cross-owner pattern elsewhere)

- `setup.sh` only uses git on the launcher-owned template.
- `lib/run-arm.sh` clones and checks out before `own_worktree`. It then runs `release_worktree` (chown back) before `record_model`, `evaluate` and `seal`.
- `git-shim` / `git-forward` run inside the session env, which carries `GIT_CONFIG_*` `safe.directory=*`.
- The steward daemon runs as the owner.
- `evaluate.py` / `seal.sh` read the worktree only after release.
- Nothing else needed a change. The zero-quota stub-codex rehearsal below exercises all of these under `unix-user`.

## Acceptance

- `bash kit/test/test-probe-cross-owner-git.sh` exits 0 with real sudo + prereg users. It skips explicitly without passwordless sudo. It runs with `GIT_CONFIG_GLOBAL=/dev/null` and checks:
  - negative control: plain git fails with "dubious ownership";
  - `inspect_probe_attempt` returns `reason=ok`, `committed=true` on a steward-owned repo;
  - `probe_git` reaches the base sha;
  - ownership is unchanged and no global `safe.directory` was written.
- On the unpatched kit, the same test fails: inspect reports `a-no-commit`.
- `preflight.sh` runs it as check `cross-owner-git`, so CI "Smoke kit preflight" covers it.
- Offline preflight exits 0.
- Zero-quota rehearsal: the real-model preflight path, then setup, Arm A, Arm B, evaluate and seal, run under `unix-user` with a stub `codex` on PATH and pass end to end.
