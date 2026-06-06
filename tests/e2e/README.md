# End-to-End Tests

Tracked initially by TASK-ATD-0032 (root-drop sandbox E2E).

This directory holds **end-to-end smokes** that bootstrap ATM into a real
temp workspace and exercise the full installed-artifact contract. They sit
above the validator layer in `docs/testing-strategy.md` because they
spawn the CLI from a built artifact, not from source.

## Scope

E2E smokes verify:

1. The release artifact (root-drop bundle, onefile launcher) actually
   bootstraps a fresh repository.
2. After bootstrap, the installed `atm.mjs` answers `next --json` with the
   expected envelope shape.
3. Adopter-facing commands (`doctor`, `welcome --dry-run`, `agent-pack
   list`, `verify --agents-md`) survive in the installed artifact.
4. The install + uninstall + re-install roundtrip leaves the workspace in
   a clean state.

## Planned smokes (TASK-ATD-0032)

### `root-drop-sandbox.e2e.test.ts`

Bootstraps the root-drop bundle into a `mkdtempSync`-created workspace and
runs a fixed sequence of CLI commands. Assertions:

| Step | Command | Assertion |
|---|---|---|
| 1 | drop the built bundle into the workspace | files copied, `atm.mjs` executable |
| 2 | `node atm.mjs bootstrap --task "..."` | exit 0, `.atm/` populated |
| 3 | `node atm.mjs next --json` | exit 0, JSON parses, `evidence.nextAction.status` set |
| 4 | `node atm.mjs doctor --json` | exit 0, `evidence.checks[]` array present |
| 5 | `node atm.mjs welcome --dry-run --json` | exit 0, `evidence.atmChart` present |
| 6 | `node atm.mjs verify --agents-md --json` | exit 0, `ok: true` |
| 7 | (teardown) | workspace removed cleanly |

### `onefile-sandbox.e2e.test.ts`

Same shape as root-drop but uses `release/atm-onefile/atm.mjs` as the
single source-of-truth file. Validates that the onefile launcher is
equivalent to the root-drop bundle for the same fixed command sequence.

### `release-parity-comparison.e2e.test.ts` (depends on TASK-ATD-0025)

Runs the same fixed sequence against (a) the source workspace, (b) the
root-drop bundle in a temp workspace, (c) the onefile launcher in a
separate temp workspace. Diffs the JSON envelopes pairwise. Drops the
`cwd` and timestamp fields before diffing.

## Conventions

- E2E test files end in `.e2e.test.ts` (not `.test.ts`) so they can be
  filtered separately from validator-layer tests.
- They use `node:test` + `node:assert/strict` like unit tests, but with
  longer per-test timeouts (~120 s).
- Temp workspaces live under `os.tmpdir()/atm-e2e-<smoke>-<random>` and
  are cleaned up in `after()` regardless of pass/fail.
- E2E smokes do NOT run in `validate:quick` (too slow). They run in
  `validate:full` and on every commit touching `release/**`,
  `templates/root-drop/**`, or `scripts/build-*-release.ts`.

## Why this directory exists now

The directory and this README are landed as part of TASK-ATD-0032's plan
phase. Actual smoke implementations come in a follow-up card once:

1. The pre-existing `packages/plugin-sdk/src/*` merge conflict is
   resolved (currently breaks the source-tree CLI smokes, which means E2E
   smokes can't establish a baseline).
2. The release-parity gate from TASK-ATD-0025 lands so the cross-route
   comparison has its diff-tolerant comparator.

## Invariant exposure

- **I3** (release artifact deterministic build): E2E smokes are the
  highest-confidence gate for I3.
- **I1** (public CLI surface stable): the fixed command sequence locks
  what an installed artifact must respond with.

## Related

- [`docs/release-parity-gate.md`](../../docs/release-parity-gate.md) — the
  parity gate this directory's smokes will eventually contribute to.
- [`docs/testing-strategy.md`](../../docs/testing-strategy.md) — E2E sits
  above the validator layer.
- [`docs/release-trust-ops.md`](../../docs/release-trust-ops.md) — the
  continuous verification recipe that consumes E2E results.
