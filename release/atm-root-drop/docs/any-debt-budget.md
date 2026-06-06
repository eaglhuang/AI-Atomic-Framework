# `any` Debt Budget

The AI-Atomic-Framework treats every `any` in TypeScript as a measurable
debt. This document defines the budget, the layered policy, and the
ratchet strategy.

## Current baseline (snapshot)

Measured on the M3 baseline pass:

| Scope | `any` occurrences | Files |
|---|---:|---:|
| `packages/**/*.ts` | 734 | 82 |

This counts `any` annotations, `as any` casts, and `<any>` type
parameters. Comments and string literals are excluded.

The baseline is the **ceiling** — no new code may push it higher without
an explicit waiver.

## Budget by layer

| Layer | Budget | Rationale |
|---|---|---|
| **Public contract** (`packages/*/src/index.ts`, types re-exported from `index.ts`, schema types) | **0** | Every public symbol must be typed. `any` here breaks downstream callers. |
| **Package runtime** (`packages/*/src/**/*.ts` excluding tests) | **≤ current count, ratchet only** | New code typed; existing `any` removed opportunistically. |
| **Tests** (`tests/**/*.ts`, `**/*.test.ts`) | Unbudgeted | Tests construct fixtures and assert with type-narrowing helpers; `any` is acceptable. |
| **Scripts** (`scripts/**/*.ts`) | Unbudgeted, but **prefer `unknown`** | Validator scripts manipulate JSON; `unknown` + narrow is cleaner than `any`. |

## Ratchet policy

The budget moves in one direction: down. Specifically:

1. A change MAY introduce `any` only if it removes ≥1 existing `any` in the
   same change (net non-positive delta on `packages/**`).
2. A change MUST NOT introduce `any` in public-contract files. Exceptions
   require an `// eslint-disable-next-line @typescript-eslint/no-explicit-any --
   reason: <waiver-id or rationale>` annotation plus a follow-up card.
3. PRs SHOULD prefer `unknown` over `any` for inputs of unknown shape, and
   typed narrowing helpers over `as any` casts.

## Why not enforce hard via ESLint today

The `@typescript-eslint/no-explicit-any` rule exists and is the right tool,
but enforcing it as `error` immediately would block 734 sites at once. The
chosen approach is **progressive ratchet**:

- **Step 1 (this card):** Document the budget + baseline.
- **Step 2 (future card):** Add `@typescript-eslint/no-explicit-any: 'warn'`
  scoped to `packages/*/src/**` (excluding tests). New `any` produces a
  warning; existing ones stay quiet.
- **Step 3 (future card, per package):** Convert a package's `any` to
  proper types, then flip the rule to `error` for that package's source.
  This shrinks the budget package-by-package.

Doing all three at once breaks CI and discourages contributors. Doing them
in sequence lands as three small, reviewable PRs.

## What "public contract" means concretely

A symbol is public-contract iff one of:

- it is exported from a package's `index.ts` (top-level re-export);
- it is a type referenced in a schema under `schemas/**`;
- it is a field in a JSON envelope persisted under `.atm/runtime/**` or
  `.atm/history/**`;
- it appears in the CLI `--json` envelope as a documented field.

Public-contract changes must follow the schema/CLI versioning rules in the
related invariants (**I1**, **I2**, **I5**).

## How to check

```bash
# Total any count across packages (current ceiling).
rg -t ts ':\s*any[\s,;)\]\|=}>]|<any[,>]|as\s+any' packages | wc -l

# any count for a specific package — track this over time.
rg -t ts ':\s*any[\s,;)\]\|=}>]|<any[,>]|as\s+any' packages/cli | wc -l

# Public-contract files — these MUST be zero.
rg -t ts ':\s*any[\s,;)\]\|=}>]|<any[,>]|as\s+any' packages/*/src/index.ts
```

A future CI gate can run the first command and fail if it exceeds the
recorded baseline.

## Waiver process

If a single PR needs `any` in a public-contract file (genuinely
impossible-to-type case like dynamic import dispatch):

1. Add the disable comment with a rationale.
2. Open a follow-up card under `tasks/` for the cleanup.
3. Reference the card id in the disable comment.

Without a tracked follow-up, the disable is rejected at review.

## Related

- Invariant **I1** (public CLI surface stable).
- Invariant **I2** (schema additive-first).
- [`docs/cli-error-policy.md`](./cli-error-policy.md) — typed `code` /
  exit code policy.
- [`docs/testing-strategy.md`](./testing-strategy.md) — where typed unit
  tests live.
