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

## Validation Contract Lifecycle

Evidence run, auto-evidence, pre-close, write-readiness, and the advisory review
all consume the one `evaluateValidationContract` selector. Never derive a local
required set or recompute freshness in an adapter.

When a task card declares engineering change method profile ids, carry those
profile ids into evidence review and verify their completion evidence through
the shared profile evaluator. Evidence may report a missing or stale method
profile receipt, but it must not create a parallel checklist that disagrees with
the profile source.

- **Selected-case execution.** Run only the contract-selected case ids and
  preserve each case's structured output. A shell command that exits zero
  without executing its declared assertions is a zero-test result and fails the
  execution contract — it is not a pass.
- **One contract digest.** Evidence, pre-close, close packet, and pre-push must
  thread the same validation-contract digest. A changed required set, freshness,
  or phase owner between stages is a defect, not a refresh.
- **Candidate freshness.** A candidate source change invalidates every TDD,
  review, and required-case receipt whose recorded candidate digest no longer
  matches; stale green receipts do not survive a change under them.
- **Fail closed.** Pre-close rejects unresolved required cases, zero-test
  results, and stale phase ownership; advisory checks stay non-blocking. A
  missing required contract fails closed with one executable recovery manifest —
  never a full-repository run.

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
