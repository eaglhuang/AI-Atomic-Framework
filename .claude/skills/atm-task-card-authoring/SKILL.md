---
name: atm-task-card-authoring
description: Author ATM task cards with machine-readable scope, deliverables, validators, evidence, rollback, and atomization impact.
argument-hint: "<ATM context>"
charter-invariants-injected: true
---


# ATM Task Card Authoring

Use this skill when creating or revising ATM task cards, plan follow-up tasks,
framework-development task cards, or default-governance plugin work items.

First command:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

If the task card does not exist yet and `next` returns scope-not-found, continue
only as an authoring action. Do not claim unrelated open tasks.


Reserved family routing: ErrorCode and error-governance work must use the registered ERR family (series ERR, prefix TASK-ERR). Temporary cleanup, quarantine, and one-off residue-disposition work must use the registered TMP family (series TMP, prefix TASK-TMP). Do not spend GOV numbers on these categories. If a draft or ledger record already used a GOV id for ERR/TMP work, stop and reclassify it through the registered planning family and, when needed, a ledger rekey/realign repair before implementation continues.
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
planning_repo: governance-workbench
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

- `INV-ATM-001` — **No second registry** (enforcement: `gate`, breaking change: yes)
  Rule: A host project must not create a second AtomicRegistry implementation outside of packages/core or introduce a parallel ID allocation, version tracking, or registry promotion path.
- `INV-ATM-002` — **Lock before edit** (enforcement: `doctor`, breaking change: no)
  Rule: No governed file mutation may occur without a valid ScopeLock recorded in .atm/locks/ for the current WorkItem. Agents must call atm lock before editing files.
- `INV-ATM-003` — **Schema-validated promotion only** (enforcement: `gate`, breaking change: yes)
  Rule: An UpgradeProposal must pass all automatedGates (including JSON Schema validation) before promotion. Direct registry mutation that bypasses the UpgradeProposal path is forbidden.
- `INV-ATM-004` — **No competing highest authority** (enforcement: `doctor`, breaking change: yes)
  Rule: No host project rule, profile, or configuration may declare itself to have authority equal to or higher than the AtomicCharter. Any rule that contradicts an invariant must go through a charter waiver proposal.
- `INV-ATM-005` — **Host rule amendments require waiver flow** (enforcement: `waiver-required`, breaking change: no)
  Rule: When a host project rule conflicts with a charter invariant, the host must submit a behavior.evolve UpgradeProposal with a charterWaiver field and a linked HumanReviewDecision. Silent override is not permitted.
- `INV-ATM-006` — **Framework work tracking stays target-local** (enforcement: `doctor`, breaking change: yes)
  Rule: The framework repository must not host downstream adopter planning queues or project-specific work tracking artifacts. ATM framework-development tasks may live in the framework repository only as ATM-managed .atm/history/tasks ledger records with CLI transition evidence.
- `INV-ATM-007` — **Public framework docs remain English-only** (enforcement: `doctor`, breaking change: yes)
  Rule: Public contributor-facing documentation in the framework repository must remain English-only and repository-neutral. Non-English planning notes, local experiments, or downstream operating guidance must live in the coordinating host workspace unless they are translated into neutral English framework documentation.

## Guardrails

- Do not create a second task store or custom lifecycle.
- Do not hand-edit `.atm/runtime/**` or `.atm/history/**`.
- Do not use ledger-only evidence as delivery evidence for code, data, script,
  report, pipeline, or artifact tasks.
- Do not let a planning repo path enter target `allowedFiles` unless the task is
  explicitly a mirror/import task.
