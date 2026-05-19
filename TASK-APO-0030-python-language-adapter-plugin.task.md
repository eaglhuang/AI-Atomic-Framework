# TASK-APO-0030: Python Language Adapter Plugin

## Status

Done.

## Context

Python-only adopters can bootstrap ATM without a `package.json`, but the framework still needs a bundled Python language adapter so candidate ranking can move from advisory inventory to dry-run atomize/infect planning. A partially added `packages/language-python` package also becomes part of the TypeScript workspace, so missing adapter source files can break global typecheck.

## Scope

- Add `@ai-atomic-framework/language-python` as a publishable workspace package.
- Detect Python project profiles from `pyproject.toml`, `requirements.txt`, setup files, Pipfile, lockfiles, and package-manager hints.
- Scan Python imports and module/script entrypoints without executing Python code.
- Validate Python compute atom requests, including entrypoint signature checks and host-supplied forbidden import policy.
- Produce dry-run atomize plans only; apply remains evidence-gated by higher layers.
- Wire runtime readiness and candidate ranking to report bundled Python adapter availability.
- Add deterministic validator coverage through `validate-python-adapter`.

## Acceptance Evidence

- `packages/language-python/src/language-python-adapter.ts` exports the adapter factory and Python-specific scanning/planning helpers.
- `tests/package-skeleton.fixture.json` includes `@ai-atomic-framework/language-python`.
- `package-lock.json` includes the language-python workspace link and package record.
- `scripts/validate-python-adapter.ts` validates profile detection, command wrapping, import scanning, entrypoint detection, forbidden import failure, dry-run planning, and runtime readiness.
- `scripts/validate-guidance.ts` and `scripts/validate-guide.ts` expect bundled Python adapter availability instead of the old missing-adapter state.

## Validation Commands

- `npm run typecheck`
- `npm run validate:python-adapter`
- `npm run validate:guidance`
- `npm run validate:guide`
- `npm run validate:plugin-sdk`
- `node --experimental-strip-types scripts/validate-skew-matrix.ts --mode validate --summary artifacts/skew-summary.json`
