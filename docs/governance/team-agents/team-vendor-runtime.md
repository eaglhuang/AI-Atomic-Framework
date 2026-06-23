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
- Runtime adapters should consume role and skill-pack semantics from
  `docs/governance/team-agents/role-skill-pack-contract.md` rather than baking
  provider-specific role meanings into the runtime.
- Role-local learning may vary by provider quality or runtime mode, but the
  growth semantics should still reuse
  `docs/governance/skills/shared-growth-contract.md`.
