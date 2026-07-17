
# ATM Memory Consolidate

Use this skill when a repository's memory-note layer (keep-memory directory)
needs consolidation: the summary index is over budget, stale-report lists
candidates, or a milestone closed and status notes have piled up. The target
directory and index location come from the repository's keep registry entry
(in the coordinating workspace: `docs/keep.registry.md`); the note contract
lives in the keep-memory directory's README.

First command:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

## Phase 1 — Take stock

- Read the keep summary's memory index section and list the memory directory.
- Run the host repository's own memory tooling for ground truth (its
  validate and stale-report commands, if provided).
- Mark overlapping, stale, and thin notes.

## Phase 2 — Consolidate

- Separate durable from dated: `gotcha`/`feedback` notes tend to be durable —
  sharpen them; `status` snapshots expire — retire them or fold the lasting
  takeaway into a durable note.
- Merge notes describing the same trap or workflow; keep the richer file.
- Convert every relative time reference into an absolute date.
- Delete what the formal record already keeps (backlog, task cards, consensus
  shards, git history) — memory notes carry only operator intuition.
- Propose promotion for gotchas stable for six months or longer: list them
  for HUMAN review as consensus-shard candidates. Never mutate the consensus
  layer (keep-shards) from this skill.
- Mark corrected notes `superseded` or fix them in place; never leave a known
  false assertion active.

## Phase 3 — Tidy the index

- Rebuild the index with the host repository's own tooling (its
  rebuild-index command, if provided); confirm the index
  section stays within its line budget.
- Report files touched, retired, merged, and promotion candidates awaiting
  human review.

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

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel task model, registry, or approval flow.
- Do not build a second memory store or copy notes across repositories; the
  registry routes readers to each repository's own notes.
- Consensus-layer promotion is always a human decision.

## Rules

- Use ATM as the only governance route for this action.
- Do not create a second registry, task state, or approval workflow.
- Preserve user-edited integration files; manifest hashes decide uninstall safety.
