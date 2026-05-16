# AI-Atomic-Framework

[![CI](https://github.com/eaglhuang/AI-Atomic-Framework/actions/workflows/ci.yml/badge.svg)](https://github.com/eaglhuang/AI-Atomic-Framework/actions/workflows/ci.yml)

AI-Atomic-Framework, also called ATM in this repository, is a governance framework for AI-assisted engineering. It is not just an atom runner. It defines how AI work is scoped, locked, validated, evidenced, summarized, and safely handed off across iterations.

The project is designed for AI vibe coding teams that need repeatable engineering control without binding the framework to one model provider, editor, workflow engine, database, or host project.

> Agent first action (required): read this README, then run `node atm.mjs next --json` from repository root, and execute exactly the returned `nextCommand`.

ATM source-tree development now targets Node.js 24 and runs `.ts` modules through `node --experimental-strip-types`. The stable public wrappers remain `atm.mjs`, `release/atm-root-drop/atm.mjs`, and `release/atm-onefile/atm.mjs`.

## Product Charter

ATM provides a neutral work envelope for AI agents and humans:

- break large goals into atomic work items;
- lock the intended scope before editing;
- run deterministic guards before and after changes;
- preserve artifacts, logs, validation evidence, and context summaries;
- keep host-specific adapters out of core contracts;
- let downstream projects replace the default governance profile when they already have their own systems.

The north star for the first release is a blank repository that can run a hello-world atom and leave a minimal task, scope lock, artifact, evidence, and context summary trail.

## For Adopters: 60-Second Drop-In

Use this route when you want to adopt ATM in another repository quickly.

1. Copy one official distribution into the target repository root:
   - `release/atm-root-drop/` for portable multi-file root-drop.
   - `release/atm-onefile/atm.mjs` for a single-file runtime.
2. Give your AI agent one line:

```text
Read README.md if present, then run "node atm.mjs next --json" from the repository root and execute exactly the returned next action.
```

3. The agent will bootstrap when needed, then keep routing through `next`.

### Entry Points

| Entry | Audience | Usage |
| --- | --- | --- |
| `./atm.mjs` | Everyday users and CI in this repository | Root router that uses `packages/cli/src/atm.ts` when source is present, and falls back to `packages/cli/dist/atm.mjs` |
| `packages/cli/src/atm.ts` | Framework contributors | Source CLI entrypoint for local development |
| `release/atm-root-drop/atm.mjs` | Downstream adopters | Portable root-drop bundle entrypoint |
| `release/atm-onefile/atm.mjs` | Downstream adopters | Single-file embedded runtime for zero-dependency distribution |

### Root-Drop Bootstrap

ATM is intended to support a release-bundle root-drop bootstrap workflow.

1. A user places ATM files or an ATM release bundle in a project root.
2. Any AI agent reads this README, the AGENTS template, and the default `.atm/runtime/profile` guidance.
3. The agent probes the project, creates the first task, locks the scope, runs default guards, and stores artifacts, logs, and evidence.
4. The host project may later replace the default filesystem profile with a GitHub, Jira, Linear, Notion, local database, or custom adapter.

The root-drop experience is an Agent Operating Layer. It is intentionally model-neutral and editor-neutral.

For the standalone upstream self-hosting alpha proof, see [docs/SELF_HOSTING_ALPHA.md](docs/SELF_HOSTING_ALPHA.md). That contract upgrades the user-facing flow to a single prompt: the AI checks whether ATM is initialized, runs the official `bootstrap` command only when needed, and then completes the first smoke.

For advisory multi-agent confidence, run `node atm.mjs verify --agents-md --json` and `node atm.mjs self-host-alpha --verify --agent <profile> --json`. The supported profile matrix and latest advisory results live in [docs/multi-agent-compatibility-matrix.md](docs/multi-agent-compatibility-matrix.md) and [docs/multi-agent-results.md](docs/multi-agent-results.md).

For the neutral command-level handoff flow, see [examples/agent-handoff-flow/README.md](examples/agent-handoff-flow/README.md). For behavior naming guidance, see [docs/governance/behavior-taxonomy.md](docs/governance/behavior-taxonomy.md).

### Entry Channels For New Atom Birth

Agents should not need a task card to discover the canonical atom birth path.

- If a downstream host repo already has a task router or task card flow, use that host entry first.
- If there is no task card, or you are operating directly in ATM, run `node atm.mjs guide create-atom`.
- Both paths must converge on the same governed factory: `ATM-CORE-0004` exposed through `atm create`.

This avoids a common failure mode where an agent knows a new atom is needed but does not know which command is the official provisioning path.

## Core, Adapters, and Plugins

ATM separates governance semantics from host implementation details.

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| Core Contracts | Define atomic specs, registry records, scope locks, evidence, artifacts, context summaries, and validation results. | Import a default plugin or assume a specific host project layout. |
| Agent Operating Layer | Provide model-neutral instructions, project probing, first-task creation, and run envelopes for agents. | Bind the workflow to one AI vendor, IDE, or project. |
| Default Governance Bundle | Provide the official starter profile for tasks, locks, document index, shards, state files, artifacts, logs, rule guards, encoding guards, context budget guards, and evidence. | Become a hard dependency of `packages/core`. |
| Plugins | Add replaceable governance capabilities such as task cards, rule guards, context summaries, or evidence collection. | Change the meaning of core contracts. |
| Adapters | Connect ATM to host storage, source control, issue trackers, language tooling, CI, and runtime validators. | Push host-specific behavior back into core. |

The Default Governance Bundle is the official default experience, but it is not a `packages/core` hard dependency. Core defines contracts. The default bundle is a reference implementation of those contracts.

## For Contributors

This repository now uses npm as the single official package-manager route.
For local development against source files, use Node.js 24.

Build and refresh distribution artifacts:

```bash
npm run build
```

Local release entrypoint checks:

```bash
node release/atm-root-drop/atm.mjs next --json
node release/atm-onefile/atm.mjs next --json
```

## Recommended First Implementation

The first implementation is expected to use TypeScript, Node.js, JSON schemas, and a small CLI because those tools make the alpha path easy to inspect and test. That toolchain is a recommendation, not a semantic requirement of ATM. Other language implementations should remain possible if they preserve the same contracts.

## Ecosystem Fit

ATM can coexist with agent frameworks, specification-driven development tools, harness engineering practices, and workflow orchestration engines. It focuses on governance primitives: task scope, lock state, boundary rules, deterministic validation, artifacts, evidence, and handoff context.

See [docs/ECOSYSTEM_POSITIONING.md](docs/ECOSYSTEM_POSITIONING.md) for the positioning details.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the initial architecture and package boundary notes.
Canonical per-atom workspace layout, Atomic ID folder naming, and migration guidance live in [docs/ATOM_SPACE_LAYOUT.md](docs/ATOM_SPACE_LAYOUT.md).
Atomic map replacement semantics live in [docs/MAP_REPLACEMENT_PROTOCOL.md](docs/MAP_REPLACEMENT_PROTOCOL.md).

## Non-Goals

ATM is not trying to be:

- a general-purpose agent framework;
- a workflow engine;
- a prompt marketplace;
- a vector database;
- a model evaluation suite;
- a replacement for host project tests or CI;
- a required dependency for every downstream repository;
- a tool that assumes one programming language, editor, or AI model.

## Validation

### Adopters

Use command-level health checks from the target repository root:

```bash
node atm.mjs doctor --json
node atm.mjs next --json
```

### Contributors

Use engineering signal commands:

```bash
npm test
npm run typecheck
npm run lint
```

Broader governance validators live behind:

```bash
npm run validate:quick
npm run validate:standard
npm run validate:full
```

Protected-surface neutrality rules and migration guidance live in [docs/governance/DOCS_NEUTRALITY_AUDIT.md](docs/governance/DOCS_NEUTRALITY_AUDIT.md).
For host-side enforcement options such as Git hooks, CI gates, branch protection, and review policy, see [docs/HOST_GOVERNANCE_INTEGRATION.md](docs/HOST_GOVERNANCE_INTEGRATION.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
