# Canonical Authority Snapshot Charter

`INV-ATM-012` establishes one rule for every ATM authority decision: resolve it
once, bind it to the candidate operation, and make all consumers use that same
fact.

## Required shape

The canonical authority-snapshot module is the only module permitted to combine
ledger claims, runtime locks, lane identity, broker receipts, candidate scope,
expiry, and delegated authority. Its decision must expose the outcome, exact
covered paths/resources, attribution, expiry/freshness, reason codes, and a
digest over the normalized decision.

## Consumer rule

Status, admission, hooks, queueing, runner publication, taskflow, recovery
guidance, and evidence validation consume the decision or verify its digest.
They must not rescan authority stores or recreate scope matching locally.
Recovery guidance is valid only when executing it produces a snapshot accepted
by the next consumer.

## Required parity matrix

Every new consumer must use the shared matrix: no authority, live exact scope,
live partial scope, expired authority, released authority, actor/lane mismatch,
delegated authority, and concurrent state change. A mismatch between canonical
resolution and any consumer is a release-blocking split-brain defect.

## Migration rule

Existing duplicated readers may be migrated incrementally, but a new caller may
not add another reader. Each migration must add a producer/consumer parity test
before deleting the old local inference.

## Fail-fast execution boundary

`INV-ATM-013` requires every consumer to evaluate the snapshot and all other
cheap mandatory preconditions before starting expensive validators, builds,
locks, queues, staging, or writes. A control-plane command must return its
diagnosis and recovery route within five seconds. A capability may be consumed
only after preconditions that do not require that capability are satisfied.
