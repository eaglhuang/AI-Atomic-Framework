# Broker Shared-Surface Coordination

## Admission First

Before a Team task receives a write lease, Broker evaluates a seven-layer CID
gate trace: intent shape, lease fencing, shared surface ownership, atom ID,
atom CID, read set, and file range. Each gate is emitted as `clear`, `watch`,
or `block` in `atm.brokerConflictMatrix.v1`; this trace is the authority for
the queue decision.

`clear` admits direct parallel work. `watch` records a dependency without
serializing work. A real `block` never permits direct mutation of the affected
surface. It either routes a bounded same-file proposal through compose and the
neutral steward, or creates a queue for the conflicting surface.

The atom ID and CID entries remain the fourth and fifth gates; they are not
global mutexes. A CID write conflict is material only when identity overlap is
paired with a common writable surface (the same target file or a shared
generator, projection, registry, validator, or artifact). Identity overlap
without that surface is retained as an observable relation and does not freeze
independent files. Read-set dependencies remain their own gate.

`next --claim` creates a canonical `atm.writeIntent.v1` transaction before it
claims task lifecycle state or writes a direction lock. The transaction is
stored under `.atm/runtime/broker-intents/` and carries the current `HEAD` as
its base hash. A `queued-private-work` result narrows the later direction lock
to private paths; a `queued-blocked`, malformed, stale, or base-mismatched
result releases the provisional transaction and fails before claim. This keeps
claim, queue position, and writable scope in one admission order.

## Queue Behaviour

The queue is runtime state at `.atm/runtime/broker-shared-surface-queues.json`.
It records the surface path, task and actor, lease epoch, base hash, reason,
release condition, and deterministic position. The existing owner is seeded as
the head before a waiting task is added. Each surface sorts by the same stable
request key (`leaseEpoch`, timestamp, task id), rather than by process arrival
or a global task ordering. A task may implement and validate paths not present
in the queue, but it cannot mutate any queued path until it is head for every
shared surface it needs. Surface keys are acquired in lexical order and no
partial shared-write lease is issued; this removes the hold-and-wait cycle that
causes database deadlocks.

Broker rejects a queue when base hashes differ or the seven-layer gate cannot
identify a bounded shared surface. Re-registration also compares the task's
existing queue entry against its pre-claim transaction base hash; drift fails
closed and requires re-arbitration. Normal delivery release advances only the
head. A terminal abandon/recovery release may remove its own non-head entry,
but may never advance another task's position. Queue state is visible through
`broker status` and `team status`.

## Holder Notification And Handoff

Queueing a later transaction creates one `atm.brokerSharedSurfaceFreeze.v1`
sidecar for each affected current holder. This is a persistence adapter for the
existing `FreezeSignal` / `FreezeAck` protocol, not a second notification or
mailbox contract. The signal names the waiting task, shared path, and the only
two governed next actions: publish an existing `atm.patchProposal.v1` handoff
or release the Broker intent after delivery or terminal archive.

The holder acknowledges with `broker acknowledge --task <holder-task> --actor
<holder-actor> --freeze-id <freeze-id>`. Broker verifies the task and actor
against the signal before recording the canonical ack. Acknowledgement does
not transfer a write lease and does not unlock the path. `broker release` by
the queue head advances the per-file queue; only then may the next task claim
that shared path. Private paths remain independently claimable throughout.

## Compose And Steward

Two bounded `atm.patchProposal.v1` payloads may be composed only when their
target, base hash, anchors, and patch hunks are compatible. The neutral steward
applies only the generated merge plan and preserves apply evidence. Semantic
Markdown backlog edits, JSON owner-map edits, generated files, unbounded
patches, and incompatible anchors remain fail-closed; Broker does not guess a
merge.

## Operator Flow

1. Run `team plan` or `broker decision` and inspect the seven-layer trace.
2. Work directly when every relevant gate is clear.
3. When a bounded shared path blocks, continue private-path work and observe
   its queue position and freeze sidecar with `broker status`.
4. The queue head acknowledges its freeze, then publishes a bounded patch
   proposal or completes its governed delivery.
5. Submit compatible proposals to Broker compose and the neutral steward.
6. Release only the queue head after governed delivery or terminal archive.
7. Escalate semantic conflicts, base drift, and stale leases rather than
   bypassing the queue.

## Structured Admission Decision Logs

`next --claim` renders every candidate conflict decision into one
`atm.nextClaimAdmissionDecisionLog.v1` record owned by
`packages/cli/src/commands/next/claim-conflict-log.ts` (TASK-TEAM-0078). The
record explains, without echoing task body content:

- the seven-layer gate result, in fixed order: claim-intent,
  active-write-conflict, broker-confirmation, mutation-intent, cid-verdict,
  queue-admission, broker-verdict;
- the deterministic, sorted shared-path evaluation order;
- the queue status and waiting position against each shared-surface queue;
- whether a private-path allowance was granted and how many files it covers;
- the block reason on freeze, or the admission reason when admitted.

Blocked claims carry the record in the `ATM_NEXT_CLAIM_BLOCKED` details as
`claimAdmissionDecisionLog`; admitted-with-advisory claims carry it inside the
parallel advisory. `next.ts` only orchestrates the atoms
(`claim-admission.ts`, `broker-queue-admission.ts`, `claim-conflict-log.ts`);
schema keys, gate names, and per-module line budgets (< 600 lines) are pinned
by `node --strip-types scripts/validate-team-agents.ts --case
next-claim-atomization`.

## Proposal-First Plan/Start Parity

`--broker-proposal-file` is accepted by both `team plan` and `team start`
with the same validation contract (TASK-TEAM-0083, backlog
ATM-BUG-2026-07-12-133). A proposal-first block no longer dead-ends at
`proposal-submitted`: the plan response carries a `proposal-first-required`
finding naming the hot files, the required `atm.patchProposal.v1` schema, and
copyable commands — `team plan --broker-proposal-file` for a readiness
preview, `team start --broker-proposal-file` for fail-closed execution, and
`broker runtime activate --proposal-file` for Broker-side pre-activation.
Mismatched, stale, or out-of-scope proposals fail closed on every surface.
