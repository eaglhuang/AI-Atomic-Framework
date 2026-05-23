---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-task-intent-resolver
title: ATM Task Intent Resolver
summary: Resolve the current user prompt into an atm.taskIntent.v1 proposal before next-action routing.
command: node atm.mjs next --intent .atm/runtime/task-intent.json --json
firstCommand: node atm.mjs next --intent .atm/runtime/task-intent.json --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill when the user prompt mentions a task id, task card, plan document,
or a scoped batch of tasks.

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

Write exactly one `atm.taskIntent.v1` JSON file before calling ATM:

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
different runtime path. The skill may propose intent; ATM CLI remains the only
authority that can accept, reject, narrow, claim, or route it.

## First Command After Intent File Exists

```bash
{{firstCommand}}
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

{{CHARTER_INVARIANTS}}
