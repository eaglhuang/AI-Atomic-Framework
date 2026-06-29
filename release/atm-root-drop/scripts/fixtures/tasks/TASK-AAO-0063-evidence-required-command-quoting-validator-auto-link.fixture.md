---
doc_id: doc_other_aao_0063
task_id: TASK-AAO-0063
title: "Evidence requiredCommand quoting and validator auto-link"
status: done
owner: atm-core
priority: P1
milestone: M17
depends_on:
  - "TASK-AAO-0015"
  - "TASK-AAO-0017"
related_plan: "docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First Operability Plan.md"
planning_repo: 3KLife
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - "packages/cli/src/commands/evidence.ts"
  - "packages/cli/src/commands/command-specs/evidence.spec.ts"
  - "scripts/lib/validator-envelope.ts"
  - "atomic_workbench/atomization-coverage/path-to-atom-map.json"
deliverables:
  - "packages/cli/src/commands/evidence.ts"
  - "packages/cli/src/commands/command-specs/evidence.spec.ts"
  - "scripts/lib/validator-envelope.ts"
  - "atomic_workbench/atomization-coverage/path-to-atom-map.json"
validators:
  - "npm run typecheck"
  - "npm run validate:cli"
  - "git diff --check"
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the quoting normalization and validator-name lookup; CLI-only changes, no persistent state."
atomizationImpact:
  ownerAtomOrMap: "atm.evidence-command-map"
  mapUpdates:
    - "atomic_workbench/atomization-coverage/path-to-atom-map.json"
  notes: "Add or refresh ownership entries for evidence.ts and validator-envelope.ts to cover new quoting and auto-link helpers."
outOfScope:
  - "Validator registry expansion beyond commands already declared in package.json scripts"
  - "Cross-shell execution simulation or sandboxing"
  - "Changing the evidence record schema"
nonGoals:
  - "Do not build a universal shell quoting library"
  - "Do not change `evidence verify` or `evidence list` behaviour"
  - "Do not auto-add `--validators` to evidence records the operator did not request"
tags:
  - "cli-ergonomics"
  - "agent-operability"
closed_at: "2026-06-07T12:50:00+08:00"
closed_by_agent: "captain-bulk-reconcile-2026-06-07"
reconcile_note: "Bulk reconcile 2026-06-07: deliverables and/or close-commits verified by audit; status backfilled from planned."
---

# TASK-AAO-0063 - Evidence requiredCommand quoting and validator auto-link

## Goal

(1) Normalize how `requiredCommand` strings are emitted so the same string parses cleanly under cmd.exe, PowerShell, and bash, avoiding copy-paste round-trip failures. (2) When `evidence add --command "<cmd>"` is invoked and `<cmd>` matches a known validator registered in `scripts/lib/validator-envelope.ts` (for example `npm run validate:cli` or `npm run typecheck`), auto-link the corresponding validator name into the evidence record so `--validators` becomes optional.

## Why

Two friction loops compound when collecting close-gate evidence on Windows: PowerShell wraps and unwraps quotes inconsistently, and operators must remember to pass `--validators <name>` even when the command being recorded is unambiguous. Both are ergonomic wins that reduce evidence-collection failures.

## Acceptance Criteria

- `requiredCommand` strings produced by ATM round-trip across cmd.exe, PowerShell, and bash (covered by a tokenizer test, not real shells).
- `evidence add --command "npm run validate:cli"` records `validators: ["validate:cli"]` automatically when `--validators` is omitted.
- Operator-supplied `--validators` always takes precedence over auto-link.
- `npm run typecheck`, `npm run validate:cli`, and `git diff --check` all pass.

## Stop Conditions

- If auto-link risks recording a validator that did not actually run (for example `echo "npm run validate:cli"`), keep auto-link disabled until a stricter detector lands; do not ship a permissive matcher.
