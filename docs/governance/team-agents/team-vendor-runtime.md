# Team Vendor Runtime

This document defines the emergency-minimum vendor runtime contract used by Team Agents.

## Vendor-Neutral Core

- The Team runtime core must keep provider registration, session lifecycle, retries, cancellation, and role orchestration vendor-neutral.
- Provider metadata must support `openai`, `anthropic`, `azure-openai`, `claude-code`, `gemini`, and `microsoft-foundry` without changing the orchestration contract shape.
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
- Local operator secrets may be centralized in
  `agent-integrations/vendors/team-secrets.local.json`. This file uses
  `atm.teamVendorSecrets.local.v1`, is ignored by git, and is loaded into the
  provider execution `env` map before `team start --execute` orchestration. It
  is a cross-OS convenience layer over environment-variable references: config
  and artifacts still record only names such as `OPENAI_API_KEY`, never raw
  values.
- Commit only `agent-integrations/vendors/team-secrets.example.json` with empty
  or placeholder values. Local backups such as
  `team-secrets.local.backup.json` must remain ignored too.

## OpenAI-Family Direct Bridges

M9I starts with two direct real-agent provider bridges under the shared
`atm.teamProviderContract.v1` interface:

- `openai` uses `atm.openaiTeamProviderConfig.v1`. Required fields are
  `modelId` and the secret reference `apiKeyEnvVar`. Optional organization,
  project, and base URL values are represented as environment-variable
  references, not raw values.
- `azure-openai` uses `atm.azureOpenAITeamProviderConfig.v1`. Required fields
  include `endpointEnvVar`, `deploymentName`, `modelId`, and `authMode`.
  `api-key-env` additionally requires `apiKeyEnvVar`; `managed-identity`
  additionally requires `tenantIdEnvVar`.

Both bridges produce the same `atm.teamProviderRunArtifact.v1` envelope and
the same `atm.teamAgentObservabilityEvent.v1` event sequence:
`session.start`, `artifact.output`, and `session.complete`. The bridge artifact
records `rawSecretsLogged: false`; provider credentials, endpoints, bearer
tokens, and tenant values are read only through configured environment-variable
references and are never copied into artifacts or observability events.

The direct bridge execution path is real, not only a descriptor. OpenAI posts to
the Responses API endpoint selected by `baseUrlEnvVar` or
`https://api.openai.com/v1`. Azure OpenAI posts to the configured deployment
Responses endpoint under `endpointEnvVar`, using `api-key-env` or a bearer token
from `AZURE_OPENAI_BEARER_TOKEN` / `AZURE_ACCESS_TOKEN` for managed-identity
deployments. `AZURE_OPENAI_API_VERSION` may override the default API version.
Tests inject a deterministic HTTP executor, but production runs use the runtime
HTTP executor.

OpenAI-family bridges must request permissions through the shared broker before
launching work. They do not self-grant `git.write`, `task.lifecycle`,
`file.write`, or close authority. If a bridge is blocked by Team Broker, the
operator-facing message must reuse `decisionClass`, `decisionReason`,
`violationStatus`, and `broker-conflict-blocked`, and point to the governed
resolution artifact rather than local runtime edits.

## Anthropic Direct Bridge

M10X adds `anthropic` as a direct Tier A / raw-api reference bridge for the
Anthropic Messages API. It uses `atm.anthropicTeamProviderConfig.v1`; required
fields are `modelId` and the secret reference `apiKeyEnvVar`, with optional
`baseUrlEnvVar`. The bridge posts to `/messages`, records only secret
references, and produces the shared `atm.teamProviderRunArtifact.v1` artifact
plus `atm.teamAgentObservabilityEvent.v1` events.

The Anthropic bridge is discoverable through `TEAM_PROVIDER_IDS`, role provider
selection, the runtime bridge summary, and provider permission broker policy. CI
and deterministic validators use an injected HTTP executor and must not call a
live paid API.

## Runtime Tiers

Team plans expose `atm.teamRuntimeTierContract.v1` per active role. Reader,
Validator, Knowledge Scout, Review Agent, and Evidence Collector default to
`raw-api`; Implementer and Coordinator default to `agent-sdk`; Lieutenant,
Scope Guardian, and Atomization Planner default to `editor`. These tiers are
compatible extensions of the existing provider contract: `RawChatAdapter`,
`AgentLoopAdapter`, and `EditorAgentAdapter`.

## Claude Code and Gemini Execution Bridges

M9I also includes two editor execution bridges under the same
`atm.teamProviderContract.v1` interface:

- `claude-code` uses `atm.claudeCodeTeamProviderConfig.v1`. Required fields
  are `modelId`, `editorCommand`, and
  `roleEnvelopeSchemaId: atm.teamEditorSubagentRoleEnvelope.v1`.
- `gemini` uses `atm.geminiTeamProviderConfig.v1`. Required fields are
  `modelId`, `cliCommand`, and
  `roleEnvelopeSchemaId: atm.teamEditorSubagentRoleEnvelope.v1`.

Both bridges run as `editor-subagent` Team provider sessions, but they preserve
different execution surfaces in the role envelope: Claude Code records
`editor-subagent`, while Gemini records `cli-style`. The normalized
`atm.teamEditorSubagentRoleEnvelope.v1` envelope keeps `taskId`, `role`,
`providerId`, `sdkId`, `modelId`, allowed files, permission leases, and
coordinator-owned authority together before any provider work begins.

Claude Code and Gemini bridges emit the shared
`atm.teamProviderRunArtifact.v1` artifact and the shared
`atm.teamAgentObservabilityEvent.v1` sequence: `session.start`,
`artifact.output`, and `session.complete`. They do not log raw secrets, do not
grant themselves `git.write`, `task.lifecycle`, or close authority, and must
route blocked work through the same `decisionClass`, `decisionReason`,
`violationStatus`, and `broker-conflict-blocked` vocabulary used by the M8E
Team Broker lane.

The editor bridge execution path invokes the configured command rather than
stopping at envelope creation. Claude Code runs `editorCommand --model
<modelId> --print`; Gemini runs `cliCommand --model <modelId>`. The role
envelope is written to stdin as structured JSON so provider tools receive the
task id, role, allowed files, permission leases, and coordinator-owned authority
without gaining lifecycle authority. Production uses the command executor;
validators inject a deterministic command executor.

## Microsoft Foundry Provider-Family Bridge

Microsoft Foundry is represented as one provider family with two distinct
governed surfaces:

- `project-chat-inference` uses project endpoint chat or inference through
  `atm.microsoftFoundryTeamProviderConfig.v1`. Required fields are `surface`,
  `modelId`, `projectEndpointEnvVar`, and `deploymentName`.
- `agent-service` references a service-managed Foundry agent through the same
  config schema. Required fields are `surface`, `modelId`,
  `projectEndpointEnvVar`, and `agentIdEnvVar`.

The shared config shape keeps endpoint and agent identifiers as adopter-repo
environment-variable references. The framework validates the references and the
selected surface, but it does not store project endpoints, tenant values,
agent ids, credentials, or private prompts in this repository.

Foundry bridges still run through `atm.teamProviderContract.v1`, emit
`atm.teamProviderRunArtifact.v1`, and write
`atm.teamAgentObservabilityEvent.v1` records. The artifact records the selected
Foundry surface and the relevant config reference names so replay and
observability can distinguish chat/inference from service-managed agents
without creating a vendor-local lifecycle authority.

Foundry does not self-grant `git.write`, `task.lifecycle`, `file.write`, or
close authority. Broker conflicts must reuse `decisionClass`,
`decisionReason`, `violationStatus`, and `broker-conflict-blocked`, then point
operators to the governed `atm.brokerConflictResolution.v1` resolution lane.

The Foundry execution backend uses the project endpoint reference from
`projectEndpointEnvVar` plus a bearer token from
`AZURE_AI_FOUNDRY_BEARER_TOKEN` / `AZURE_ACCESS_TOKEN`. Chat/inference posts to
the configured deployment chat completions endpoint. Agent-service posts to the
configured service-managed agent id from `agentIdEnvVar`.
`AZURE_AI_FOUNDRY_API_VERSION` may override the default API version. Endpoint,
token, tenant, and agent id values remain outside artifacts; artifacts keep only
the reference names and selected surface.

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
