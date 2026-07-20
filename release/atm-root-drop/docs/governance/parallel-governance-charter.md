# Parallel Governance Charter

`atm.parallelAdmissionPolicy.v1` defines the framework-level boundary between
hard lifecycle exceptions and ticketed shared-write surfaces.

## Policy Defaults

- `mode`: `enforce`
- `circuitBreakerEnabled`: `true`
- `fallbackMode`: `queue-only`
- rollout scope: runner sync, builds, release mirrors, projections, generated
  writes, checkpoints, closeback, and governed git commits

## Gate Classes

R1 same-task second-lane writes and R2 dependency gates are hard exceptions.
They cannot be relaxed by policy configuration because they protect task
lifecycle ownership and dependency truth.

R3 shared-write surfaces and R4 shared side effects are ticketed shared-write
gates. They must expose an owner, adapter, status command, next action, and
recovery command. When the policy is tripped, these gates fall back to
queue-only admission until reset with fresh passing evidence.

## CLI

```bash
node atm.mjs broker parallel-admission status --json
node atm.mjs broker parallel-admission set --mode enforce --fallback-mode queue-only --json
node atm.mjs broker parallel-admission trip --actor <actor-id> --reason "<gate failure>" --json
node atm.mjs broker parallel-admission reset --actor <actor-id> --receipt-digest sha256:<digest> --json
```

`reset` must cite a fresh passing evidence digest. This keeps circuit-breaker
recovery auditable instead of letting a shared-write gate silently resume.
