---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-governance-router
title: ATM Governance Router
summary: Route natural-language cleanup, refactor, migration, and candidate ranking goals through ATM before local analysis.
command: node atm.mjs guide --goal "$ARGUMENTS" --cwd . --json
firstCommand: node atm.mjs next --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill when a user asks in natural language to inspect, rank, clean up,
refactor, split, atomize, infect, migrate, or modernize existing source code.

The goal is to keep the user request natural while still routing the work
through ATM evidence before choosing a local implementation path.

## First Command

```bash
{{firstCommand}}
```

If the first command returns a user notice, surface it briefly, then continue the
original user request.

## Route Command

```bash
{{command}}
```

Follow the returned `nextCommand`. If the matched intent is
`legacy-candidate-ranking`, run the candidate ranking command before doing local
source analysis by hand.

## Required Evidence

For legacy candidate ranking, final reasoning should cite or create:

- ATM guidance result
- candidate ranking artifact
- source inventory artifact
- police artifact
- recommended split, atomize, infect, or compose route

## Guided Fallback

If preferred documents are missing, do not stop and do not silently improvise.
Preserve the fallback contract from ATM output:

- `missingDocs[]`
- `fallbackSources[]`
- `continuedOriginalRequest: true`

Then continue the user's original request with the fallback sources.

## Guardrails

- Do not rank legacy scripts with ad-hoc shell-only heuristics when ATM can
  produce candidate ranking evidence.
- Do not choose split, atomize, or infect before candidate ranking and police
  evidence exist.
- Do not mutate host files during candidate ranking; ranking is advisory until
  a later governed dry run is selected.
- Keep host-local language and phrasing in evidence or host lexicons, not in
  this canonical skill.

## Handoff

```bash
{{handoffs}}
```

## Charter Invariants

{{CHARTER_INVARIANTS}}
