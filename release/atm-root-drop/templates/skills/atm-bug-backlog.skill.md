---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-bug-backlog
title: ATM Bug Backlog
summary: Record bugs, dogfood failures, workflow friction, and optimization ideas into the correct repository-specific backlog.
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

First command:

```bash
{{firstCommand}}
```

Use this skill when the user asks to record an ATM bug, dogfood failure,
workflow friction, optimization backlog item, or when a governed ATM run exposes
a repeatable defect.

## Backlog Authority

Choose the owning backlog before writing anything:

- ATM product, framework, CLI, governance lifecycle, Team Agents, integration
  packs, release runner, or ATM docs: write one
  `atm.governanceBacklogItem.v1` item shard under the ATM backlog item
  directory, then regenerate the Markdown projection.
- Current adopter or app behavior: write only that repository's project backlog.
- Cross-repo unclear: record the adopter symptom first; add an ATM item only
  when evidence points to ATM itself.

The item shard is the record authority. The Markdown backlog is a generated
projection for humans. Do not directly author new ATM rows in the projection.

## Incident Learning Intake

When the bug report has enough signal to learn from, produce or request an
`atm.incidentLearningCandidate.v1` candidate alongside the backlog item. This is
the "leak expands nearby pressure tests" loop:

- Preserve the symptom and the public seam where it appeared.
- Preserve invariant refs, acceptance refs, reproduction refs, receipt refs, and
  source availability.
- Keep missing or conflicting information as `unknown` or `unavailable`.
- Suggest breadth hypotheses:
  upstream/downstream paths, same-policy callers, sibling adapters, adjacent transitions, and shared invariants.
- Suggest depth hypotheses:
  boundary, negative, rollback, retry, concurrency, mutation, property/metamorphic, and independent-oracle gaps.
- Tie proposed tests to the incident's semantic family so future runs can select
  the relevant family instead of running every possible test.

The candidate is evidence-bounded. It may recommend a task card, test ids, or
more evidence, but it cannot authorize merge, cannot declare fix success, cannot exclude
tests, cannot close a task, or create a second backlog.

## Unknown-Safe Rule

Do not guess root cause or family membership. If evidence is missing, say
`unavailable`; if evidence conflicts, say `conflicting`. Root-cause and family
hints stay candidate-only until a task card, validator, or review receipt proves
them.

## Projection Commands

For ATM-owned backlog item shards, rebuild and validate the generated projection:

```bash
node --strip-types scripts/validate-governance-projections.ts --write
node --strip-types scripts/validate-governance-projections.ts
```

## Handoff

```bash
{{handoffs}}
```

## Charter Invariants

{{CHARTER_INVARIANTS}}

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel backlog, task lifecycle, evidence authority, or test
  catalog.
- Do not use an incident-learning candidate as proof that a fix is complete.
- Do not widen into full-repository testing when the incident family selects a
  narrower relevant test set.
