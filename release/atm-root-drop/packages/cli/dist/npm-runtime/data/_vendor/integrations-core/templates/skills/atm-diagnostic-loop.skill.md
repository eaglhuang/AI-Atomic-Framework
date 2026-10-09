---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-diagnostic-loop
title: ATM Diagnostic Loop
summary: Convert a bug symptom into red reproduction, falsifiable hypotheses, regression coverage, and causal repair evidence.
command: node atm.mjs evidence diagnose --task "$ARGUMENTS" --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
owner: atm-framework
tier: specialist
installProfiles: [framework-full, role-oriented]
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

## Purpose

Use this skill when a defect, flaky behavior, dogfood failure, or field incident
needs to become durable learning instead of a one-off patch. The goal is to
prove the leak, map nearby joints that could leak for the same reason, add the
right focused tests, and leave a receipt that explains why the repair is real.

## Diagnostic Loop

Follow this order:

1. Name the exact symptom and the smallest command or fixture that reproduces
   it.
2. Confirm the symptom was observed. A no-crash run, broad log scrape, or
   unrelated red failure does not admit repair.
3. Write falsifiable hypotheses. Each hypothesis must include a predicted
   observation and a one-variable experiment.
4. Select the winning hypothesis only after the experiment result matches.
5. Add or select a regression case id for the same cause family and nearby
   failure combinations.
6. Run green evidence for the regression case.
7. Remove temporary instrumentation, or promote it as a maintained observability
   seam before close.

## Route Command

Use this ATM command only after the first command confirms this specialist route:

```bash
{{command}}
```

The diagnostic receipt must bind: symptom, reproducer command, candidate digest,
environment digest, reproduction rate, minimized fixture, hypotheses,
experiment results, winning hypothesis, regression case id, green evidence, and
temporary-instrumentation disposition.

## Fail-Closed Rules

- If the reproducer does not observe the declared symptom, stop.
- If hypotheses are explanations without predicted observations and
  experiments, stop.
- If green evidence does not pass the regression case, stop.
- If temporary instrumentation remains but is neither removed nor promoted as a
  maintained seam, stop.
- If an emergency or trivial compile-failure path is used, record a bounded
  rationale with an expiry.

## Backlog Feedback

When the fix reveals missing coverage, route the learning into the backlog as a
cause-family test expansion: affected seam, neighboring combinations, selected
case ids, omitted case ids with reasons, and replay command. Do not ask future
workers to run every test; ask them to run the family selected by the receipt.

## Charter Invariants

{{CHARTER_INVARIANTS}}

## Guardrails

- Stay provider-neutral.
- Do not replace the ATM bug backlog, evidence lifecycle, or TDD case-id
  contract.
- Do not treat a model explanation as repair evidence.
