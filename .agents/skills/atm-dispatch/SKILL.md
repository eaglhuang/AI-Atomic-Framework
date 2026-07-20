---
name: atm-dispatch
description: ATM Captain dispatch routing for task cards, sidecars, subagents, condition review, mailbox work, and closeout coordination.
argument-hint: "<ATM context>"
charter-invariants-injected: true
---


# ATM Dispatch

Use this skill when the user asks for Captain, Coordinator, dispatch, task
cards, sidecars, subagents, delegation, condition review, mailbox work, or
closeout review.

State `Skill used: atm-dispatch` and the chosen `Delegation mode`.

Terminology boundary: ATM is the product, framework, CLI, and governance workflow. AI-Atomic-Framework is only this repository name; do not call ATM AAF.

Captain must apply atm-dispatch before any dispatch, sidecar delegation,
review, condition review, or closeout.

Delegation modes:

- `local`: the current agent does the work directly.
- `internal sidecar`: Internal sidecar is the default for review, preflight,
  grep, 審稿 / planning-only / checklist, and post-report verification.
- `external handoff`: External dispatch is opt-in. A separate agent/thread may
  receive a bounded task only when the user explicitly chooses that route.

External write is forbidden unless the user explicitly grants write authority
and scope.

## Highest Parallel Governance Principle

Treat ATM parallel governance as a tiered authority model:

- Reads never queue behind write lanes.
- Private writes to the actor's own ledger, evidence, notes, or planning
  artifacts never queue behind unrelated lanes.
- Shared writes to the git index, release mirrors, build artifacts, protected
  runtime state, or other shared mutation surfaces go through the broker, which
  answers with a ticket: execute now, enqueue with a position, or batch into a
  shared write window. A bare refusal at a shared-write gate is charter debt
  (INV-ATM-008), not a design choice.

The only standing serialization exceptions are the four owner-ruled cases in
`docs/governance/parallel-governance-charter.md` (one lane session per task
card; dependency gates block code only, never documents; the single-branch
commit core with related-task batching only; document writes are ungoverned,
code writes are always governed). Any new serialization point must be surfaced
to the project owner for an explicit ruling before it ships.

Do not serialize Tier 0 or Tier 1 work merely because another lane has active
work. Before blocking parallel progress, identify the concrete Tier 2 shared
surface and the intersecting task, actor, or file set that requires
broker/steward coordination.

## Actor Identity Handoff Gate

Before any `next --claim`, worker claim, batch checkpoint, `tasks ... --actor`,
or governed `git ...` command, resolve this agent's explicit actor id.

- If this is a new editor, new agent, takeover, or uncertain identity state, run `node atm.mjs identity clear --json` before claiming.
- Set an actor-scoped identity before taking authority: `node atm.mjs identity set --actor "$ATM_ACTOR_ID" --editor <editor-id> --git-name "<git user.name>" --git-email "<git user.email>" --json`.
- Never treat repo default identity as authority. It is only a stale-prone hint and may belong to the previous agent.
- Do not claim, commit, or report as another actor unless ATM returned an explicit takeover route for that actor and task.

## Dispatch Identity Rule

Captain identity and worker identity are separate authority lanes. A dispatch
card may transfer scope, acceptance criteria, and evidence requirements, but it
must not transfer the captain's runtime identity to the worker.

When assigning work, include the expected actor id or tell the worker to set one
before claiming. When receiving work, the worker must clear stale default
identity if the editor or repo was previously used by another agent, then set its
own actor-scoped identity before claim, edit, close, report, or commit.

## First Command

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

After every `next --prompt` or `next --claim` response, read
`evidence.nextAction.playbook` before drafting dispatch instructions, editing,
closing, or committing. The playbook is the short channel-specific work order.

If a route, validator, hook, worker report, plan, or task card includes an
`ATM_*` error code, route interpretation and authoring through
`atm-error-code-resolver` and its shared registry instead of keeping private
recovery prose in the dispatch brief. New, renamed, or retired codes must be
declared in both the source plan and owning task card before implementation.

## Task Series Governance

Never invent a new task-series prefix (a new TASK-XXX family) on your own.
Before opening a card, survey the existing families in the target repository
task ledger and in the planning repository, and reuse the semantically closest
existing family at its next free id. Opening a brand-new series is only legal
after a complete written plan for that series has been approved by the project
owner. Every dispatch or card header must state which family was chosen and
why it is the closest match; a new prefix without an approved plan must be
rejected at review.

Series legitimacy check: a series is legitimate only if its parent
directory exists under the resolved planning repository / governance workbench
repo, for example `docs/ai_atomic_framework/<family-dir>/tasks/` within that
repo. A prefix that appears only in the target-repo ledger with no
planning-repo parent directory is itself an illegally invented series - do not
reuse it; report it to the owner and remap the work onto the correct family.
Task ids are assigned from the planning repository state, never inferred from
the local target-repo ledger.

Reserved family routing: ErrorCode and error-governance work must use the registered ERR family (series ERR, prefix TASK-ERR). Temporary cleanup, quarantine, and one-off residue-disposition work must use the registered TMP family (series TMP, prefix TASK-TMP). Do not spend GOV numbers on these categories. If a draft or ledger record already used a GOV id for ERR/TMP work, stop and reclassify it through the registered planning family and, when needed, a ledger rekey/realign repair before implementation continues.

## Windows Text Document IO Rule

On Windows, read, write, and compare Markdown, JSON, and text planning documents with Node.js UTF-8 helpers. Do not use PowerShell content commands such as `Get-Content`, `Set-Content`, or `Out-File` as the basis for document authoring or content comparison, because console encoding can make valid Traditional Chinese UTF-8 look corrupted.

PowerShell may still launch `node`, `git`, and ATM CLI commands; the restriction is on document content IO and document content comparison.

## Dispatch Rules

- Before drafting a plan or task cards, state `Planning authority`, `Target
  authority`, and `Closure authority`. If planning and target repositories
  differ, keep the full plan and source cards in the planning repository and
  let the target receive only CLI-imported ATM ledger records.
- Do not create a parallel task model; route task-card work through ATM.
- Do not delegate write authority unless the user explicitly granted it.
- Prefer internal sidecars for review, grep, preflight, checklist, and
  post-report verification.
- Keep sidecars bounded: specify objective, read/write boundary, required
  evidence, stop condition, and report contract.
- For batch work, dispatch only the current queue head unless ATM returns a
  batch route and checkpoint plan.
- For closeout review, verify deliverables and evidence before saying a task is
  complete.

## Planning Authority Resolution Gate

Before drafting any ATM plan, task-card directory, or source task card, classify
the request as one of:

- ATM framework implementation
- ATM governance optimization planning
- adopter or project work
- dogfood or backlog recording

For ATM framework work that must be planned outside the target ATM ledger,
resolve an external governance workbench repository first. Do not assume the
current working directory is the planning repository.

Before writing any plan or task card, state these fields:

- `planning_repo_root`
- `planning_repo_is_external_to_target`
- `target_repo_root`
- `source_plan_path`
- `source_task_card_path`
- `target_import_method`

If no external governance workbench can be resolved, stop and ask the user for
the planning repository, or record a backlog item for missing planning-authority
discovery. Do not create source planning cards inside the ATM target repository
by default; the target may receive only CLI-imported `.atm/history/**` ledger
records unless the source plan itself is an explicit target deliverable.

When changing ATM skills, update the source-of-truth template files first.
Installed skill copies under agent or integration directories are derived
artifacts; direct-only edits to those copies are not sufficient and must fail
review because reinstalling or refreshing adapters can overwrite them.

## Team Agents Dispatch Surface

When dispatching or reviewing Team Agents work, preserve the current runtime
surface instead of falling back to the older "manual advisory only" model:

- Use L1 through L5 as the canonical crew scale. L1 is Coordinator,
  Atomization Planner, Implementer, and Validator; L5 adds Lieutenant, Review
  Agent, and Knowledge Scout.
- Mention `--team-size L1..L5` when crew completeness matters, and
  `--role-provider role=provider:model[:sdk][:mode]` when a role needs a
  specific provider/model.
- Treat `team start --execute` as an explicit governed execution lane. The
  default `team start` remains state-only and does not spawn workers.
- Preserve runtime governance fields in reports: `decisionClass`,
  `decisionReason`, `requiresHumanSignoff`, `requiresAdr`,
  `violationStatus`, and `escalationTarget`.
- Treat `broker-conflict-blocked` as a hard stop. Do not tell workers to
  self-close, self-commit, or bypass Team Broker.
- If a task card declares `team.required: true`, closeout needs a completed Team
  run and summary before task close can proceed.

## Route Command

Use this ATM command only after the first command confirms dispatch is the
current governed route:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

## Handoff

```bash
node atm.mjs handoff summarize --task "$ARGUMENTS" --json
```

## Memory Write Check (TASK-MEM-0004)

During condition review of an agent report, run the same memory-write
checklist as `atm-handoff` (pitfall/gotcha, closure snapshot, human feedback,
invalidated note) against the reported work. The agent report format gains one
required line: `keep-memory write: <file name | none + reason>`. The no-write
rules apply unchanged: nothing that backlog/cards/shards already record;
governance defects go to the bug backlog first.

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

## Captain Dogfood Lessons (2026-07-14)

Planning authority:

- Do not let the current working directory decide where a plan lives. Resolve
  planning, target, and closure authority before writing any plan or card.
- Memory and handoff summaries are not a gate. Persist cross-repository planning
  rules in `atm-task-card-authoring` and verify the card source path before
  import.

Token / speed:

- Prefer **internal sidecars** for backlog ranking and disjoint bug re-implements; they beat full Team `start --execute` when scopes collide or Frozen is stale.
- Cap batch size (e.g. 5 bugs) before writing the optimization report; unbounded queues burn tokens on governance thrash.
- Validate with `node --strip-types <focused-spec>` instead of live `team plan` against a dirty shared worktree.
- Parallel Composer sidecars accelerate **implementation + focused tests**; Captain should keep claim/evidence/close on the Frozen lane (one authority). Do not ask write sidecars to `npm run build` or commit.

ATM flow:

- When another captain owns `git-governance` / RFT work, pick **core/scripts-only** bugs first; `packages/cli/src/**` often collapses to `atom-cli-router` and false-freezes claims.
- `team broker resolve` emits BCR artifacts but **does not unblock** `next --claim` CID freeze by itself — fixed in TASK-AAO-0200 / ATM-BUG-160 (claim now consumes BCR). Keep the lesson: BCR authoring ≠ automatic claim admit until the claim lane is proven.
- Frozen prefer + source delivery: `ATM_RUNNER_STALE_WRITE_REFUSED` vs `ATM_SOURCE_FIRST_WRITE_REFUSED` is a deadlock; rebuild with `ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build` before import/close writes when Frozen lags source.
- After any foreign `build(release): sync`, **re-diff your deliverables immediately**; uncommitted source can vanish (ATM-BUG-184).
- Cross-file consistency will block a scoped commit when `team.ts` imports symbols changed in unstaged siblings — `tasks scope add` the coupled files **before** `git commit --auto-stage`, or expect `ATM_PRE_COMMIT_CROSS_FILE_INCONSISTENCY`.
- One shared delivery SHA for related bugs is fine: close siblings with `--historical-delivery <sha> --waiver-out-of-scope-delivery --reason "..."`; without the waiver, `MIXED_DELIVERY_COMMIT` / `OUT_OF_SCOPE_WAIVER_REQUIRED` blocks. TASK-AAO-0201 / ATM-BUG-186 now promotes the waiver recipe as the primary shared-delivery blocker (not "missing delivery").
- After closing a batch under a temporary `framework-mode claim`, **release** that temp lock before the next sibling `taskflow close --write`, or framework-development gates fail with stale-lock / `ATM_TASK_CLOSE_FRAMEWORK_GATE_FAILED`.
- Branch discipline: unless the human gives explicit special approval for a branch/worktree experiment, no AI/agent may create or switch to a development branch or worktree branch. Backlog fixes default to the current `main` lane with formal task-card claim/evidence so concurrency and overlap remain measurable.
- Card generator scripts under `.atm/runtime/*.js` race with `package.json` `"type":"module"` — use `.cjs` (or write cards with the Write tool) so planning-card generation does not silently fail.
- Do **not** run `integration add --force` to clear skill drift after editing dogfood lessons in installed copies; update `templates/skills/atm-dispatch.skill.md` first, then reinstall adapters so manifests stay in parity.

Team Agents efficiency:

- Parallel subagents helped **re-apply wiped fixes** (159/097/102) in one turn; they did **not** accelerate 0195 while CID-frozen against RFT-0020.
- Live `team plan` as validator preflight is slow and flaky under foreign broker intents; keep body-shape asserts independent of plan admission.
- 2026-07-14 five-bug batch (095/105/094/149/160): two parallel implement sidecars finished source+tests while Captain rebuilt Frozen; wall-clock win was real for coding, but **closeout stayed serial** (evidence + taskflow). Parallel Agents do not shorten governed close.
- 2026-07-14 second batch (186/185/150/117/182): same pattern — two implement sidecars + one fix-up sidecar for an unrelated `blockedResidue` OR-bug exposed by the staging suite; Captain still owns serial close.
