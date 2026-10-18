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
owner: atm-framework
tier: entry
installProfiles: [adopter-bootstrap, framework-full, role-oriented]
invocationPolicy: model-or-user
companionFiles: []
adapterCapabilityRequirements:
  - "*:charter-injection"
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
5. Build a responsibility map for the oversized module. When several adjacent
   responsibilities form a cohesive map and are already authorized by the task,
   extract the whole map in one pass instead of shaving off one tiny helper.
6. Measure the projected facade size before editing. Treat 600 lines as the hard
   trigger, never as the post-refactor target: normally leave 25-35% headroom
   (about 390-450 lines for a 600-line ceiling).
7. Extract only the cohesive atom map already in task scope.
8. Record unrelated or unauthorized refactors as follow-up work instead of
   widening the task.

If the task is not a refactor or extraction task, still run steps 2-4 to
produce an extraction candidate whenever the touched module exceeds 600 lines,
then record it as `extract`, `follow-up-card`, or human-approved `inline` on
the card. Do not turn an unrelated bug fix into a broad cleanup — propose,
let the Captain/human decide, and default to opening the follow-up card.

## Durable Headroom Rule

- A line ceiling is an admission boundary, not a design target. A refactor that
  leaves the owner at 550-600 lines usually defers the same problem and is not a
  durable extraction.
- Prefer a cohesive map of 2-4 atoms when the responsibility map supports it.
  Each atom must have one owner, a narrow contract, and focused proof; never
  combine unrelated responsibilities merely to remove more lines.
- For a 600-line ceiling, target the remaining facade at 390-450 lines. If a
  safe extraction cannot reach at least 20% headroom, record the constraint and
  an explicit follow-up rather than claiming the size risk is resolved.
- Estimate both moved lines and likely near-term growth. Select seams that move
  policy, transaction, recovery, or result-assembly responsibilities—not just
  constants, type aliases, or thin forwarding helpers.
- Validate each extracted atom directly and keep one integration regression at
  the facade. Line-count proof alone is never sufficient.

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
Atom map (2-4 cohesive responsibilities):
Pattern:
Owner module:
Callers:
Public surface:
Before / projected-after lines:
Headroom percentage:
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
