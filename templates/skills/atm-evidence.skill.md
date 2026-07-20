---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-evidence
title: ATM Evidence
summary: Explain missing evidence or blocked guidance before proceeding.
command: node atm.mjs explain --why blocked --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

First command:

```bash
{{firstCommand}}
```

## Route Command

Use this ATM command only after the first command confirms it is the current governed route:

```bash
{{command}}
```

If blocked guidance includes an `ATM_*` code, use `atm-error-code-resolver`
for the meaning, retryability, approval requirement, and next safe action. Do
not turn source-index context into a private remediation table here.

## Governance Evidence Checklist

When explaining readiness or missing evidence for a governed task, check for:

- consumed sealed summaries;
- missing data and assumption changes;
- a stop rule;
- touched shared-write gates and the `INV-ATM-008` outcome;
- telemetry window, watermark, counters, duration/timing, source availability,
  compact digest, and explicit unavailable receipts;
- frozen-entry smoke evidence when runner, release, broker shared-write
  behavior, first-layer entry behavior, skill template projection, or generated
  integration output changed.

If a required signal is unavailable, say `unavailable` with the receipt or
reason. Do not treat missing telemetry as zero latency, zero failures, or
success.

## Team Agents Evidence Surface

When evidence or blocked guidance involves Team Agents, recognize these as
first-class proof surfaces:

- `atm.teamProviderRunArtifact.v1` proves a governed provider role run.
- `atm.reviewAgentSignature.v1` proves formal or advisory Review Agent output.
- `atm.teamAgentObservabilityEvent.v1` proves runtime events such as
  `artifact.output`, `session.failure`, and `broker.conflict.blocked`.
- `knowledge.query` is shareable advisory read access; `knowledge.index.write`
  is coordinator-only generated cache writing.
- `review.signature.write` is formal Review Agent authority and requires the
  independence/quorum checks named by the task.

If `decisionClass`, `decisionReason`, `requiresHumanSignoff`, `requiresAdr`,
`violationStatus`, or `escalationTarget` appears in plan/status/start output,
carry those fields into the evidence explanation. If `violationStatus` is
`broker-conflict-blocked`, explain the required Broker resolution path instead
of treating it as a warning.

## Handoff

```bash
{{handoffs}}
```

## Charter Invariants

{{CHARTER_INVARIANTS}}

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel task model, registry, or approval flow.
- Treat any planning hint as CLI output, not as template authority.
