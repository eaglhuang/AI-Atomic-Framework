# Team Vendor Runtime

This document defines the emergency-minimum vendor runtime contract used by Team Agents.

## Vendor-Neutral Core

- The Team runtime core must keep provider registration, session lifecycle, retries, cancellation, and role orchestration vendor-neutral.
- Provider metadata must support `openai`, `azure-openai`, `claude-code`, `gemini`, and `microsoft-foundry` without changing the orchestration contract shape.
- Worker authority remains coordinator-owned. Provider bridges do not gain `git.write`, `task.lifecycle`, or self-close authority.

## Permission Broker

- File, tool, network, and vendor-sensitive actions must flow through one governed permission broker contract.
- Adopter repositories may tighten policy through a governed policy document that conforms to `schemas/governance/team-agent-permission-policy.schema.json`.
- Provider bridges must not self-grant elevated permissions.
- Provider bridges and runtime summaries must surface Broker conflicts through
  the shared Captain UX vocabulary: `decisionClass`, `decisionReason`,
  `violationStatus`, and `broker-conflict-blocked`.
- A blocked bridge must point operators to the
  `atm.brokerConflictResolution.v1` artifact and the `team broker resolve`
  command. It must not instruct operators to hand-edit `.atm/runtime/**`.

## Governed Repo Vendor Config

- Adopter repositories should place vendor configuration under `agent-integrations/vendors/**`.
- The framework may validate layout and explain missing or malformed config, but it must not store adopter secrets in the framework repository.

## Provider Selection

- Repo defaults provide the baseline provider, SDK, model, and runtime mode.
- Role overrides may replace those values for implementer, reviewer, validator, planner, or other roles.
- Selection decisions must remain observable through runtime metadata and operator-facing summaries.

## Role Skill-Pack Compatibility

- Provider selection must bind to a provider-neutral role contract before it
  binds to a model or SDK.
- Runtime adapters should consume `atm.teamRoleSkillPackManifest.v1` as the
  machine-readable role-pack manifest. Its discovery mode is
  `capability-driven`, and `roleFirstProviderSecond` keeps role authority ahead
  of provider choice.
- Runtime adapters should consume role and skill-pack semantics from
  `docs/governance/team-agents/role-skill-pack-contract.md` rather than baking
  provider-specific role meanings into the runtime.
- Role-local learning may vary by provider quality or runtime mode, but the
  growth semantics should still reuse
  `docs/governance/skills/shared-growth-contract.md`.
- Runtime adapters should preserve `atm.teamRuntimePilot.v1` when present. The
  pilot records `agentSkillUnits`, `workflowEvidence`, and
  `roleConfusionMetrics` for the Coordinator / Implementer / Validator lane,
  so bridges can prove bounded skill-pack loading without granting worker
  lifecycle authority.
- Runtime adapters should preserve
  `atm.teamRoleGrowthObservabilityContract.v1` when present. It maps role
  learning artifacts back to the role contract, skill pack, and playbook slice
  while keeping raw lessons reference-first in Team role-pack learning docs.

## Broker Conflict Runtime Projection

Runtime integrations should render `atm.brokerConflictUx.v1` as the
operator-facing conflict summary. The projection is derived from Team Broker and
the canonical role-routing matrix, so M9I vendor bridges can display blocked
task ids, shared paths or atom overlap, `decisionReason`, and the next safe
resolution command without creating a second release-order source.

## Cross-Vendor Observability

All provider bridges must emit `atm.teamAgentObservabilityEvent.v1` records for
session start, step execution, tool invocation, artifact output, completion, and
failure. The same schema also covers Broker conflict events through
`broker.conflict.blocked` and `broker.conflict.resolution`.

Operators query the shared log by `taskId`, `teamRunId`, `providerId`, `role`,
`artifactType`, or `eventType`; providers must not add vendor-local query keys
as a replacement for the shared surface. Broker conflict events reuse
`decisionClass`, `decisionReason`, `violationStatus`, and
`broker-conflict-blocked` from the M8E lane and point at the
`atm.brokerConflictResolution.v1` artifact.

Role-growth observability uses the same query surface. A provider bridge should
project role learning as an `artifact.output` event with artifact type
`atm.teamRoleGrowthLearningItem.v1` and preserve the role name, provider id,
team run id, and task id. The corresponding Team plan contract decides whether
the learning item is shared ATM routing friction or role-specific friction; the
provider bridge should not invent vendor-local categories in place of that
shared taxonomy.

The cross-vendor broker metric is `broker-conflict-blocked.hit-rate`. Bridges
should calculate it from events whose `violationStatus` is
`broker-conflict-blocked`, grouped by role, task id, and `decisionClass`.

Observability is evidence metadata, not a secret sink. Events must set
`rawSecretsLogged: false`, preserve `rawSecretsAllowed: false`, and keep raw
provider prompts, tokens, credentials, and private tool payloads out of the
governance log.
