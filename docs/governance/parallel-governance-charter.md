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

## Canonical Execution Substrate

`INV-ATM-010` defines the normal substrate for governed parallel development:
one canonical worktree, base, and HEAD. Physical path equality is not a conflict
decision. Workers declare bounded atom/CID/content-anchor/source-range intents
and submit proposals; the broker, format adapter, and transactional composer
decide whether the proposals can share one compose batch.

For a compatible batch, the neutral steward is the only component that mutates
the shared file in the canonical worktree. The shared-delivery adapter then
records before/after digests, serializability evidence, and every member's
attribution in one delivery. A worker may use a bounded non-Git proposal carrier
but must not use a Git branch, detached worktree, alternate index, merge, or
rebase as a normal isolation mechanism.

Queueing or revalidation is reserved for true logical conflicts, stale base/CAS
failures, unsupported adapters, and fairness bounds. A safe same-file compose
is allowed to have zero queue residency; path-only serialization is not evidence
of successful parallel governance.

The only execution-substrate exceptions are `emergency-anomaly-recovery`,
`historical-read-only-discrimination`, and `non-development-sealed-packaging`.
Each requires a named receipt, is fail-closed for unknown reasons, and cannot
perform normal governed contribution writes.

## CLI

```bash
node atm.mjs broker parallel-admission status --json
node atm.mjs broker parallel-admission set --mode enforce --fallback-mode queue-only --json
node atm.mjs broker parallel-admission trip --actor <actor-id> --reason "<gate failure>" --json
node atm.mjs broker parallel-admission reset --actor <actor-id> --receipt-digest sha256:<digest> --json
```

`reset` must cite a fresh passing evidence digest. This keeps circuit-breaker
recovery auditable instead of letting a shared-write gate silently resume.
