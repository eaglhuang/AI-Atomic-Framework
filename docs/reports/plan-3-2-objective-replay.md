# Plan 3.2 objective replay

Status: not complete.

This artifact is a fail-closed replay surface for Plan 3.2. It proves that the current denominator is exactly 29 objectives and that every objective has a machine-readable evidence tuple, owning task, blocker, and next safe command. It does not certify Plan 3.2 complete.

Machine source: `docs/reports/plan-3-2-objective-replay.json`

Validation:

- `node --strip-types scripts/validate-four-plan-objectives.ts --plan 3.2 --mode validate`
- `node --strip-types scripts/validate-atm-3-final-closure.ts --mode validate --plan 3.2 --expect-rows 29 --input docs/reports/plan-3-2-objective-replay.json`
- `node --strip-types tests/cli/atm-3-final-closure.test.ts`

Summary:

- Denominator: 29
- Verified rows: 0
- Not-complete rows: 29
- Verdict: `not-complete`

The important invariant is negative: missing, unknown, stale, historical-only, or caller-asserted evidence cannot become a green Plan 3.2 certification.
