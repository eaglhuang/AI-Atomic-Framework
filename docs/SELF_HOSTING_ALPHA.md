# Self-Hosting Alpha

This document defines the standalone self-hosting alpha proof for ATM.

## Official Single-Entry Prompt

```text
Read README.md. If .atm/config.json is missing, run "node packages/cli/src/atm.mjs bootstrap --cwd . --task \"Bootstrap ATM in this repository\"" from the repository root. Then read AGENTS.md, .atm/profile/default.md, and .atm/tasks/BOOTSTRAP-0001.json, complete the bootstrap task, run the first smoke against examples/hello-world/atoms/hello-world.atom.json, and write artifact, log, evidence, and context summary files under .atm/.
```

## Alpha Checklist

- The user can give the AI one official prompt without explaining internal ATM files.
- If `.atm/config.json` is missing, the AI can trigger the official `bootstrap` command itself.
- The bootstrap command is idempotent and leaves the repository ready for the next step.
- The first smoke validates `examples/hello-world/atoms/hello-world.atom.json` and writes artifact, log, evidence, and context summary files under `.atm/`.
- The proof does not depend on downstream host tooling, private repository paths, or a non-portable adapter.

## Phase B Exit Gate

Run the deterministic alpha0 gate with:

```bash
node packages/cli/src/atm.mjs self-host-alpha --verify --json
```

Phase B may proceed only when all of the following are true:

1. `atm init --adopt --dry-run --json` exits 0 and reports `adoptedAt`.
2. The default bootstrap creates the first task, scope lock, evidence record, and artifact directory.
3. `atm test --atom hello-world --json` reports 5/5 passing smoke checks.
4. `atm verify --neutrality --json` exits 0 on protected framework surfaces.
5. The proof does not rely on any downstream-specific script, engine, or local governance tool.

## Advisory Multi-Agent Confidence

The advisory confidence layer uses the same deterministic alpha0 proof, but records the result under a named agent profile.

```bash
node packages/cli/src/atm.mjs verify --agents-md --json
node packages/cli/src/atm.mjs self-host-alpha --verify --agent claude-code --json
```

Supported profiles and the latest advisory results are tracked in [docs/multi-agent-compatibility-matrix.md](docs/multi-agent-compatibility-matrix.md) and [docs/multi-agent-results.md](docs/multi-agent-results.md). These reports do not block alpha0 release.