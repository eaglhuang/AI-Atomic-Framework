# Testing Strategy

The AI-Atomic-Framework test surface is organized into four layers. Each layer
has a clear purpose, a representative directory, and a representative npm
script. New tests should land in the layer that matches their cost / coverage
trade-off, not in whichever directory feels closest.

| Layer | Purpose | Lives in | Driven by |
|---|---|---|---|
| **unit** | Fast, in-process tests for pure helpers (URN, allocator, shared utilities). No spawning, no filesystem outside `os.tmpdir()`. Single-digit milliseconds per test. | `tests/unit/`, `tests/core/<helper>/` | `npm test` (Node `--test` style) |
| **validator** | Repository-shape and contract validators. Pass/fail is determined by inspecting fixtures, schemas, generated outputs. Most live under `scripts/validate-*.ts` and are wired into `validate:standard`. | `scripts/validate-*.ts`, supporting `tests/<area>/` | `npm run validate:quick` / `validate:standard` |
| **release-smoke** | CLI surface tests that spawn `node atm.mjs <command> --json` and assert on the exit code + JSON shape. Confirms public-facing behavior survives refactors. | `tests/cli/`, `tests/agent-pack/`, `tests/adopter-sentinel/` | `npm run validate:cli` (also part of `validate:standard`) |
| **self-host alpha** | End-to-end "ATM bootstraps itself" smoke against a real temp workspace. Confirms the framework can be installed and verified using its own commands. | `packages/cli/src/commands/self-host-alpha.ts` + temp workspaces under `.atm-temp/` | `npm run validate:self-host-alpha` |

## When to use which layer

- **Adding a pure helper** (date math, path normalization, schema utility) →
  start with a **unit** test under `tests/unit/`.
- **Adding a schema field, fixture, or repository-shape constraint** → add a
  **validator** under `scripts/validate-*.ts` using
  [`scripts/lib/validator-harness.ts`](../scripts/lib/validator-harness.ts).
- **Adding or changing a public CLI subcommand** → extend a **release-smoke**
  fixture under `tests/cli/` to lock the exit code, message code, and JSON
  shape. This protects invariant **I1** (public CLI surface stable).
- **Changing the bootstrap / self-governance loop** → run the **self-host
  alpha** smoke. This is the most expensive layer and the highest signal.

## Speed budget

| Layer | Per-test budget | Total runtime budget |
|---|---|---|
| unit | < 50 ms | < 5 s |
| validator | < 5 s | `validate:standard` < 3 min |
| release-smoke | < 30 s | `validate:cli` < 2 min |
| self-host alpha | < 120 s | full smoke < 5 min |

If a test exceeds its layer budget by more than 2×, either move it down a
layer (faster) or accept it as a layer up (slower but higher coverage).

## Authoring conventions

- **unit** tests use `node:test` + `node:assert/strict`. Avoid jest, vitest, or
  custom assertion DSLs.
- **validator** tests use `createValidator()` from
  [`scripts/lib/validator-harness.ts`](../scripts/lib/validator-harness.ts) to
  get a consistent `assert / fail / ok` surface and a cached AJV.
- **release-smoke** tests use `spawnSync(process.execPath, ['atm.mjs', ...])`
  and parse stdout as JSON. They MUST assert on the exit code AND on at least
  one stable field of the JSON shape.
- **self-host alpha** lives behind a single command; do not duplicate its
  setup into other test directories.

## Related documentation

- [`scripts/lib/validator-harness.ts`](../scripts/lib/validator-harness.ts) —
  shared scaffolding for validator-layer scripts.
- [`docs/SELF_HOSTING_ALPHA.md`](./SELF_HOSTING_ALPHA.md) — self-host smoke
  contract.
- [`docs/HOST_GOVERNANCE_INTEGRATION.md`](./HOST_GOVERNANCE_INTEGRATION.md) —
  what the framework enforces vs what hosts opt into.
