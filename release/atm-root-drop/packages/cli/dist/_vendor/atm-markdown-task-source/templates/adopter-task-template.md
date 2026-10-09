---
doc_id: doc_{{task_id}}
task_id: {{task_id}}
title: "{{title}}"
status: planned
owner: {{owner}}
priority: P2
depends_on:
{{depends_on_yaml}}
planning_repo: {{repo_name}}
target_repo: {{repo_name}}
closure_authority: target_repo
scopePaths:
{{scope_paths_yaml}}
validators:
{{validators_yaml}}
deliverables:
{{scope_paths_yaml}}
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
  notes: "Revert the delivery commit if the change fails validation."
outOfScope: []
nonGoals: []
---

# {{task_id}} - {{title}}

## Goal

{{goal}}

## Scope

Edit only the files listed in `scopePaths`. Ask for a new task card instead of widening the scope.

## Acceptance

- Every command in `validators` passes and is recorded with `node atm.mjs evidence run`.
- The change is committed with `node atm.mjs git commit --task {{task_id}}` and closed with `node atm.mjs taskflow close --task {{task_id}}`.
