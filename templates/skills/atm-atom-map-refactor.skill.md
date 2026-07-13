---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-atom-map-refactor
title: ATM Atom Map Refactor
summary: Plan ATM framework refactors by preserving atom/map semantics before splitting large governance modules.
command: node atm.mjs next --prompt "$ARGUMENTS" --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill before editing ATM framework code for a refactor, extraction,
governance-invariant cleanup — and for ANY task card whose scope touches a
large governance module (over 600 lines), not only cards labeled as refactors
(TASK-AAO-FABLE-006). The goal is to choose a small atom owner and a testable
contract before moving code.

Extraction-first is a core ATM intent: prefer proposing the change as a new
atom or atom map over inline-editing the large module. The owner/pattern
selection below IS the extraction proposal — record it in the card's
`atomizationImpact.extractionCandidates` (see the `atm-task-card-authoring`
skill) and restate it in the implementing agent's dispatch report. Staying
inline is a human decision and requires a recorded `inlineReason` on the
card. ATM patrols this at import time via the advisory diagnostic
`ATM_TASK_IMPORT_EXTRACTION_FIRST_CANDIDATE`.

## First Command

```bash
{{firstCommand}}
```

## Required Workflow

1. Read the active task card and its allowed files.
2. Name the governance invariant being touched.
3. Choose exactly one primary extraction pattern:
   - Policy Object
   - Strategy Map
   - Result Contract Object
   - Facade
   - Adapter/Port
4. Propose the owner module, public surface impact, focused test, and CLI
   regression.
5. Extract only the atom already in task scope.
6. Record adjacent refactors as follow-up work instead of widening the task.

If the task is not a refactor or extraction task, still run steps 2-4 to
produce an extraction candidate whenever the touched module exceeds 600 lines,
then record it as `extract`, `follow-up-card`, or human-approved `inline` on
the card. Do not turn an unrelated bug fix into a broad cleanup — propose,
let the Captain/human decide, and default to opening the follow-up card.

## Pattern Selection

Read `references/patterns.md` when choosing the extraction shape or reviewing a
proposed split.

Use the short rule:

- Admission, permission, waiver, or allowed/blocked decisions -> Policy Object.
- Mode, bucket, or route selection -> Strategy Map.
- Evidence, diagnostics, bundle, or provenance output -> Result Contract
  Object.
- Operator-facing command that delegates to atoms -> Facade.
- Host/adopter boundary -> Adapter/Port.

## ATM Guardrails

- Keep `taskflow open` and `taskflow close` as normal operator lanes.
- Treat direct `tasks close`, `tasks reconcile`, `tasks import --write --force`,
  and `tasks repair-closure` as backend/emergency surfaces when used directly.
- Keep caller-facing contracts stable. Prefer re-exporting from
  `public-surface.ts` instead of changing callers ad hoc.
- Do not create a second task lifecycle, task storage model, registry, or close
  authority.
- Keep source delivery commits separate from runner-sync commits when
  `ATM_RUNNER_SYNC_REQUIRED` appears.
- Add focused tests for the extracted atom, then run the task card validators.

## Output Shape

Before implementing a refactor, produce a concise plan:

```text
Atom:
Pattern:
Owner module:
Callers:
Public surface:
Focused test:
CLI regression:
Out of scope:
Commit split:
```

If the implementation proceeds, report the same fields with the final paths and
validator results.

## Casebook

Read `references/casebook.md` when the current task resembles prior CID work or
when adding a new lesson after a successful extraction.

Add a new case only after a task is governed done. Keep cases short: problem,
chosen pattern, owner module, proof, lesson.

{{CHARTER_INVARIANTS}}
