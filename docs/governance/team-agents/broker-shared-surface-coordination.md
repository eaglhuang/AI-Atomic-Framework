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

Broker rejects a queue when base hashes differ, a non-head task tries to
release, or the seven-layer gate cannot identify a bounded shared surface.
Those cases require re-arbitration or human resolution. Queue state is visible
through `broker status` and `team status`.

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
   its queue position with `team status`.
4. Submit proposals for compatible bounded changes, then use Broker compose and
   the neutral steward.
5. Release only the queue head after governed delivery or terminal archive.
6. Escalate semantic conflicts, base drift, and stale leases rather than
   bypassing the queue.
