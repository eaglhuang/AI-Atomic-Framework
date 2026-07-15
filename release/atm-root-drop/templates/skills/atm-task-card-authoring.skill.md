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

When a task card is opened because an `ATM_*` code is confusing, missing
remediation, or repeatedly mishandled, route the code explanation through
`atm-error-code-resolver`. The card should update the shared registry instead
of adding private error-code prose to one skill.

## Planning Authority Gate

Before creating a plan, task-card directory, or task card, resolve and state
these three authorities:

- `planning authority`: repository that owns the human-readable plan and source
  task cards;
- `target authority`: repository where implementation files may change;
- `closure authority`: repository whose ATM ledger, evidence, close, and commit
  establish completion.

When planning and target authorities differ, keep the complete plan and source
cards only in the planning repository. The target repository may receive only
CLI-imported `.atm/history/**` ledger records and neutral product documentation
that is itself an explicit deliverable. Do not create a framework-local plan or
temporary card directory merely because implementation will happen there.

Treat an existing `planning_repo`, `related_plan`, AGENTS instruction, or human
decision as binding. If the authority is still unknown, stop authoring until it
is resolved. Memory and handoff notes are supporting context, not enforcement.

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
  extractionCandidates:
    - atom: atm.example-admission-policy
      pattern: Policy Object
      source: packages/cli/src/commands/example.ts
      disposition: extract   # extract | follow-up-card | inline
      inlineReason: null     # required when disposition is inline
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
- Extraction-first (TASK-AAO-FABLE-006 — core ATM intent): prefer extracting
  the change as an atom or atom map over inline-editing a large module.
  - Any card whose `scopePaths` touch a module over 600 lines must declare
    `atomizationImpact.extractionCandidates`, with each candidate's
    `disposition`: `extract` (in this card), `follow-up-card`, or `inline`.
  - `extract` / `follow-up-card` is the default; `inline` requires an
    `inlineReason` recorded on the card and is a human decision — the human
    declining extraction is the only normal reason to stay inline.
  - Use the `atm-atom-map-refactor` skill to pick the owner atom and
    extraction pattern; the implementing agent must restate the proposal in
    its dispatch report when it touches a >600-line module.
  - ATM patrols this at import time: a >600-line scope without
    `extractionCandidates` receives the advisory diagnostic
    `ATM_TASK_IMPORT_EXTRACTION_FIRST_CANDIDATE` (warning-only).

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

## Team Agents Card Addendum

For Team Agents cards, add a small machine-readable Team block when the task
depends on Team runtime behavior:

```yaml
team:
  required: true
  teamLevel: L3
  roleProviders:
    implementer: openai:gpt-5-mini:responses:real-agent
    validator: anthropic:claude-3-5-sonnet:anthropic-messages:real-agent
  runtimeTier:
    reader: raw-api
    implementer: agent-sdk
    lieutenant: editor
  review:
    requiredFormalSignatures: 2
    reviewerIndependencePolicy: different-provider
  knowledge:
    permissions:
      - knowledge.query
  observability:
    requiredEventTypes:
      - artifact.output
      - broker.conflict.blocked
```

Use L1 through L5 consistently:

- L1: Coordinator, Atomization Planner, Implementer, Validator.
- L2: L1 plus Reader and Evidence Collector.
- L3: L2 plus Scope Guardian.
- L4: L3 plus Lieutenant boundary.
- L5: L4 plus Review Agent and Knowledge Scout.

Acceptance for Team cards should name the actual runtime proof, not only the
planning intent: `team start --execute` when execution is required,
`atm.teamProviderRunArtifact.v1` for provider runs,
`atm.reviewAgentSignature.v1` for review signatures, `knowledge.query` for
Knowledge Scout reads, and real observability events for runtime queries.
`broker-conflict-blocked` is a hard gate and should have a required recovery
artifact or command.

## Import Check

After authoring or editing cards, dry-run import before asking another agent to
implement them:

```bash
node atm.mjs tasks import --from "$ARGUMENTS" --dry-run --json
```

The dry-run must discover the intended task ids and must not fall back to
unrelated open tasks.

Before import, verify that `--from` points into the declared planning authority
and that import writes only the target repository's ATM-managed ledger. A local
copy of an external source card is not a valid substitute.

## Charter Invariants

{{CHARTER_INVARIANTS}}

## Guardrails

- Do not create a second task store or custom lifecycle.
- Do not hand-edit `.atm/runtime/**` or `.atm/history/**`.
- Do not use ledger-only evidence as delivery evidence for code, data, script,
  report, pipeline, or artifact tasks.
- Do not let a planning repo path enter target `allowedFiles` unless the task is
  explicitly a mirror/import task.
