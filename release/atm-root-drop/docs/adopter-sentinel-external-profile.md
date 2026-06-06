# Adopter Sentinel — External Profile as Downstream Evidence

Tracked by TASK-ATD-0029.

The adopter-sentinel smoke (`scripts/adopter-sentinel.ts`) currently runs
**three built-in profiles** (`vscode`, `cursor`, `claude-code`) against
ephemeral temp workspaces. They prove the framework's downstream-facing
contract works from a clean baseline.

This card defines a **fourth profile mode** — `external` — that lets a
downstream adopter contribute their sandbox smoke as **upstream-friendly
evidence** without leaking proprietary identity.

## The pattern

Today an adopter who wants to confirm "ATM still works for me" has two
options:

1. Run the built-in smokes locally. Useful but doesn't surface to upstream.
2. File a bespoke GitHub issue describing their setup. Useful but not
   reproducible by the framework maintainers.

The external profile bridges these. An adopter:

1. Writes a **neutral fixture** matching the
   [`synthetic-adopter`](../fixtures/adopter-sentinel/) shape.
2. Runs `node scripts/adopter-sentinel.ts --mode validate --fixture external --profile <neutral-id>`.
3. Files the **fixture + result JSON** as a GitHub issue (no proprietary
   content needed, because the fixture is neutral).

Upstream maintainers replay the fixture locally and either accept it into
`fixtures/adopter-sentinel/` (becoming a permanent regression case) or
reject with a specific reason the adopter can address.

## Fixture neutrality contract

External-profile fixtures MUST satisfy the same neutrality rules as
internal ones — see
[`fixtures/adopter-sentinel/README.md`](../fixtures/adopter-sentinel/README.md):

1. No real adopter / product / engine names.
2. No proprietary internal identifiers.
3. Shape-faithful only — reproduces the structural shape, not content.

If a fixture violates these, `validate:neutrality` flags it and the
maintainer rejects with the specific scanner code.

## How upstream replays an external fixture

1. Apply the proposed `external-<id>.fixture.json` to a local checkout
   under `fixtures/adopter-sentinel/external/`.
2. Run:
   ```bash
   node scripts/adopter-sentinel.ts --mode validate --fixture external --profile <id>
   ```
3. Compare the result envelope's `confidenceReady`, `steps[]`, and
   `workspaceCreated` fields to the adopter-supplied report.
4. If reproducible and useful, promote into the canonical fixtures and
   close the issue with a permalink to the merged fixture.

## What "useful" means here

A useful external profile:

- **Surfaces a real gap.** The adopter found something the built-in
  profiles (`vscode` / `cursor` / `claude-code`) don't cover.
- **Is minimal.** The smallest fixture that reproduces the gap, not the
  adopter's whole repo shape.
- **Is reproducible cold.** A fresh checkout + `node scripts/adopter-sentinel.ts`
  produces the same result envelope every time.

## Why the evidence loop matters

Upstream-friendly artifacts are the only way downstream usage can shape
the framework without privileged access. The external profile turns
"adopter X has a problem" into "fixture X covers a regression case" — a
durable artifact future contributors can rely on.

This is the M5 evidence loop in concrete form: downstream usage produces
fixtures, fixtures produce regressions, regressions produce framework
fixes, framework fixes ship in the next release, and the loop closes.

## Invariant exposure

- **I4** (neutrality): external profiles must pass the same neutrality
  scan as everything in `fixtures/**`. The scanner already covers
  `fixtures/adopter-sentinel/external/` automatically.

## Implementation note for the runner

`scripts/adopter-sentinel.ts` already has the `--fixture` flag and a
`broken` branch as proof-of-concept. Adding `--fixture external` means:

1. Parse a `--profile <id>` companion flag.
2. Load `fixtures/adopter-sentinel/external/<id>.fixture.json`.
3. Run the same smoke shape (`runSentinelProfile`) but seed the temp
   workspace from the fixture's `installedIntegrations` + `lifecycle`
   fields.
4. Emit the result envelope under
   `.atm/history/reports/adopter-sentinel-external/<id>/<timestamp>.json`.

Roughly ~60 lines added to `adopter-sentinel.ts`. The fixture loader can
reuse the existing JSON schema for `synthetic-adopter.fixture.json`.

## Why deferred to a future implementation card

This card documents the contract. The actual runner code change requires:

- Adding the `--profile` flag and the external fixture loader.
- A reference external fixture (one neutral example to bootstrap the
  workflow).
- A regression test exercising the external path.

Each piece is small but they cross-cut `scripts/`, `fixtures/`, and
`tests/`. They land together once the baseline plugin-sdk conflict is
resolved.

## Related

- [`fixtures/adopter-sentinel/`](../fixtures/adopter-sentinel/) — the
  neutral fixture contract.
- [`docs/LONGTAIL_USERS.md`](./LONGTAIL_USERS.md) — the broader policy for
  downstream evidence feeding upstream.
- [`docs/HOST_GOVERNANCE_INTEGRATION.md`](./HOST_GOVERNANCE_INTEGRATION.md)
  — the cooperation boundary this evidence loop reinforces.
