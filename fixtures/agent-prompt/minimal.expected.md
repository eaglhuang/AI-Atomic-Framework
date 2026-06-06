---
schemaId: "atm.agentPrompt"
specVersion: "0.1.0"
atomId: "ATM-AGENT-0001"
title: "Agent Prompt Smoke Atom"
lifecycleMode: "birth"
promptPath: "atomic_workbench/atoms/ATM-AGENT-0001/prompt.md"
forbiddenRules:
  - "Keep all host coupling behind adapters; do not call host-specific runtime APIs directly."
  - "Stay within workspace-only dependencies; do not introduce external services or packages."
  - "Treat input payloads as immutable; do not mutate provided inputs in place."
  - "Stay in the birth pipeline; do not propose evolution-only or upgrade-specific work."
allowedFiles:
  - "atomic_workbench/atoms/ATM-AGENT-0001/prompt.md"
  - "atomic_workbench/atoms/ATM-AGENT-0001/atom.spec.json"
  - "atomic_workbench/atoms/ATM-AGENT-0001/atom.test.ts"
evidenceContract:
  evidenceRequired: true
  requiredOutputs:
    - "evidence"
  validationCommands:
    - "npm test"
---
# Build Agent Prompt: Agent Prompt Smoke Atom

## Goal
Implement ATM-AGENT-0001 (atom.agent-prompt-smoke) (Agent Prompt Smoke Atom) from its normalized atomic spec.

## Context
Minimal birth-pipeline atom used to snapshot the generated agent prompt contract.

## Inputs
- `goal` (`text`, required)

## Outputs
- `evidence` (`evidence`, required)

## Instructions
1. Use `javascript` with `node >=20` as the primary execution target.
2. Keep edits inside the allowed files listed in the frontmatter.
3. Satisfy the validation commands listed in the evidence contract.
4. Return evidence for the required outputs before closing the work.