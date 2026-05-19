# Adopter Sentinel Fixtures

This directory holds **synthetic adopter fixtures** used by
[`scripts/adopter-sentinel.ts`](../../scripts/adopter-sentinel.ts) to smoke
the framework against representative downstream shapes — without leaking any
real adopter identity into the open-source repository.

## Neutrality contract (I4)

Every fixture in this directory MUST satisfy:

1. **No real adopter names.** Use generic placeholders like
   `acme-game`, `example-service`, `demo-adopter`. Do not use 3KLife,
   npc-brain, Cocos, or any other real project name.
2. **No real proprietary identifiers.** No private package names, no real
   internal task IDs, no real branch names that map to a known project.
3. **Shape-faithful only.** The fixture must reproduce the *structural*
   shape of an adopter setup (host repo layout, integration manifest,
   handoff lineage) — not its content.

The neutrality scanner (`validate:neutrality`) covers `fixtures/**` and
will flag any leak before it lands.

## Fixture shapes available

### `synthetic-adopter.fixture.json` (neutral starter)

A minimal representative fixture: bootstrapped repo, one installed
integration adapter, one completed governed task, one piece of evidence.
This is the **canonical neutral shape** new adopter smoke profiles should
start from.

Field reference:

| Field | Meaning |
|---|---|
| `repositoryKind` | One of `javascript-package`, `static-site`, `generic-repository`. |
| `packageManager` | One of `npm`, `pnpm`, `yarn`, `none`. |
| `installedIntegrations` | Array of integration adapter ids the host has installed. |
| `lifecycle.bootstrapAt` | ISO timestamp of bootstrap completion. |
| `lifecycle.firstWelcomedAt` | ISO timestamp of first welcome lineage record. |
| `tasks[]` | Synthetic task records — id, title, status, evidencePath. |
| `evidence[]` | Synthetic evidence records — taskId, evidenceKind, summary. |

## Adding a new fixture

1. Pick a generic placeholder name (e.g. `example-monorepo`).
2. Create `<placeholder-name>.fixture.json` mirroring the schema in the
   existing fixtures.
3. Add a corresponding profile to `scripts/adopter-sentinel.ts` if you want
   it covered by the smoke suite.
4. Run `npm run validate:neutrality` to confirm no leaks.
5. Run `npm run validate:standard` to confirm the fixture parses against
   any schema that references it.

## Why fixtures live here, not in `tests/`

- `tests/` holds executable tests (unit, validator, release-smoke).
- `fixtures/` holds data files those tests + validators read.
- This split mirrors `docs/testing-strategy.md` — the adopter-sentinel
  validator (validator-layer) reads from `fixtures/adopter-sentinel/`.

## Relationship to runtime `.atm/` state

These fixtures are **synthetic** and **stateless**. They do not get copied
into any `.atm/` runtime directory. They are read-only inputs to the
adopter-sentinel smoke and live entirely under version control in this
directory.
