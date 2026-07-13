# Closure Packet Schema Map

Task: `TASK-RFT-0025`

## Atom

- Owner map: `atm.framework-closure-packet-schema-map`
- Primary pattern: `Result Contract Object`
- Facade: `packages/cli/src/commands/framework-development/closure-packet-schema.ts`
- Owner modules:
  - `packages/cli/src/commands/framework-development/closure-packet/schema-fragments.ts`
  - `packages/cli/src/commands/framework-development/closure-packet/validator-contract.ts`
  - `packages/cli/src/commands/framework-development/closure-packet/diagnostics.ts`

## Boundaries

The extracted fragments define the closure packet result contract, validation result contract, and sha256 diagnostic helper. `closure-packet-schema.ts` keeps the public exports and behavior, so existing imports from `../closure-packet-schema.ts` remain valid.

## Proof

- Focused test: `node --strip-types packages/cli/src/commands/framework-development/__tests__/closure-packet-schema-fragments.spec.ts`
- Repository gates: `npm run typecheck`, `npm run validate:cli`, `git diff --check`
- Atom size gate: `node --strip-types packages/cli/src/commands/git-governance/validate-atom-file-size.ts --max-lines 600 --files packages/cli/src/commands/framework-development/closure-packet/schema-fragments.ts,packages/cli/src/commands/framework-development/closure-packet/diagnostics.ts,packages/cli/src/commands/framework-development/closure-packet/validator-contract.ts,packages/cli/src/commands/framework-development/__tests__/closure-packet-schema-fragments.spec.ts,docs/reports/closure-packet-schema-map.md`

## Out Of Scope

This split does not change closure authority, required gate semantics, schema validation strictness, or public closure packet field names.
