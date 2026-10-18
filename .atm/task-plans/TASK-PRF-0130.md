---
doc_id: doc_TASK-PRF-0130
task_id: TASK-PRF-0130
title: 'Repair prereg smoke kit preflight Python, session PATH and bounded probe retry (#345; related #311)'
status: done
owner: codex-issue345
priority: P1
depends_on: []
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0130.*
- .atm/history/task-events/TASK-PRF-0130/**
- .atm/history/tasks/TASK-PRF-0130.json
- research/paper-v2/prereg-v3-smoke/kit/lib/common.sh
- research/paper-v2/prereg-v3-smoke/kit/preflight.sh
- research/paper-v2/prereg-v3-smoke/kit/RUNBOOK.md
- research/paper-v2/prereg-v3-smoke/kit/test/test-probe-retry.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test-real-model.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test-session-login-path.sh
- research/paper-v2/prereg-v3-smoke/kit/bin/evaluate.py
- research/paper-v2/prereg-v3-smoke/kit/bin/atm-write.mjs
- research/paper-v2/prereg-v3-smoke/kit/bin/steward-daemon.mjs
- research/paper-v2/prereg-v3-smoke/kit/seal.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test_metrics_evidence.py
- research/paper-v2/prereg-v3-smoke/kit/test/test-session-slot.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test-preflight-archive.sh
validators:
- bash research/paper-v2/prereg-v3-smoke/kit/test/test-session-login-path.sh
- bash research/paper-v2/prereg-v3-smoke/kit/test/test-probe-retry.sh
- python3 research/paper-v2/prereg-v3-smoke/kit/test/test_metrics_evidence.py
- bash research/paper-v2/prereg-v3-smoke/kit/test/test-session-slot.sh
- bash research/paper-v2/prereg-v3-smoke/kit/test/test-preflight-archive.sh
deliverables:
- research/paper-v2/prereg-v3-smoke/kit/lib/common.sh
- research/paper-v2/prereg-v3-smoke/kit/preflight.sh
- research/paper-v2/prereg-v3-smoke/kit/RUNBOOK.md
- research/paper-v2/prereg-v3-smoke/kit/test/test-probe-retry.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test-real-model.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test-session-login-path.sh
- research/paper-v2/prereg-v3-smoke/kit/bin/evaluate.py
- research/paper-v2/prereg-v3-smoke/kit/bin/atm-write.mjs
- research/paper-v2/prereg-v3-smoke/kit/bin/steward-daemon.mjs
- research/paper-v2/prereg-v3-smoke/kit/seal.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test_metrics_evidence.py
- research/paper-v2/prereg-v3-smoke/kit/test/test-session-slot.sh
- research/paper-v2/prereg-v3-smoke/kit/test/test-preflight-archive.sh
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert only the scoped kit and this task closeout; retain historical experiment results.
nonGoals:
- 'Do not fix #343 or alter ATM core.'
- 'Do not run the formal #311 experiment or real model probes.'
- Do not merge, tag, publish npm, access credentials or use paid APIs.
completed_at: "2026-10-18T11:21:33.590Z"
completed_by_agent: "codex-issue345"
closedAt: "2026-10-18T11:21:33.590Z"
closedByActor: "codex-issue345"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-18T11-21-33-590Z-close-afeddc35ab2f"
lastTransitionAt: "2026-10-18T11:21:33.590Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "3ef4389991b6a83a68522a5c45c026381df15589"
---

# TASK-PRF-0130 — prereg smoke kit contracts

## Authority and scope

The user explicitly designated this repository and `.atm/task-plans/TASK-PRF-0130.md` as the planning source for this task, imported through the official tasks import command. The existing JSON ledger and claim remain authoritative for lifecycle transitions. This is the source for the same TASK-PRF-0130, not a new task.

Related: [#345](https://github.com/eaglhuang/AI-Atomic-Framework/issues/345), [#311](https://github.com/eaglhuang/AI-Atomic-Framework/issues/311).

## Problem

Preflight precedes setup and needs a declared Python; operator Codex directories could precede the arm shim in PATH; successful model writes without BEGIN markers need one bounded retry.

## Acceptance

- Issue #345: real-model preflight rejects missing or invalid PREREG_PYTHON before Codex; RUNBOOK distinguishes preflight and setup.
- Issue #345: both probe and formal session PATH put PREREG_ARM_BIN first, then kit, evaluation venv, node and system bins; operator prefixes are excluded.
- Issue #345: missing BEGIN_INTENDED_PATCH alone permits at most two attempts per arm, with full attempt outcomes; PATH, commit, steward and quota failures never retry.
- Offline fake Codex and poisoned operator git/python3 tests pass; no real #311 A/B experiment, core repair, historical result rewrite, paid API, tag or npm publication.
- Reject reversed or duplicate patch markers as malformed without retry.
- Verify attempt-owned steward worker and launcher exit before a retry; stop without another model call if teardown fails.

## Design and evidence boundary

Use explicit CPython 3.8–3.10 preflight configuration and fail before provider/auth checks. Probe and formal PATH share one builder, with an absolute outer Codex executable. Only missing BEGIN after arm-specific write evidence allows a second attempt. Keep chronological command-backed test history, including failed red cases.

The previous unconditional daemon-leak diagnosis was corrected: release_worktree already stops both PIDs. This patch verifies the best-effort stop before retry and tests failure; it does not claim ordinary retries necessarily leaked.

No formal #311 A/B experiment or real model probe is authorized here. No paid API, credential access, core change, historical-result rewrite, merge, tag or npm publication.

## Closeout

Resolve this imported repo-local source card directly without a dedicated profile, preview the exact bundle, and close only after validators pass. At authoring time the task is running; no completion or planning seal is asserted in this source.

## Approved 2026-10-18 evidence amendments (#345)

- Preserve absent token fields as null, including total_tokens; preserve observed cached_input_tokens and reasoning_output_tokens. Explicit zero remains zero; never infer an absent total.
- Keep steward rejected counts and reasonCodes separate from conflictCount. A patch-context-mismatch with an unchanged base hash is not conflict evidence. Count only evidenced conflicts; missing evidence remains null.
- Bind each steward write to its session slot through distinct actor/proposal identity, across direct and socket transports.
- Retain every preflight probe attempt log and the bounded retry policy in new archives using an explicit allowlist and existing secret checks.
- Cover all four amendments with offline fixtures, fake CLI/socket execution, retry and archive tests. Do not rewrite old v9 archives or historical fixtures.
