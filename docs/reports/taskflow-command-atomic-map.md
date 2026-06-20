# Taskflow Command Atomic Map

Owner map: `atm.taskflow-close-production-map`

## Facade

- `packages/cli/src/commands/taskflow.ts`
  - parses `taskflow open|pre-close|close`
  - keeps public JSON contracts stable
  - delegates close production atoms instead of owning the whole close body inline

## Close Atoms

- `packages/cli/src/commands/taskflow/close-preflight.ts`
  - declared-file extraction
  - planning-authority delivery checks
  - historical pre-close blocker normalization

- `packages/cli/src/commands/taskflow/write-readiness.ts`
  - `writeReadinessHint` assembly
  - blocker code preservation
  - close actor / historical waiver / broker / branch queue aggregation

- `packages/cli/src/commands/taskflow/broker-gate.ts`
  - broker conflict readout
  - stale lease and stale epoch takeover detection

- `packages/cli/src/commands/taskflow/branch-commit-queue-gate.ts`
  - branch commit queue lock diagnostics

- `packages/cli/src/commands/taskflow/closeback-orchestration.ts`
  - planning mirror closeback helpers
  - roster path resolution
  - facade bridge to existing close orchestration surface

- `packages/cli/src/commands/taskflow/commit-bundle-assembly.ts`
  - governed commit bundle preview
  - deferred governance dirty snapshot / restore
  - delivery commit and final bundle commit staging helpers

## Validation Map

- fast regression lane
  - `packages/cli/src/commands/taskflow/__tests__/close-gates-focused.spec.ts`
  - `packages/cli/src/commands/taskflow/__tests__/close-preflight.spec.ts`
  - `packages/cli/src/commands/taskflow/__tests__/write-readiness.spec.ts`

- production atom lane
  - `packages/cli/src/commands/taskflow/__tests__/closeback-orchestration.spec.ts`
  - `packages/cli/src/commands/taskflow/__tests__/commit-bundle-assembly.spec.ts`

- representative integrated lane
  - `packages/cli/src/commands/taskflow/__tests__/taskflow-dryrun.spec.ts`

## Tripwire

- `scripts/validate-taskflow-size-tripwire.ts`
  - `taskflow.ts` must stay at or below `2200` lines

- `scripts/validate-taskflow-atomic-map.ts`
  - validates this report still names the facade and all six close atoms
