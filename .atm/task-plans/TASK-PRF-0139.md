---
doc_id: doc_TASK-PRF-0139
task_id: TASK-PRF-0139
title: 'Unified-patch per-line EOL preservation (#362)'
status: done
owner: grok-bot
priority: P1
depends_on:
- TASK-PRF-0138
planning_repo: AI-Atomic-Framework
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
- .atm/history/evidence/TASK-PRF-0139.*
- .atm/history/task-events/TASK-PRF-0139/**
- .atm/history/tasks/TASK-PRF-0139.json
- .atm/task-plans/TASK-PRF-0139.md
- .atm/task-plans/TASK-PRF-0138.md
- PROGRESS.md
- packages/core/src/broker/**
- packages/core/src/live-write/**
- packages/cli/dist
- packages/cli/dist/**
- release/atm-onefile/**
- release/atm-root-drop/**
- scripts/**
- tests/cli/**
- tests/core/**
- research/paper-v2/prereg-v3-smoke/kit/**
validators:
- node --strip-types tests/cli/unified-patch-eol.test.ts
- node --strip-types tests/cli/unified-patch-locator.test.ts
- node --strip-types tests/cli/unified-patch-application.test.ts
- node --strip-types tests/cli/unified-patch-eof-newline.test.ts
- node --strip-types tests/core/live-queued-write.test.ts
- bash research/paper-v2/prereg-v3-smoke/kit/test/test-hunk-locator-parity.sh
deliverables:
- packages/core/src/broker/unified-patch.ts
- tests/cli/unified-patch-eol.test.ts
- research/paper-v2/prereg-v3-smoke/kit/bin/unified-patch.generated.mjs
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: Revert the delivery commit; restores the single-EOL split/join.
nonGoals:
- Do not re-pin the hist-v2 smoke runbook or modify any sealed archive.
- No whitespace-ignoring match mode by default.
- Do not tag or publish npm.
completed_at: "2026-10-19T23:29:45.239Z"
completed_by_agent: "grok-bot"
closedAt: "2026-10-19T23:29:45.239Z"
closedByActor: "grok-bot"
closedByCommand: atm tasks close
lastTransitionId: "2026-10-19T23-29-45-239Z-close-7f25e054573f"
lastTransitionAt: "2026-10-19T23:29:45.239Z"
ledgerContractVersion: task-ledger/v1
delivery_commit: "78e71236a6678352c7af254ad8e0d08e894539cf"
---

# TASK-PRF-0139 — per-line EOL preservation in unified-patch

## Authority and scope

User-approved next item of the write-path hardening order (#361 → #359 → #362 → …, umbrella #367) on 2026-10-20. Issue: [#362](https://github.com/eaglhuang/AI-Atomic-Framework/issues/362).

This task also carries the closed TASK-PRF-0138 task card (`.atm/task-plans/TASK-PRF-0138.md`), which was left uncommitted after an interrupted close on PR #370.

## Design

- Source and patch lines keep their own terminator (`text` + `eol`). Untouched lines round-trip byte for byte.
- Context and removal lines match on content and EOL, as `git apply` does by default. There is no ignore-CR mode by default.
- Added lines take the patch line's own terminator when the patch carries `\r`. Otherwise they follow git's observed behaviour, which the differential test checks.
- `steward-base-composer` and `steward-region-rebase` share the same split/join.

## Acceptance

- #362 AC1–AC4: mixed-EOL edits in both the LF and the CRLF part, an LF file with a CRLF added line, a CRLF file with an LF patch, EOF-no-newline with CRLF, CRLF-only, LF-only, and no-final-newline round trips.
- Differential test against `git apply` on random mixed-EOL cases: byte-identical, or both refuse.
- Kit generated copy and parity check updated if the core module changes.
