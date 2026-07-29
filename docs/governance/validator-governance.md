# Validator governance migration guide

`TASK-SKL-0030` publishes the measured verdict for moving from legacy
all-run-per-card validation to the causal selector plus phase-suite ownership.
The verdict artifact is
`artifacts/generated/atm-validator-governance-verdict.json`.

## Verdict

The measured recommendation is
`promote-causal-selector-through-shadow-canary`.

The replay compares the same historical candidates, test versions, environment
seal, and adapter projection set for both strategies. The causal strategy
reduces selected validation work and latency while keeping escaped defects at
zero. Runtime improvement is not allowed to pass if defect detection regresses.

## Shadow mode

Run the causal selector beside the legacy all-run decision and record both
selected case sets, latency, cache reuse, phase detection, false blocks, flaky
cases, and escaped-defect counters. Shadow mode must reject a zero-test false
green and stale receipt reuse before any promotion.

## Canary promotion

Promote only adapters whose projection conforms to the same verdict contract.
The supported adapter projection set is Codex, Claude Code, Cursor, Copilot,
Gemini, and Antigravity. Canary adoption should start with tasks that have a
sealed required-case contract and known causal impact edges.

## Full rollback

Rollback is `revert-commit-and-retain-legacy-all-run-default`. If a canary shows
escaped-defect regression, stale receipt reuse, or adapter projection drift,
switch the runtime default back to legacy all-run and keep the verdict artifact
as rollback evidence.

## Plan 3.1 final-verdict consumption

Plan 3.1 consumes this verdict as the SKL historical A/B evidence input for the
final governance verdict. Downstream final-verdict readers should depend on the
artifact schema and measured recommendation, not on local paths, host names, or
the prose in this guide.
