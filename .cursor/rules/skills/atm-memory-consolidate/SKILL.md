
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
- `INV-ATM-009` ??**Generalized repair and data-driven policy** (enforcement: `doctor`, breaking change: no)
  Rule: Any code logic change, bug fix, or governance rule change must first be designed as the most general rule that correctly explains the observed failure class. Hard-coded special cases are allowed only with recorded evidence that the general rule is not currently safe, feasible, or economical, and that the exception is bounded and reversible. Data-shaped behavior, including thresholds, mappings, allowlists, routing choices, telemetry classifications, prompts, message text, fixtures, and domain content, must first be modeled outside control flow through schemas, registries, configuration, observed counters, or compact digest evidence instead of embedded changeable numbers or strings. The generalized solution must remain observable, testable, and no broader than the evidence supports.
- `INV-ATM-010` ??**Single canonical worktree and compose-first shared writes** (enforcement: `doctor`, breaking change: no)
  Rule: Normal governed parallel development uses one canonical worktree, base, and HEAD. A shared physical file is compose-eligible rather than a file lock: workers declare bounded atom/CID/content-anchor/source-range intents and submit proposals, while the broker, format adapter, and transactional composer decide compose, revalidation, escalation, or queue. A neutral steward is the only shared-file writer and shared delivery records member attribution. Queueing or revalidation is a fallback for a true logical conflict, stale base/CAS failure, unsupported adapter, or fairness bound. AI workers must not use Git branches, detached worktrees, alternate indexes, merges, or rebases as normal concurrency/isolation mechanisms. The closed exceptions are emergency/anomaly recovery, historical read-only discrimination, and non-development sealed packaging; each requires a named receipt and cannot perform normal governed contribution writes.
- `INV-ATM-011` ??**Minimum queue residency** (enforcement: `doctor`, breaking change: no)
  Rule: Queueing is a scarce-resource boundary, never a work-ownership model. Every queue design must minimize residency to the irreducible interval during which a specific shared resource cannot be safely parallelized, composed, deferred, or made private. All separable preparation, computation, validation, and staging must occur outside that interval before a worker joins the queue. The design must make the boundary observable and prove it is minimal: admission binds a ready candidate to current state, the shared transition has explicit success and failure outcomes, and completion or invalidation releases capacity immediately. A queue may not substitute for polling, long-lived reservation, or avoidable serialization. A particular broker, lock, lease, publish flow, or commit mechanism is only one implementation of this invariant, not its meaning.
- `INV-ATM-012` ??**Canonical authority snapshots** (enforcement: `doctor`, breaking change: no)
  Rule: Whenever a governed decision depends on authority — including claim, lock, lease, lane, broker receipt, candidate scope, expiry, or release entitlement — ATM must resolve that fact once through a canonical authority-snapshot module. Every consumer must consume the same immutable, attributable, scoped, TTL-aware where applicable, digestable decision or verify its digest. A consumer must not independently recreate an approximate authority rule; recovery commands must be generated from the same snapshot that the next consumer accepts. Missing, expired, partial, ambiguous, changed, or unverifiable authority remains fail-closed. New authority consumers require parity coverage for absent, live exact, live partial, expired, released, actor/lane-mismatched, delegated, and concurrent-change cases.
- `INV-ATM-013` ??**Fail fast before irreversible or expensive work** (enforcement: `doctor`, breaking change: no)
  Rule: Every non-optional precondition for an ATM CLI operation must be evaluated before expensive validation, build, lock acquisition, queue admission, lease consumption, staging, or any local/cross-repository write. A failed precondition must immediately return one precise error code, the observed blocking fact, and an executable recovery command. Control-plane commands (routing, status, preflight, admission, recovery diagnosis) have a five-second response budget. Large declared test suites, builds, and external I/O are execution-plane exceptions, but must be explicitly classified before they start and expose a ticket, progress receipt, or bounded completion result. A lease, override, lock, or queue slot is consumed only after every prerequisite that can be checked without that capability has passed.
- `INV-ATM-014` ??**Operation-owned transient artifact lifecycle** (enforcement: `doctor`, breaking change: no)
  Rule: Every governed operation owns every transient artifact it creates. Success, failure, timeout, and cancellation must either restore the exact pre-operation state or retain one durable owner-bound, digest-verifiable, resumable recovery receipt. Claim, lock, queue, lease, or capability release is forbidden while operation-created residue is unowned. Cleanup may modify only receipt-listed transient paths whose ownership and current bytes still match; user-authored source, staged foreign work, and active-owner artifacts remain fail-closed. Cleanup success never converts a failed primary operation into success.

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
