---
applyTo: "**"
---


# ATM Next

If the current user prompt mentions a task id, task card, plan document, or a
scoped batch of tasks, choose the narrowest route before editing. For one exact
task id, do not write the shared runtime intent file; route directly with:

```bash
node atm.mjs next --task TASK-ABC-0001 --json
```

Invoke the `atm-task-intent-resolver` skill when the prompt needs semantic
resolution for fuzzy task, plan, or batch scope. That skill writes
`.atm/runtime/task-intent.json` and routes with:

```bash
node atm.mjs next --intent .atm/runtime/task-intent.json --json
```

Use the prompt-scoped command below only when no task or plan scope is present or
when the editor cannot run the semantic intent skill.

## Actor Identity Handoff Gate

Before any `next --claim`, worker claim, batch checkpoint, `tasks ... --actor`,
or governed `git ...` command, resolve this agent's explicit actor id.

- If this is a new editor, new agent, takeover, or uncertain identity state, run `node atm.mjs identity clear --json` before claiming.
- Set an actor-scoped identity before taking authority: `node atm.mjs identity set --actor "$ATM_ACTOR_ID" --editor <editor-id> --git-name "<git user.name>" --git-email "<git user.email>" --json`.
- Never treat repo default identity as authority. It is only a stale-prone hint and may belong to the previous agent.
- Do not claim, commit, or report as another actor unless ATM returned an explicit takeover route for that actor and task.

## Highest Parallel Governance Principle

When interpreting ATM concurrency guidance, preserve this Tier model:

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

If a route blocks parallel work, surface the concrete Tier 2 shared surface and
the intersecting task, actor, or file set. Do not treat an unrelated active lane
as a reason to block Tier 0 reading or Tier 1 private evidence/ledger progress.

First command:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

After the first command returns, read `evidence.nextAction.playbook` before
editing, closing, or committing. The playbook is the authoritative short
instruction sheet for the selected channel:

- `fast`: small quickfix, no task close.
- `normal`: one task, claim -> implement -> validators -> evidence add -> tasks
  close -> commit.
- `batch`: many tasks, claim original prompt -> deliver queue head -> evidence
  -> batch checkpoint -> commit -> continue next queue head.

If `evidence.nextAction.governanceReadiness` is present, prepare those items
before you reach commit or push. Treat framework claim, protected push
evidence, `doctor`, and branch queue retry codes as early blockers, not as
something to discover only after a hook or push failure.

If `next`, a validator, hook, or task command returns an `ATM_*` code that
needs explanation, route interpretation through `atm-error-code-resolver` and
its shared registry. Do not keep a private error-code table in this skill.

Translate `evidence.nextAction.governanceReadiness` into an immediate
preparation checklist before implementation:

1. Resolve actor identity now, not at commit time.
2. If framework claim is required, inspect `node atm.mjs framework-mode status --json` and acquire the returned `framework-mode claim` before editing framework-critical files. If the same actor left behind a stale-completed temporary framework lock, retry `framework-mode claim` directly and let ATM auto-reconcile it; do not invent a skill-side lock override.
3. If the route is on a protected or shared branch, run `node atm.mjs doctor --json` before the first governed write so readiness blockers surface early.
4. Use `governanceReadiness.upstreamRef` when present and run `node atm.mjs hook pre-push --base <upstream-ref> --head HEAD --json` proactively before the final push, or earlier once the branch is ahead, so git-head evidence and branch-queue blockers show up before the real push.
5. Treat `queueRetryCodes` as a shared-branch retry contract, not as an unexpected raw Git failure.
6. If `doctor`, `integration verify`, or `integration list` reports other installed adapters as `stale`, first decide whether they are merely behind the current template generation. If they are old-template parity drift rather than local hand edits, refresh the installed adapter set together instead of selectively ignoring them.

During implementation, treat obvious static hygiene as part of finishing the
same lane, not as optional follow-up polish:

1. If you touch code and immediately see syntax, import, type, or adapter-native static-check failures in the same area, fix them before calling the task done.
2. If touched or staged files introduce new warnings, clear those warnings in the same lane whenever the fix is local and low-risk.
3. Do not widen into repo-wide warning cleanup unless the route explicitly asks for it; prefer touched-scope cleanup plus a later governed backlog item for historical debt.
4. Treat this as the default operator habit even before a lower hook or validator makes it mandatory.

When adapter parity is stale across multiple installed editors:

1. Confirm the repo is on the intended template/source snapshot.
2. If the stale adapters are simply behind the current snapshot, refresh all installed adapters in one pass instead of treating each editor as an unrelated incident.
3. Re-run `doctor` after the refresh and only continue once the shared parity state is green again.
4. Treat hand-edited adapter customizations as a separate decision; do not overwrite them silently under a parity-only assumption.

When `next`, `team plan`, or `team status` returns Team Agents surfaces, carry
these fields forward instead of compressing them away:

- Crew scale: `teamLevel` / `--team-size L1..L5`.
- Provider routing: `--role-provider role=provider:model[:sdk][:mode]` and
  provider selection source.
- Execution lane: `team start --execute` means governed provider orchestration;
  plain `team start` writes state only.
- Governance fields: `decisionClass`, `decisionReason`,
  `requiresHumanSignoff`, `requiresAdr`, `violationStatus`,
  `escalationTarget`.
- Evidence surfaces: `runtimeTier`, `atm.teamProviderRunArtifact.v1`,
  `atm.reviewAgentSignature.v1`, `knowledge.query`, and real observability
  events.

If `violationStatus` is `broker-conflict-blocked`, stop write/commit/close
progression and route through the Team Broker resolution artifact. Do not
continue as if it were advisory text.

Typical framework-repo repair route:

```bash
node atm.dev.mjs doctor --json
node atm.dev.mjs integration add claude-code --force --json
node atm.dev.mjs integration add codex --force --json
node atm.dev.mjs integration add copilot --force --json
node atm.dev.mjs integration add cursor --force --json
node atm.dev.mjs integration add gemini --force --json
node atm.dev.mjs integration add antigravity --force --json
node atm.dev.mjs doctor --json
```

For normal task-card work, keep this order fixed:

```text
claim -> implement -> validators -> evidence add -> tasks close -> commit
```

Do not commit a normal task before the matching evidence has been added and
`tasks close` has succeeded.

Framework critical files have one narrow exception to the close timing, not to
the evidence requirement. If `tasks close` is blocked by
`ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE`, keep the active claim and command-backed
evidence, make a governed delivery commit for the scoped non-`.atm`
deliverables, then close with:

```bash
node atm.mjs tasks close --task <task-id> --actor "$ATM_ACTOR_ID" --status done --historical-delivery <commit> --json
```

After that close succeeds, make a separate closure commit for the ATM ledger
updates. Do not treat the critical-diff gate as permission to skip ATM or close
without evidence.

## Route Command

Use this ATM command only after the first command confirms it is the current governed route:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

For collaboration workflows, claim the selected imported task before edits:

```bash
node atm.mjs next --claim --actor "$ATM_ACTOR_ID" --prompt "$ARGUMENTS" --json
```

For one exact task id, prefer:

```bash
node atm.mjs next --claim --actor "$ATM_ACTOR_ID" --task TASK-ABC-0001 --json
```

If the route returns `recommendedChannel: "batch"`, do not manually run
`tasks reserve`, `tasks promote`, `tasks claim`, or `tasks close` in a loop.
Work only on the queue head, do not commit before checkpoint, and finish it
through:

```bash
node atm.mjs batch checkpoint --actor "$ATM_ACTOR_ID" --json
```

Batch is the fast path for many task cards. Its speed comes from automated queue
bookkeeping, not from weaker delivery or evidence requirements.
After checkpoint succeeds, commit the queue-head deliverables together with the
matching `.atm/history/tasks/<task>.json`, `.atm/history/evidence/<task>.json`,
and `.atm/history/task-events/<task>/` files.

If `next --task <id>` resolves one planning-repo Markdown card but
`next --claim` returns `ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED`, import that
single task card path first instead of widening to the whole planning document.
Use the narrowest materialization lane that makes the selected card claimable.

If `next --claim` reports dependency blockers and the blocker detail says the
prerequisite task snapshots are `missing`, do not assume the implementation is
still undone. Check the planning-source task status and refresh/import the
missing prerequisite snapshots before redesigning the work.

If a dependency blocker says `source-done-governance-incomplete`, do not treat
it as missing product work. Resolve the target-ledger closure proof through the
governed reconcile or attestation path before widening scope or redoing the
implementation.

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

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel task model, registry, or approval flow.
- Treat any planning hint as CLI output, not as template authority.
- If ATM recommends batch, use `batch checkpoint`; do not hand-roll a lifecycle
  loop over low-level `tasks` commands.
- If an `ATM_USER_NOTICE` message or `evidence.userNotice` is present, show it to the user in natural language before executing the returned next action.
- After an onboarding or refresh command succeeds, return to the user original request and continue the actual work.
- Do not link or junction a disposable worktree's `node_modules` back to the
  main repo. In npm workspace repos, cleanup can follow reparse points and
  remove tracked `packages/*` or `examples/*` files from the main worktree.
- Treat `ATM_ACTOR_ID` as the default actor identity variable. `AGENT_IDENTITY`
  is legacy-compatible only.

Keep this flow inside ATM CLI routing. Preserve host edits and rely on install manifest hashes for uninstall safety.
