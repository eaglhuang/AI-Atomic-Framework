# Team Agents Wave Mode — Operator Guide

Status: stable
Spec: `docs/specs/team-agents-wave-mode-v1.md`
Dogfood: `docs/reports/team-wave-mode-dogfood.md`

Team Agents Wave Mode lets a coordinator advance several task cards in parallel
without bypassing ATM governance. It is an admission-and-scheduling layer over
the existing batch queue, broker admission, patch envelopes, evidence, and
checkpoint surfaces. It does not add a second task lifecycle or a second git
write path.

## When to use which mode

ATM offers four ways to move work. Pick the smallest that fits.

| Mode | Use when | Lifecycle authority |
|------|----------|---------------------|
| Single-task flow | One card at a time | `taskflow open` / `taskflow close` |
| Batch queue-head | A sequential queue of cards, one active head | `batch checkpoint` |
| Team Agents advisory | One card, multiple roles coordinating (lieutenant) | `taskflow close` |
| Team Agents Wave Mode | Several cards safe to run in parallel | `batch checkpoint` / `taskflow close` |

Wave Mode is **not** a closeout shortcut. It schedules and admits parallel work;
the existing close path is still the only thing that marks a card done.

## Roles

- **Coordinator** — the only role allowed to perform git writes, checkpoint, and
  closeout. Exactly one per wave.
- **Worker** — implements one card and submits a worker report. Never commits or
  closes.
- **Validator / Reviewer** — advisory only; raise findings, cannot perform
  privileged actions.

The coordinator-only guard fails closed if any non-coordinator role attempts a
git write, closeout, or checkpoint.

Role semantics should stay aligned with
`docs/governance/team-agents/role-skill-pack-contract.md` and the routing split
described in `docs/governance/team-agents/role-routing-matrix.md`. Wave Mode is
an orchestration surface over role packs; it is not a replacement for those
contracts.

## Workflow

1. **Plan** a candidate wave from declared task metadata:

   ```bash
   node atm.mjs team wave plan TASK-AAA-0001,TASK-AAA-0002,TASK-AAA-0003 --json
   ```

   The planner groups cards into ordered waves and reports any cards deferred to
   a later wave (with reasons).

2. **Dispatch** the first admissible wave (writes a coordinator-owned wave
   envelope to `.atm/runtime/team-waves/`):

   ```bash
   node atm.mjs team wave dispatch TASK-AAA-0001,TASK-AAA-0002 --actor <coordinator> --json
   ```

   Dispatch runs broker admission and only records members that pass every safety
   rule. Rejected members are reported for a later wave.

3. **Workers implement** their cards and report (changed files, validator runs
   with the first failing diagnostic, deviations, execution state). An
   inconsistent `done` claim is reconciled down to `needs-review`.

4. **Slice evidence** from the combined wave diff. Every changed file must map to
   exactly one card; an unattributed or ambiguous file forces the whole wave to
   `needs-review`.

5. **Checkpoint**: only `done` members backed by clean attributed evidence become
   close-ready. The coordinator then drives the normal close path
   (`batch checkpoint` / `taskflow close`) for those members.

## Safety rules (fail closed)

A pair of cards may share a wave only when all hold: external-only dependencies,
disjoint scope (append-safe files excepted), no same-atom write/write, matching
target repo, matching closure authority, and no generated-artifact contention.
Anything that cannot be decided from declared metadata removes the card from the
wave rather than admitting it.

## What Wave Mode never does

- It never closes a card on its own.
- It never lets a non-coordinator role write git or drive closeout.
- It never marks a card done because the wave as a whole passed.
- It embeds no adopter-specific policy; rules derive from declared task metadata.
