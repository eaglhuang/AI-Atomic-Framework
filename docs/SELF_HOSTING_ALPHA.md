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

Phase B may proceed only when all of the following are true:

1. `bootstrap`, `status`, and `validate` all return machine-readable JSON in standalone mode.
2. The official single-entry prompt is documented and deterministic.
3. A clean standalone copy of the upstream repository can bootstrap itself and complete the first smoke.
4. Protected-surface docs neutrality passes for README, docs, examples, and templates before the alpha gate is considered green.
5. The generated task, scope lock, evidence record, artifact, log, and context summary all exist after the smoke.
6. The proof does not rely on any downstream-specific script, engine, or local governance tool.