# Parallel Governance Charter

> Normative reference for charter invariant **INV-ATM-008 — Broker tickets, not refusals**.
> Ruled by the project owner on 2026-07-17. Amendments require a new owner ruling.

## The Principle

Every step of ATM must support parallel work by independent lane sessions.
When parallel work reaches a **shared write**, it goes through the broker, and
the broker — acting as the parallelism controller — answers with a ticket:

1. **Execute now** — the surface is free.
2. **Queue** — a position, the current head owner, head health, and enqueue
   timestamp are returned. Waiting on a ticket is still parallelism: the
   broker is coordinating multiple tasks on one surface.
3. **Batch** — related work is coalesced into one shared write window.

No governed command may end in a bare refusal for a shared-write conflict.
A blocked caller always receives a ticket with a concrete next step.

Reads never queue. Private writes (an agent's own task ledger, evidence,
task events, lane session records) never queue.

## The Four Standing Exceptions (owner-ruled, closed list)

| # | Exception | Ruling |
|---|-----------|--------|
| R1 | Same task card, second lane session | **Hard reject.** One task card is bound to exactly one lane session for its lifetime. A claim attempt from a different lane session fails with `ATM_LOCK_CONFLICT` — no waitlist, no queue. The only legitimate transfer paths are the existing adopt / takeover flows (TTL expiry or handoff token). |
| R2 | Semantic dependency chains | Dependency gates block **code changes only**, never document writes. While a dependency is unresolved, card fields, blueprints, planning documents, and `docs/**` may be written freely; claims touching code surfaces (`packages/**`, `scripts/**`, build inputs) are blocked until the dependency closes. |
| R3 | Single-branch commit ordering | The single `main` branch makes commit landing an inherent global serialization point. This is the **accepted minimal serial core**. Parallel implementation uses lane sessions, scoped claims, and broker tickets on `main`; feature branches and branch-attached worktrees must not be used to parallelize source development. Detached internal worktrees remain limited to sealed build artifacts, never a source-development lane. Broker batching reduces landing frequency, but batching is only appropriate for **related tasks** (same dispatch wave, compatible surface family); unrelated tasks must not share a commit. |
| R4 | Document writes vs code writes | Document writes are not restricted by parallel governance (that is a document-management concern, outside the broker). Code writes are always governed: claim scope + broker/steward. |

## Obligations on Implementers

- Any gate that today returns a refusal for a shared-write conflict is
  technical debt against this charter, not a design choice.
- Any **new** serialization point must be surfaced to the project owner for an
  explicit ruling before it ships. Exceptions can always be pulled out and
  discussed; they are never silently added.
- Every broker ticket must record `waitedMs` so queue time per wave is a
  measurable optimization target.

## Metric Set (per-wave analyzer output)

| Metric | Source | Direction |
|--------|--------|-----------|
| Max lane concurrency / hard-overlap minutes | lane session events | up |
| Build-free close rate | close `runnerGateDecision` | up |
| Admission false-block rate | empty `intersectingFiles` rejections | to zero |
| Total queue wait (`waitedMs`) per wave | broker ticket events | down |
| Batch rate / builds per wave | batch ticket events | batch up, builds down |
| Cross-lane interventions (e.g. `repair-claim` on foreign lanes) | task events | to zero |
