---
mode: agent
description: Resolve the current user prompt into an atm.taskIntent.v1 proposal before next-action routing.
---


# ATM Task Intent Resolver

Use this skill when the user prompt mentions a task id, task card, plan document,
or a scoped batch of tasks.

If the user gives one exact task id and no extra plan or batch ambiguity, prefer
the session-local CLI selector instead of writing the shared runtime intent file:

```bash
node atm.mjs next --task TASK-ABC-0001 --json
node atm.mjs next --claim --actor "$ATM_ACTOR_ID" --task TASK-ABC-0001 --json
```

Use this semantic resolver for fuzzy task titles, shorthand ranges, plan
documents, target-repo hints, or multiple tasks.

## Semantic Extraction First

Read the current user prompt semantically before routing. Do not rely on keyword
matching alone. Infer, with explicit uncertainty when needed:

- Which task ids are mentioned directly or indirectly.
- Which plan document, task root, or active document the user likely means.
- Which target repository owns the work, especially when the current repository
  is only a planning or adopter repo.
- Whether the requested action is analyze, implement, redo, reopen, close, audit,
  or cleanup.
- Whether the user asks for one task, an ordinal range such as "first three", or
  the whole scoped queue.

When semantic resolution is needed, write exactly one `atm.taskIntent.v1` JSON
file before calling ATM:

```json
{
  "schemaId": "atm.taskIntent.v1",
  "userPrompt": "$ARGUMENTS",
  "mentionedTaskIds": [],
  "mentionedPlanPaths": [],
  "taskRootHints": [],
  "targetRepoHints": [],
  "requestedAction": "implement",
  "confidence": 0.75,
  "source": "atm-skill"
}
```

Use `.atm/runtime/task-intent.json` unless the editor integration provides a
different runtime path. This is a shared runtime fallback; do not use it for a
single exact `--task` route. The skill may propose intent; ATM CLI remains the
only authority that can accept, reject, narrow, claim, or route it.

## First Command After Intent File Exists

```bash
node atm.mjs next --intent .atm/runtime/task-intent.json --json
```

If the skill cannot resolve a confident target, still write the intent file with
lower `confidence` and the safest candidate hints. ATM should then return
`ATM_NEXT_TASK_SELECTION_REQUIRED` or `ATM_NEXT_TASK_SCOPE_NOT_FOUND`; do not
pick a global task manually.

## Intent Contract

Call:

```bash
node atm.mjs next --intent <intent-json-path> --json
```

ATM will validate the skill's hints against repo-local task cards, imported
ledger files, task source metadata, target repo constraints, and closure
authority before routing.

`node atm.mjs next --prompt "$ARGUMENTS" --json` is only the deterministic
fallback for environments that cannot run this semantic skill. It is not the
primary route when this skill is available.

## Guardrails

- Do not choose a global open task when the prompt is scoped to a specific plan.
- Do not treat fuzzy title matches as authority unless ATM returns a unique route.
- Do not treat CLI keyword extraction as semantic understanding; the skill must
  produce `source: "atm-skill"` intent when the prompt contains human task or
  plan language.
- If ATM returns `ATM_NEXT_TASK_SELECTION_REQUIRED`, ask for a task id or narrower
  plan scope before editing.
- If ATM returns a `requiredCommand`, run that command exactly before mutating.

## Charter Invariants

- `INV-ATM-001` ??**No second registry** (enforcement: `gate`, breaking change: yes)
  Rule: A host project must not create a second AtomicRegistry implementation outside of packages/core or introduce a parallel ID allocation, version tracking, or registry promotion path.
- `INV-ATM-002` ??**Lock before edit** (enforcement: `doctor`, breaking change: no)
  Rule: No governed file mutation may occur without a valid ScopeLock recorded in .atm/locks/ for the current WorkItem. Agents must call atm lock before editing files.
- `INV-ATM-003` ??**Schema-validated promotion only** (enforcement: `gate`, breaking change: yes)
  Rule: An UpgradeProposal must pass all automatedGates (including JSON Schema validation) before promotion. Direct registry mutation that bypasses the UpgradeProposal path is forbidden.
- `INV-ATM-004` ??**No competing highest authority** (enforcement: `doctor`, breaking change: yes)
  Rule: No host project rule, profile, or configuration may declare itself to have authority equal to or higher than the AtomicCharter. Any rule that contradicts an invariant must go through a charter waiver proposal.
- `INV-ATM-005` ??**Host rule amendments require waiver flow** (enforcement: `waiver-required`, breaking change: no)
  Rule: When a host project rule conflicts with a charter invariant, the host must submit a behavior.evolve UpgradeProposal with a charterWaiver field and a linked HumanReviewDecision. Silent override is not permitted.
- `INV-ATM-006` ??**Framework work tracking stays target-local** (enforcement: `doctor`, breaking change: yes)
  Rule: The framework repository must not host downstream adopter planning queues or project-specific work tracking artifacts. ATM framework-development tasks may live in the framework repository only as ATM-managed .atm/history/tasks ledger records with CLI transition evidence.
- `INV-ATM-007` ??**Public framework docs remain English-only** (enforcement: `doctor`, breaking change: yes)
  Rule: Public contributor-facing documentation in the framework repository must remain English-only and repository-neutral. Non-English planning notes, local experiments, or downstream operating guidance must live in the coordinating host workspace unless they are translated into neutral English framework documentation.

Do not introduce a second registry, task state, or approval path.
