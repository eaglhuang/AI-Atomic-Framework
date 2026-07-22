---
mode: agent
description: Write a continuation summary for governed work.
---


# ATM Handoff

## Actor Identity Handoff Gate

Before any `next --claim`, worker claim, batch checkpoint, `tasks ... --actor`,
or governed `git ...` command, resolve this agent's explicit actor id.

- If this is a new editor, new agent, takeover, or uncertain identity state, run `node atm.mjs identity clear --json` before claiming.
- Set an actor-scoped identity before taking authority: `node atm.mjs identity set --actor "$ATM_ACTOR_ID" --editor <editor-id> --git-name "<git user.name>" --git-email "<git user.email>" --json`.
- Never treat repo default identity as authority. It is only a stale-prone hint and may belong to the previous agent.
- Do not claim, commit, or report as another actor unless ATM returned an explicit takeover route for that actor and task.

Handoff transfers context, evidence, blockers, and next recommended commands. It
does not transfer actor authority. The receiving agent must clear stale default
identity when needed and claim with its own explicit actor id before editing,
closing, reporting, or committing.

First command:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

When a handoff mentions unresolved `ATM_*` codes, point the next agent to
`atm-error-code-resolver` instead of copying ad hoc recovery prose. Include the
code, command that produced it, and whether the registry entry was found.

## Governance Flow Summary

For governed work, include the reusable governance-flow state that the next
agent needs, without copying historical noise into skill text:

- consumed sealed summaries;
- missing data;
- assumption changes;
- stop rule;
- touched shared-write gates and the `INV-ATM-008` outcome;
- closeout telemetry window, watermark, counters, duration/timing, source
  availability, compact digest, and unavailable receipts;
- whether runner, release, broker shared-write behavior, first-layer entry,
  skill template projection, or generated integration output changed and
  whether frozen-entry smoke evidence exists.

Do not turn task-specific status, dirty worktree residue, local commit shas,
actor ids, queue ids, or date-bound incident details into reusable instructions.
Those details belong in the handoff artifact, backlog, task evidence, or shared
learning references.

## Route Command

Use this ATM command only after the first command confirms it is the current governed route:

```bash
node atm.mjs handoff summarize --task "$ARGUMENTS" --json
```

## Handoff

```bash
node atm.mjs handoff summarize --task "$ARGUMENTS" --json
```

## Charter Invariants

- `INV-ATM-001` ??**No second registry** (enforcement: `gate`, breaking change: yes)
  Rule: A host project must not create a second AtomicRegistry implementation outside of packages/core or introduce a parallel ID allocation, version tracking, or registry promotion path.
- `INV-ATM-002` ??**Lock before edit** (enforcement: `doctor`, breaking change: no)
  Rule: No governed file mutation may occur without a valid ScopeLock recorded in .atm/locks/ for the current WorkItem. Agents must call atm lock before editing files.
- `INV-ATM-003` ??**Schema-validated promotion only** (enforcement: `gate`, breaking change: yes)
  Rule: An UpgradeProposal must pass all automatedGates (including JSON Schema validation) before promotion. Direct registry mutation that bypasses the UpgradeProposal path is forbidden.
- `INV-ATM-004` ??**No competing highest authority** (enforcement: `doctor`, breaking change: yes)
  Rule: No host project rule, profile, or configuration may declare itself to have authority equal to or higher than the AtomicCharter. Any rule that contradicts an invariant must go through a charter waiver proposal.
- `INV-ATM-005` ??**Host rule amendments require waiver flow** (enforcement: `waiver-required`, breaking change: no)
  Rule: When a host project rule conflicts with a charter invariant, the host must submit a behavior.evolve UpgradeProposal with a charterWaiver field and a linked HumanReviewDecision. Silent override is not permitted.
- `INV-ATM-006` ??**Framework work tracking stays target-local** (enforcement: `doctor`, breaking change: yes)
  Rule: The framework repository must not host downstream adopter planning queues or project-specific work tracking artifacts. ATM framework-development tasks may live in the framework repository only as ATM-managed .atm/history/tasks ledger records with CLI transition evidence.
- `INV-ATM-007` ??**Public framework docs remain English-only** (enforcement: `doctor`, breaking change: yes)
  Rule: Public contributor-facing documentation in the framework repository must remain English-only and repository-neutral. Non-English planning notes, local experiments, or downstream operating guidance must live in the coordinating host workspace unless they are translated into neutral English framework documentation.
- `INV-ATM-008` ??**Broker tickets, not refusals** (enforcement: `doctor`, breaking change: no)
  Rule: Every governed shared-write gate (runner-sync, build windows, release mirrors, git commit, projection regeneration) must respond with a broker ticket - execute now, enqueue with position, or batch into a shared write window - never a bare refusal. Reads and private writes (own ledger, evidence, task events, lane sessions) never queue. The only standing exceptions are the four owner-ruled cases in docs/governance/parallel-governance-charter.md; any new serialization point requires an explicit project-owner ruling before it ships.
- `INV-ATM-009` ??**Generalized repair and data-driven policy** (enforcement: `doctor`, breaking change: no)
  Rule: Any code logic change, bug fix, or governance rule change must first be designed as the most general rule that correctly explains the observed failure class. Hard-coded special cases are allowed only with recorded evidence that the general rule is not currently safe, feasible, or economical, and that the exception is bounded and reversible. Data-shaped behavior, including thresholds, mappings, allowlists, routing choices, telemetry classifications, prompts, message text, fixtures, and domain content, must first be modeled outside control flow through schemas, registries, configuration, observed counters, or compact digest evidence instead of embedded changeable numbers or strings. The generalized solution must remain observable, testable, and no broader than the evidence supports.
- `INV-ATM-010` ??**Single canonical worktree and compose-first shared writes** (enforcement: `doctor`, breaking change: no)
  Rule: Normal governed parallel development uses one canonical worktree, base, and HEAD. A shared physical file is compose-eligible rather than a file lock: workers declare bounded atom/CID/content-anchor/source-range intents and submit proposals, while the broker, format adapter, and transactional composer decide compose, revalidation, escalation, or queue. A neutral steward is the only shared-file writer and shared delivery records member attribution. Queueing or revalidation is a fallback for a true logical conflict, stale base/CAS failure, unsupported adapter, or fairness bound. AI workers must not use Git branches, detached worktrees, alternate indexes, merges, or rebases as normal concurrency/isolation mechanisms. The closed exceptions are emergency/anomaly recovery, historical read-only discrimination, and non-development sealed packaging; each requires a named receipt and cannot perform normal governed contribution writes.

## Memory Write Check (TASK-MEM-0004)

Before finishing a handoff summary, answer this checklist explicitly (write
"none" when empty):

1. Confirmed pitfall + fix this session? -> write a `gotcha` memory note.
2. Major closure snapshot (lane cleared, milestone done)? -> write a `status` note.
3. Human corrected the working method? -> write a `feedback` note with Why /
   How to apply.
4. An existing memory note proven wrong? -> update or retire it now.

Write into the current repo's keep-memory directory (resolve via the keep
registry; in the coordinating workspace this is `docs/keep-memory/` with the
contract in its README). Do NOT write: anything already recorded in backlog,
task cards, or consensus shards; details only meaningful to this session.
Governance defects go to the ATM bug backlog first — memory notes carry only
the operator intuition the formal record does not keep.

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel task model, registry, or approval flow.
- Treat any planning hint as CLI output, not as template authority.

Do not introduce a second registry, task state, or approval path.
