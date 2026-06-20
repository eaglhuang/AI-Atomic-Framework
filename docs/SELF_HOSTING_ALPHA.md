# Self-Hosting Alpha

This document defines the standalone self-hosting alpha proof for ATM.

## Official npm Route

ATM upstream development uses npm only for the alpha route. Run `npm install`, `npm run build`, `npm run typecheck`, `npm run lint`, and `npm test` before treating the repo as ready. pnpm/corepack support is intentionally out of scope for this first optimization pass.

## Official Single-Entry Prompt

```text
Read README.md if present, then run "node atm.mjs next --json" from the repository root. If the result includes `ATM_USER_NOTICE` or `evidence.userNotice`, show it to the user before executing the returned next action.
```

## Alpha Checklist

- The user can give the AI one official prompt without explaining internal ATM files.
- If `.atm/config.json` is missing, the AI can trigger the official `bootstrap` command itself through `next`.
- The bootstrap command is idempotent and leaves the repository ready for the next step.
- The bootstrap step seeds `.atm/history/reports/context-budget/bootstrap-bootstrap-BOOTSTRAP-0001.json`, `.atm/history/reports/continuation/BOOTSTRAP-0001.json`, and `.atm/history/handoff/BOOTSTRAP-0001.{json,md}`.
- The first smoke validates `examples/hello-world/atoms/hello-world.atom.json` and writes artifact, log, evidence, context summary, and self-host-alpha reports under `.atm/history/`.
- The proof does not depend on downstream host tooling, private repository paths, or a non-portable adapter.

## Phase B Exit Gate

Before running the deterministic alpha0 gate in the upstream checkout, `node atm.mjs doctor --json` should report `ATM_DOCTOR_OK`.


Run the deterministic alpha0 gate with:

```bash
node atm.mjs self-host-alpha --verify --json
```

Phase B may proceed only when all of the following are true:

1. `atm init --adopt --dry-run --json` exits 0 and reports `adoptedAt`.
2. The default bootstrap creates the first task, scope lock, evidence record, and artifact directory.
3. `atm test --atom hello-world --json` reports 5/5 passing smoke checks.
4. `atm verify --neutrality --json` exits 0 on protected framework surfaces.
5. The proof does not rely on any downstream-specific script, engine, or local governance tool.

## Team Vendor Config Surface

Adopter repositories may keep Team vendor settings under `agent-integrations/vendors/**`.

- ATM may discover and validate this governed config surface.
- The root-drop template documents the layout in `release/atm-root-drop/templates/root-drop/agent-integrations/vendors/README.md`.
- Real secrets stay in the governed adopter repository, not in the framework repository.

## Advisory Multi-Agent Confidence

The advisory confidence layer uses the same deterministic alpha0 proof, but records the result under a named agent profile.

```bash
node atm.mjs verify --agents-md --json
node atm.mjs self-host-alpha --verify --agent claude-code --json
```

Supported profiles and the latest advisory results are tracked in [docs/multi-agent-compatibility-matrix.md](docs/multi-agent-compatibility-matrix.md) and [docs/multi-agent-results.md](docs/multi-agent-results.md). These reports do not block alpha0 release.

## Repository State Semantics for `atm next --json`

`node atm.mjs next --json` behaves differently depending on whether the current directory is a **framework repository**, an **adopter repository**, or an **unbootstrapped repository**. Understanding this distinction prevents misinterpreting `needs-bootstrap` as a bug.

| State | `.atm/config.json` | `next --json` result | exit code | Meaning |
|---|---|---|---|---|
| Framework repo (bare checkout) | absent | `needs-bootstrap` | 1 | Expected: the framework repo is not self-adopted. Maintainers run `self-host-alpha --verify --json` in a temp workspace instead of bootstrapping in place. |
| Adopter repo (bootstrapped) | present | `ready` or `no-work` | 0 | Normal operating state. Execute the returned command. |
| Adopter repo (not yet bootstrapped) | absent | `needs-bootstrap` | 1 | Expected: run `node atm.mjs bootstrap --cwd . --task "Bootstrap ATM"` to initialize. |

### Why `needs-bootstrap` Is Not a Bug in a Framework Checkout

The framework repository is the source of the ATM distribution. Framework maintainers do not commit `.atm/config.json` or other runtime state to the framework repository. Instead:

- Validation of the framework's own self-hosting is done via `node atm.mjs self-host-alpha --verify --json`, which creates a temporary adopter workspace, runs the full bootstrap sequence, and tears it down.
- The `needs-bootstrap` result in a framework checkout is a correct `self-governance diagnosis`, not a silent failure.
- The `reason` field in the JSON output (`".atm/config.json is missing"`) is the authoritative machine-readable explanation.

### M0 Exit Condition

This document satisfies the M0 requirement: `node atm.mjs next --json` returning `needs-bootstrap` in the framework repo is explicitly documented as expected behavior with a clear `reason` field, not a silent failure.

## Self-Governance Example Location Decision

**Decision (TASK-ATD-0003): diagnostic-only — no `.atm.example/` directory and no `examples/self-host/` are created.**

Rationale:

1. The framework repo is not an adopter repo. Committing `.atm/` runtime state to the upstream repository would conflate framework maintenance with adopter adoption. Maintainers who need to run the full bootstrap loop use `self-host-alpha --verify --json` in a temporary workspace.
2. A `.atm.example/` directory would need to be kept manually in sync with CLI and schema changes. The `self-host-alpha --verify --json` command already provides a live, deterministic proof that requires no manual maintenance.
3. Adopter examples live in the `examples/` directory (e.g., `examples/hello-world/`, `examples/agent-bootstrap/`). These are sufficient for downstream adopters to understand the adoption pattern.

### Release Parity Evidence

Release artifact parity (source / root-drop / onefile / npm route) is verified by the standard validator suite:

- `npm run validate:root-drop-release` — verifies `release/atm-root-drop/` layout and smoke behavior
- `npm run validate:onefile-release` — verifies `release/atm-onefile/atm.mjs` layout and smoke behavior
- `npm run validate:self-hosting-alpha` — verifies the self-host-alpha proof in a temp workspace

Release artifacts do not contain maintainer-local runtime state (`.atm/`, `.atm-temp/`, local lock files). This is enforced by the release build process and verified by the release validators.
