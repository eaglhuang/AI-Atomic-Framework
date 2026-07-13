# Tasks Legacy Compatibility Map

Task: `TASK-RFT-0024`

## Atom

- Owner map: `atm.tasks-legacy-compat-map`
- Primary pattern: `Strategy Map`
- Facade: `packages/cli/src/commands/tasks/legacy-impl.ts`
- Owner module: `packages/cli/src/commands/tasks/legacy/compat-command-map.ts`

## Boundaries

`legacy-impl.ts` remains the public compatibility facade for `tasks` command exports and historical helper exports. The command route table now delegates through `runTasksCompatCommandMap`, while the repair/reconcile and transition command clusters are named lanes:

- `packages/cli/src/commands/tasks/legacy/repair-reconcile-lane.ts`
- `packages/cli/src/commands/tasks/legacy/transition-compat.ts`

The split keeps task storage, lifecycle authority, and existing CLI command names unchanged.

## Proof

- Focused test: `node --strip-types packages/cli/src/commands/tasks/__tests__/legacy-compat-command-map.spec.ts`
- CLI regression: `node --strip-types scripts/validate-task-import.ts`
- Ledger regression: `node --strip-types scripts/validators/task-ledger/suite-impl.ts`
- Repository gates: `npm run typecheck`, `npm run validate:cli`
- Atom size gate: `node --strip-types packages/cli/src/commands/git-governance/validate-atom-file-size.ts --max-lines 600 --files packages/cli/src/commands/tasks/legacy/compat-command-map.ts,packages/cli/src/commands/tasks/legacy/repair-reconcile-lane.ts,packages/cli/src/commands/tasks/legacy/transition-compat.ts,packages/cli/src/commands/tasks/__tests__/legacy-compat-command-map.spec.ts,docs/reports/tasks-legacy-compat-map.md`

## Follow-Up

The parser/importer and roster update blocks inside `legacy-impl.ts` are still large. They should be split only under separate task cards because they own Chinese task-card parsing and legacy import compatibility.
