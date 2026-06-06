---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-task-card-authoring
title: ATM Task Card Authoring
summary: Author ATM task cards with machine-readable scope, deliverables, validators, evidence, rollback, and atomization impact.
command: node atm.mjs tasks import --from "$ARGUMENTS" --dry-run --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill when creating or revising ATM task cards, plan follow-up tasks,
framework-development task cards, or default-governance plugin work items.

First command:

```bash
{{firstCommand}}
```

If the task card does not exist yet and `next` returns scope-not-found, continue
only as an authoring action. Do not claim unrelated open tasks.

## Required Card Contract

Every task card must include frontmatter or an equivalent machine-readable block:

```yaml
task_id: TASK-AREA-0001
title: Short action-oriented title
status: planned
owner: atm-release
priority: P0
depends_on: []
related_plan: docs/path/to/work-record.md
planning_repo: <adopter-planning-repo>
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - packages/cli/src/commands/example.ts
deliverables:
  - packages/cli/src/commands/example.ts
validators:
  - npm run validate:cli
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
atomizationImpact:
  ownerAtomOrMap: atm.cli-command-router-map
  mapUpdates:
    - atomic_workbench/maps/atm-cli-command-router-map.json
```

## Authoring Rules

- Keep planning context and target work separate:
  - `planning_repo` / `related_plan` are read-only context.
  - `target_repo`, `scopePaths`, and `deliverables` are the files an agent may
    actually change.
- Use explicit paths. Do not rely on prose acceptance text to define scope.
- Include real non-ATM deliverables for code, data, pipeline, script, report, or
  artifact tasks. `.atm/history/**` is ledger state, not the deliverable.
- Include validators before the task is imported. If no validator exists yet,
  the task must say which validator must be created.
- Include rollback instructions. For framework tasks, prefer revertable commits
  plus any generated artifact cleanup.
- Include `atomizationImpact` for ATM framework work:
  - name the owner atom or map;
  - list map/spec/report files that must be updated;
  - state whether new scripts are allowed.
- For any new script, require atomization ownership in the same task:
  - script path in `deliverables`;
  - owner atom/map update in `atomizationImpact`;
  - validation command in `validators`.

## Follow-up Task Pattern

When extending an existing plan, append a follow-up section to the original plan
before creating separate cards. Avoid scattering related follow-up work across
many disconnected documents.

Each follow-up card should answer:

1. What prior decision or score exposed this work?
2. Which exact metric or gate changes?
3. Which source files, reports, maps, or policies are allowed to change?
4. Which command-backed evidence proves completion?
5. What is the rollback path?

## Import Check

After authoring or editing cards, dry-run import before asking another agent to
implement them:

```bash
node atm.mjs tasks import --from "$ARGUMENTS" --dry-run --json
```

The dry-run must discover the intended task ids and must not fall back to
unrelated open tasks.

## Charter Invariants

{{CHARTER_INVARIANTS}}

## Guardrails

- Do not create a second task store or custom lifecycle.
- Do not hand-edit `.atm/runtime/**` or `.atm/history/**`.
- Do not use ledger-only evidence as delivery evidence for code, data, script,
  report, pipeline, or artifact tasks.
- Do not let a planning repo path enter target `allowedFiles` unless the task is
  explicitly a mirror/import task.
