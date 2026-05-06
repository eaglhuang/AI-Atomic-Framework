# AI-Atomic-Framework

AI-Atomic-Framework, also called ATM in this repository, is a governance framework for AI-assisted engineering. It is not just an atom runner. It defines how AI work is scoped, locked, validated, evidenced, summarized, and safely handed off across iterations.

The project is designed for AI vibe coding teams that need repeatable engineering control without binding the framework to one model provider, editor, workflow engine, database, or host project.

## Product Charter

ATM provides a neutral work envelope for AI agents and humans:

- break large goals into atomic work items;
- lock the intended scope before editing;
- run deterministic guards before and after changes;
- preserve artifacts, logs, validation evidence, and context summaries;
- keep host-specific adapters out of core contracts;
- let downstream projects replace the default governance profile when they already have their own systems.

The north star for the first release is a blank repository that can run a hello-world atom and leave a minimal task, scope lock, artifact, evidence, and context summary trail.

## Root-Drop Bootstrap

ATM is intended to support a root-drop, zero-install agent bootstrap workflow.

1. A user places ATM files or an ATM release bundle in a project root.
2. Any AI agent reads this README, the AGENTS template, and the default `.atm/profile` guidance.
3. The agent probes the project, creates the first task, locks the scope, runs default guards, and stores artifacts, logs, and evidence.
4. The host project may later replace the default filesystem profile with a GitHub, Jira, Linear, Notion, local database, or custom adapter.

The root-drop experience is an Agent Operating Layer. It is intentionally model-neutral and editor-neutral.

### Zero-Install Quick Start

From an ATM checkout or release bundle, initialize a host repository with the default bootstrap pack:

```bash
node packages/cli/src/atm.mjs bootstrap --cwd <host-repo> --task "Bootstrap ATM in this repository"
```

Then give the AI agent one line only:

```text
Read README.md if present, then read AGENTS.md, .atm/profile/default.md, and .atm/tasks/BOOTSTRAP-0001.json. Continue the bootstrap task without changing the host workflow, and write evidence to .atm/evidence/BOOTSTRAP-0001.json.
```

The bootstrap pack writes the default profile, a first task, a scope lock, default guard definitions, and artifact/log/evidence directories so the host repository does not need to become a Node.js project first.

For the standalone upstream self-hosting alpha proof, see [docs/SELF_HOSTING_ALPHA.md](docs/SELF_HOSTING_ALPHA.md). That contract upgrades the user-facing flow to a single prompt: the AI checks whether ATM is initialized, runs the official `bootstrap` command only when needed, and then completes the first smoke.

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

## Recommended First Implementation

The first implementation is expected to use TypeScript, Node.js, JSON schemas, and a small CLI because those tools make the alpha path easy to inspect and test. That toolchain is a recommendation, not a semantic requirement of ATM. Other language implementations should remain possible if they preserve the same contracts.

## Ecosystem Fit

ATM can coexist with agent frameworks, specification-driven development tools, harness engineering practices, and workflow orchestration engines. It focuses on governance primitives: task scope, lock state, boundary rules, deterministic validation, artifacts, evidence, and handoff context.

See [docs/ECOSYSTEM_POSITIONING.md](docs/ECOSYSTEM_POSITIONING.md) for the positioning details.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the initial architecture and package boundary notes.

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

This seed repository keeps validation dependency-free while the monorepo skeleton is still forming:

```bash
npm test
npm run typecheck
npm run lint
```

These commands validate the product charter files, required positioning language, and protected-surface boundary terms.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
