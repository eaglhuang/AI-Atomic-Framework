# Architecture

AI-Atomic-Framework is organized around contracts first. Implementations may vary, but the core semantics should remain portable across languages, repositories, and agent environments.

## Layers

### Core Contracts

Core contracts define the data model and lifecycle for AI-governed engineering work:

- `AtomicSpec`: the definition of one atomic unit of work or validation.
- `AtomicRegistry`: the index of known atoms, versions, hashes, and ownership metadata.
- `WorkItem`: the task or request being executed.
- `ScopeLock`: the explicit file, directory, package, or capability scope reserved for a run.
- `Artifact`: generated or preserved output from a run.
- `Evidence`: validation output, logs, screenshots, metrics, or review notes that support completion.
- `ContextSummary`: compact handoff state that lets another agent continue without loading excessive history.
- `AdapterReport`: structured output from host adapters.

Core contracts must not import default plugins, shell out to host project scripts, or assume a repository-specific layout.

### Provisioning Facade Layer

The Provisioning Facade Layer coordinates atom birth. Its first implementation is `AtomGenerator`, registered as `ATM-CORE-0004` and exposed through `atm create`.

This layer sits above the stable primitives: spec parsing, atom-space layout, scaffold building, test reports, registry entry creation, and catalog writing. It may orchestrate those primitives, but it must not redefine their semantics or create a second ID/path/registry implementation.

The CLI is only a facade over this layer. The governed generator atom remains the source of truth for allocation, scaffold orchestration, validation, and registry registration.

Generator provenance is also a first-class registry projection. The catalog exposes whether an atom is `generated`, `backfilled`, or `bootstrap-self`, and `scripts/validate-generator-provenance.ts` keeps that projection honest.

### Evidence-Driven Evolution Layer

The Evidence-Driven Evolution Layer coordinates governed Atom and Atom Map improvement from accumulated usage evidence. It may classify friction signals, group recurring patterns, and draft `UpgradeProposal` documents, but it must not mutate `AtomicRegistry` directly or create a parallel registry, task model, approval workflow, or promotion path.

All promotion decisions remain owned by the existing JSON Schema validators, `ReviewAdvisory`, `HumanReviewDecision`, behavior guards, registry transitions, and mutability policy. The design plan lives in `docs/ATOM_EVOLUTION_PLAN.md`.

### Atomic Map Replacement Surface

Atomic maps may also serve as the governed replacement surface for a larger feature. In that role, a map is more than an atom relationship graph: it carries member roles, edge semantics, feature or legacy entrypoints, equivalence evidence, rollout state, and rollback requirements for the larger capability it represents.

Replacement rollout is tracked separately from registry lifecycle state. The public lane is `draft -> shadow -> canary -> active -> legacy-retired`; registry states such as `validated` or `deprecated` must not be reused as rollout modes.

The public protocol is documented in `docs/MAP_REPLACEMENT_PROTOCOL.md`. Internal implementation task cards should stay in the host workspace that coordinates the work, not in the framework core repository.

### Agent Operating Layer

The Agent Operating Layer teaches a model-neutral agent how to operate inside a repository. It includes instructions, profile files, project probing, first-task creation, run envelopes, and handoff guidance.

This layer exists so a user can drop ATM into a project root and let an AI agent discover the expected workflow before editing files.

#### AtomicCharter Authority

The Agent Operating Layer hosts a framework-level authority document — the **AtomicCharter** — installed at `.atm/charter/atomic-charter.md` alongside a machine-readable companion file `.atm/charter/charter-invariants.json`. The charter sits above host project rules in the authority hierarchy:

```
AtomicCharter (framework layer)     ← highest authority
    ↑ conflicts require waiver flow
host project rules / profiles       ← secondary
    ↑ extends
single-agent / single-user overlays ← lowest
```

`atm doctor` enforces charter integrity through a dedicated `charter-integrity` check. Promotion gates (`atm upgrade --propose`) compare proposed changes against invariants before allowing advancement. Host rule conflicts must be resolved through a `charterWaiver` field in a `behavior.evolve` UpgradeProposal with a linked `HumanReviewDecision`.

The charter is not a `packages/core` contract. It lives entirely in the Agent Operating Layer and is installed by `atm init --adopt default`.

#### Integration Adapter Layer

The Integration Adapter Layer translates ATM's governance entry points into the native skill or instruction format understood by different AI agent environments (such as Claude Code, GitHub Copilot, Cursor, and Gemini). Its typed contract lives in `packages/integrations-core`: adapters expose `install`, `verify`, and hash-guarded `uninstall`, while install output is recorded as an `InstallManifest`. Adapters write integration files to agent-specific directories (`.claude/skills/`, `.github/`, `.cursor/rules/`, `.gemini/`) and record file hashes in `.atm/integrations/manifest.json` to support clean install, verify, and uninstall operations.

The first adapter set lives in separate packages: `integration-claude-code`, `integration-copilot`, `integration-cursor`, and `integration-gemini`. Each package emits the same minimum ATM entrypoints and keeps charter injection as a delivery-time placeholder instead of copying host-specific rule text into framework core.

Integration adapters are a delivery mechanism only. They wrap existing ATM CLI commands and must not introduce a parallel governance model, task store, or approval workflow. All governed actions remain routed through `node atm.mjs next --json`.

### CAR Reporting Lens

ATM can be described through the Harness Engineering CAR lens without changing its core layers:

- Control is represented by specs, rules, locks, validation gates, and explicit scope boundaries.
- Agency is represented by plugins, adapters, capability policies, and the action substrate exposed to an agent.
- Runtime is represented by context summaries, artifacts, logs, reports, evidence, replay, and budget policy.

This is a reporting and documentation lens. It should help adopters produce HarnessCard-style release artifacts, but it must not create a parallel task model or replace `WorkItem`, `ScopeLock`, `Evidence`, `ContextSummary`, or `AdapterReport`.

### Default Governance Bundle

The Default Governance Bundle is the official starter profile for repositories that do not yet have their own governance tooling. It is expected to include replaceable plugins for:

- task cards;
- scope locks;
- document index;
- document shards;
- state files;
- artifacts;
- logs;
- rule guards;
- encoding guards;
- context budget guards;
- validation evidence.

The bundle is a reference implementation. It is not a hard dependency of `packages/core`.

### Plugin SDK

Plugins implement reusable governance capabilities. A plugin may validate rules, write evidence, manage tasks, create shards, collect logs, or summarize context. Plugins consume core contracts and expose predictable reports.

Plugins should not redefine core semantics. They should extend capabilities behind explicit interfaces.

### Adapters

Adapters connect ATM to host systems: local filesystems, Git repositories, issue trackers, CI providers, package managers, language servers, runtime test harnesses, and storage backends.

Adapters translate host-specific reality into core contracts. They should not push host-specific rules back into core.

## Package Boundary Target

The planned package layout is:

```text
packages/core                 core contracts and validation helpers
packages/cli                  command entrypoints and run envelopes
packages/plugin-sdk           plugin interfaces and shared test fixtures
packages/plugin-*             default governance plugins
packages/adapter-*            host storage, source control, and tool adapters
packages/language-*           language or runtime adapters
packages/agent-bootstrap      root-drop instructions and default profile helpers
schemas/                      language-neutral schema files
templates/                    adopter-neutral starter assets
examples/                     self-contained examples
```

The first repository seed may contain only product charter files and validation scaffolding. Package directories should be added by later tasks when their contracts are ready.

## Alpha Path

The alpha0 path is deliberately small:

1. Define seed product boundaries.
2. Establish a monorepo shell and validation commands.
3. Add initial core schemas.
4. Add CLI `init`, `status`, and `validate` stubs.
5. Add a hello-world atom fixture with hash and evidence.
6. Verify that a blank repository can create a task, lock scope, run a guard, and preserve evidence.

Alpha1 can expand the Default Governance Bundle after alpha0 proves the minimal self-hosting path.