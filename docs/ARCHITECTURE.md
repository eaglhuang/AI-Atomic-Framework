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

### Agent Operating Layer

The Agent Operating Layer teaches a model-neutral agent how to operate inside a repository. It includes instructions, profile files, project probing, first-task creation, run envelopes, and handoff guidance.

This layer exists so a user can drop ATM into a project root and let an AI agent discover the expected workflow before editing files.

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