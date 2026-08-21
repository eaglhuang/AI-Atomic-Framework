---
applyTo: "**"
---


# ATM Atom Map Refactor

Use this skill before editing ATM framework code for a refactor, extraction,
governance-invariant cleanup — and for ANY task card whose scope touches a
large governance module (over 600 lines), not only cards labeled as refactors
(TASK-AAO-FABLE-006). The goal is to choose a small atom owner and a testable
contract before moving code.

Extraction-first is a core ATM intent: prefer proposing the change as a new
atom or atom map over inline-editing the large module. The owner/pattern
selection below IS the extraction proposal — record it in the card's
`atomizationImpact.extractionCandidates` (see the `atm-task-card-authoring`
skill) and restate it in the implementing agent's dispatch report. Staying
inline is a human decision and requires a recorded `inlineReason` on the
card. ATM patrols this at import time via the advisory diagnostic
`ATM_TASK_IMPORT_EXTRACTION_FIRST_CANDIDATE`.

## First Command

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

## Required Workflow

1. Read the active task card and its allowed files.
2. Name the governance invariant being touched.
3. Choose exactly one primary extraction pattern:
   - Policy Object
   - Strategy Map
   - Result Contract Object
   - Facade
   - Adapter/Port
4. Propose the owner module, public surface impact, focused test, and CLI
   regression.
5. Build a responsibility map for the oversized module. When several adjacent
   responsibilities form a cohesive map and are already authorized by the task,
   extract the whole map in one pass instead of shaving off one tiny helper.
6. Measure the projected facade size before editing. Treat 600 lines as the hard
   trigger, never as the post-refactor target: normally leave 25-35% headroom
   (about 390-450 lines for a 600-line ceiling).
7. Extract only the cohesive atom map already in task scope.
8. Record unrelated or unauthorized refactors as follow-up work instead of
   widening the task.

If the task is not a refactor or extraction task, still run steps 2-4 to
produce an extraction candidate whenever the touched module exceeds 600 lines,
then record it as `extract`, `follow-up-card`, or human-approved `inline` on
the card. Do not turn an unrelated bug fix into a broad cleanup — propose,
let the Captain/human decide, and default to opening the follow-up card.

## Durable Headroom Rule

- A line ceiling is an admission boundary, not a design target. A refactor that
  leaves the owner at 550-600 lines usually defers the same problem and is not a
  durable extraction.
- Prefer a cohesive map of 2-4 atoms when the responsibility map supports it.
  Each atom must have one owner, a narrow contract, and focused proof; never
  combine unrelated responsibilities merely to remove more lines.
- For a 600-line ceiling, target the remaining facade at 390-450 lines. If a
  safe extraction cannot reach at least 20% headroom, record the constraint and
  an explicit follow-up rather than claiming the size risk is resolved.
- Estimate both moved lines and likely near-term growth. Select seams that move
  policy, transaction, recovery, or result-assembly responsibilities—not just
  constants, type aliases, or thin forwarding helpers.
- Validate each extracted atom directly and keep one integration regression at
  the facade. Line-count proof alone is never sufficient.

## Pattern Selection

Read `references/patterns.md` when choosing the extraction shape or reviewing a
proposed split.

Use the short rule:

- Admission, permission, waiver, or allowed/blocked decisions -> Policy Object.
- Mode, bucket, or route selection -> Strategy Map.
- Evidence, diagnostics, bundle, or provenance output -> Result Contract
  Object.
- Operator-facing command that delegates to atoms -> Facade.
- Host/adopter boundary -> Adapter/Port.

## ATM Guardrails

- Keep `taskflow open` and `taskflow close` as normal operator lanes.
- Treat direct `tasks close`, `tasks reconcile`, `tasks import --write --force`,
  and `tasks repair-closure` as backend/emergency surfaces when used directly.
- Keep caller-facing contracts stable. Prefer re-exporting from
  `public-surface.ts` instead of changing callers ad hoc.
- Do not create a second task lifecycle, task storage model, registry, or close
  authority.
- Keep source delivery commits separate from runner-sync commits when
  `ATM_RUNNER_SYNC_REQUIRED` appears.
- Add focused tests for the extracted atom, then run the task card validators.

## Output Shape

Before implementing a refactor, produce a concise plan:

```text
Atom:
Atom map (2-4 cohesive responsibilities):
Pattern:
Owner module:
Callers:
Public surface:
Before / projected-after lines:
Headroom percentage:
Focused test:
CLI regression:
Out of scope:
Commit split:
```

If the implementation proceeds, report the same fields with the final paths and
validator results.

## Casebook

Read `references/casebook.md` when the current task resembles prior CID work or
when adding a new lesson after a successful extraction.

Add a new case only after a task is governed done. Keep cases short: problem,
chosen pattern, owner module, proof, lesson.

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

Keep this flow inside ATM CLI routing. Preserve host edits and rely on install manifest hashes for uninstall safety.
