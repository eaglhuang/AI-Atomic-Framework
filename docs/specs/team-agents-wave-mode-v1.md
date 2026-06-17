# Team Agents Wave Mode v1

Status: draft
Spec id: `atm.team-agents-wave-mode.v1`
Owner map: `atm.team-agents-wave-mode-spec-map`

## 1. Purpose

Team Agents Wave Mode is the official way to make multi-card batch work fast
without bypassing ATM governance. A *wave* is a set of task cards that a
coordinator schedules to run together because they are safe to advance in
parallel. Wave Mode coordinates execution; it does **not** introduce a second
task lifecycle, a second evidence format, or a second git-write path.

This is explicitly **not** a separate batch-writer system. Wave Mode is an
admission-and-scheduling layer on top of the existing surfaces:

- the batch queue (`batch plan` / `batch status` / `batch checkpoint`),
- Broker admission and the logical conflict matrix,
- patch envelopes,
- governed evidence,
- the existing task lifecycle (`taskflow open` / `taskflow close`).

If Wave Mode and the existing close path ever disagree, the existing close path
wins. Wave Mode never closes a card by itself.

## 2. Relationship to existing surfaces

```
                 ┌─────────────────────────────────────────┐
                 │            Team Agents Wave Mode          │
                 │  (candidate planning + admission + slice) │
                 └───────────────┬───────────────┬──────────┘
                                 │               │
                  schedules waves │               │ requests admission
                                 ▼               ▼
        ┌──────────────┐   ┌───────────┐   ┌──────────────────┐
        │  batch queue │   │  Broker   │   │  patch envelope  │
        │ (queue head) │   │ admission │   │   (per worker)   │
        └──────┬───────┘   └─────┬─────┘   └────────┬─────────┘
               │                 │                  │
               ▼                 ▼                  ▼
        ┌─────────────────────────────────────────────────────┐
        │      governed evidence  +  checkpoint / close        │
        │   (batch checkpoint / taskflow close = authority)    │
        └─────────────────────────────────────────────────────┘
```

- **Team Agents** propose a wave and may coordinate workers, but each task still
  flows through its own claim, evidence, and close. Team Agents do not own task
  lifecycle or git writes.
- **Batch queue** remains the queue-head bookkeeping surface. A wave maps onto
  one or more queue heads; it never replaces the queue.
- **Broker admission** decides whether the candidate wave is safe to run in
  parallel using the existing logical conflict matrix.
- **Patch envelopes** describe each worker's intended change set so admission and
  evidence slicing can reason about scope before any write.
- **Evidence + checkpoint/close** are unchanged. `batch checkpoint` or the
  existing close path is the final lifecycle authority.

## 3. Roles

- **Coordinator**: the only role permitted to run git writes and to drive
  checkpoint/close. Exactly one coordinator per wave.
- **Worker**: implements deliverables for a single card and reports a worker
  report. Workers never close cards or commit.
- **Validator/Reviewer (optional)**: advisory roles that read worker output and
  raise findings. They do not gate the lifecycle beyond the normal validators.

## 4. Wave candidate model

A wave candidate is a set of cards `{T1..Tn}` plus, for each card, its declared
scope paths, deliverables, validators, target repo, and closure authority.

A candidate is **admissible** only if every safety rule in §5 holds. Any rule
that cannot be evaluated from declared metadata fails closed: the affected card
is removed from the wave and deferred to a later wave.

## 5. Wave safety rules

A pair of cards may share a wave only if all of the following hold.

1. **Dependencies**: no card in the wave depends on another card in the same
   wave that is not already closed. Dependency edges must point outside the wave
   (to already-closed cards).
2. **Scope overlap**: declared scope paths must be disjoint, *or* overlap only on
   files that admission can prove are append-/shard-safe. Overlap on an unknown
   range fails closed.
3. **CID / logical conflicts**: no two cards write the same atom or map owner in
   conflicting ways, per the logical conflict matrix. Write/write on the same
   atom fails closed.
4. **Validators**: every card declares command-backed validators. A card with no
   verifiable validator cannot join a wave.
5. **Target repo**: all cards in a wave share one target repo. Cross-repo cards
   are split into separate waves.
6. **Closure authority**: all cards in a wave share one closure authority. A
   card whose closure authority differs is deferred.
7. **Generated artifacts**: if two cards both regenerate the same generated
   artifact (for example a coverage map or a release bundle), only one may hold
   the write in a given wave; the other is deferred or sequenced behind a
   checkpoint.

## 6. Blocked cases (must split into a later wave)

The following candidates are not admissible and must be split:

- same shared file with an unknown changed range,
- same atom write/write,
- closure-authority mismatch within the wave,
- target-repo mismatch within the wave,
- missing worker report for an in-flight card,
- a wave member depending on another not-yet-closed wave member.

When a wave is split, the deferred cards form the head of the next candidate
wave; no card is dropped, only resequenced.

## 7. Evidence slicing and checkpoint

After workers report, the coordinator slices the wave's combined change set into
per-card evidence using declared scope paths and patch envelopes. If a change
cannot be unambiguously attributed to exactly one card, the whole wave enters
`needs-review` and no card in it is checkpointed as done.

Checkpoint and close semantics are unchanged:

- only cards whose deliverables exist and whose validators pass may be prepared
  for close,
- `batch checkpoint` or `taskflow close` performs the actual lifecycle
  transition,
- Wave Mode never marks a card done merely because the wave as a whole passed.

## 8. Failure posture

Wave Mode fails closed by default. Unknown scope, unverifiable validators,
ambiguous evidence attribution, or any unmet rule in §5 removes the affected
card from the wave rather than admitting it. A wave with zero admissible cards
is reported as empty, not forced.

## 9. Non-goals

- Wave Mode is not a closeout shortcut.
- Wave Mode does not define new lifecycle states beyond the existing task
  lifecycle plus the wave-local execution states (`done`, `partial`, `blocked`,
  `not-started`, `needs-review`) used only for scheduling and reporting.
- Wave Mode does not embed any adopter-specific policy; safety rules are derived
  from declared task metadata only.
