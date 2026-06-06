# Release Parity Gate

Tracked by TASK-ATD-0025.

The framework ships through **four distinct routes**, and each route must
produce the same observable behavior. This document defines the parity
contract and the gate that will enforce it.

## The four release routes

| Route | What ships | Where the code lives | Built by |
|---|---|---|---|
| **source** | the workspace itself (clone + `npm install`) | `packages/**`, `scripts/**`, `atm.mjs` | nothing — checked-in source |
| **root-drop** | a self-contained `.atm/scripts/` + `atm.mjs` bundle for adopter repos | `templates/root-drop/**` | `scripts/build-root-drop-release.ts` → `release/root-drop/` |
| **onefile** | a single-file `atm.mjs` launcher with all dependencies inlined | `release/atm-onefile/atm.mjs` | `scripts/build-onefile-release.ts` |
| **npm** | published `@ai-atomic-framework/*` packages | `packages/*/package.json` | standard `npm publish` flow (currently `private: true`) |

## Parity contract

All four routes MUST satisfy:

1. **CLI surface identity.** `node atm.mjs <command> --json` produces the
   same JSON envelope shape (per-command) regardless of which route
   bootstrapped it. The fixture-pinned codes / exit codes are identical.
2. **Bootstrap reachability.** `node atm.mjs bootstrap --task "..."` works
   from a clean adopter repo regardless of which route delivered the
   `atm.mjs` entry.
3. **Pinned-runner hash agreement.** The `atm.mjs` produced by `root-drop`
   and `onefile` routes must hash-equal the canonical source after building
   from the same commit. Drift here means a build step is non-deterministic.
4. **Schema identity.** All four routes embed (or reference) the same
   `schemas/**/*.json` content. Adopters consuming any route should see
   the same accepted/rejected fixtures.
5. **Telemetry off by default.** No route may flip `telemetry.enabled` to
   true at install time.

## Current validator coverage

Already implemented:

| Validator | Covers |
|---|---|
| `scripts/validate-root-drop-release.ts` | root-drop bundle integrity |
| `scripts/validate-onefile-release.ts` | onefile launcher integrity |
| `scripts/validate-release-trust.ts` | trust manifest / signature surface |
| `scripts/build-release-integrity.ts` | build-step integrity |

Gap: there is no **cross-route parity** validator that runs the same
fixture against all four routes and asserts byte-identical CLI output.

## The proposed gate (TASK-ATD-0025 deliverable)

A new validator, `scripts/validate-release-parity.ts`, would:

1. Construct a parity fixture set (3–5 representative CLI invocations:
   `next`, `doctor`, `welcome --dry-run`, `verify --agents-md`,
   `agent-pack list`).
2. Bootstrap a temp workspace under each route in turn:
   - **source**: use the workspace as-is.
   - **root-drop**: build via `build-root-drop-release.ts`, drop into temp.
   - **onefile**: build via `build-onefile-release.ts`, copy `atm.mjs`.
   - **npm**: skipped while `package.json` is `private: true`; deferred to
     a future card.
3. Run every parity fixture against every route.
4. Diff the JSON envelopes pairwise. Any difference outside of `cwd` and
   timestamp fields fails the gate.
5. Persist a parity report under
   `.atm/history/reports/release-parity/<timestamp>.json`.

## Acceptance gates for landing the validator

1. The parity fixture set is documented in
   `tests/e2e/release-parity.fixture.json` (canonical neutral fixtures —
   no adopter content).
2. `validate-release-parity.ts` runs in `validate:full` (heavy profile),
   not in `validate:quick` (the temp workspace builds take ~30 s each).
3. The first run produces a baseline parity report; subsequent runs gate
   on diff vs that baseline.
4. CI runs the parity gate on every commit touching:
   `packages/cli/**`, `scripts/build-*-release.ts`,
   `templates/root-drop/**`, `release/**`, `schemas/**`.

## Invariant exposure

- **I3** (release artifact deterministic build): the parity gate is the
  enforcement mechanism for I3.
- Indirectly **I1** (public CLI surface stable): the parity gate uses CLI
  output as the diff surface.

## Why deferred to a future implementation card

This card documents the contract. The actual implementation requires:

- Confirming all four build paths produce running artifacts in the current
  baseline (currently blocked by the in-flight `plugin-sdk` merge conflict
  affecting source-route smokes).
- Designing the diff-tolerant comparison (timestamps, absolute paths,
  process exec metadata must be normalized).
- Wiring CI's heavy profile.

Each of those is a separate small card. This document is the spec they
share.

## Related

- [`docs/SELF_HOSTING_ALPHA.md`](./SELF_HOSTING_ALPHA.md) — the smoke that
  feeds the source-route parity baseline.
- [`docs/testing-strategy.md`](./testing-strategy.md) — release-parity sits
  in the `release-smoke` layer.
- [`docs/HOST_GOVERNANCE_INTEGRATION.md`](./HOST_GOVERNANCE_INTEGRATION.md)
  — explains why the framework ships in multiple routes.
