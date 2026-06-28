---
mode: agent
description: Recommend the next official ATM guidance action from current state.
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

## Handoff

```bash
node atm.mjs handoff summarize --task "$ARGUMENTS" --json
```

## Charter Invariants

- `INV-ATM-001` — **No second registry** (enforcement: `gate`, breaking change: yes)
  Rule: A host project must not create a second AtomicRegistry implementation outside of packages/core or introduce a parallel ID allocation, version tracking, or registry promotion path.
- `INV-ATM-002` — **Lock before edit** (enforcement: `doctor`, breaking change: no)
  Rule: No governed file mutation may occur without a valid ScopeLock recorded in .atm/locks/ for the current WorkItem. Agents must call atm lock before editing files.
- `INV-ATM-003` — **Schema-validated promotion only** (enforcement: `gate`, breaking change: yes)
  Rule: An UpgradeProposal must pass all automatedGates (including JSON Schema validation) before promotion. Direct registry mutation that bypasses the UpgradeProposal path is forbidden.
- `INV-ATM-004` — **No competing highest authority** (enforcement: `doctor`, breaking change: yes)
  Rule: No host project rule, profile, or configuration may declare itself to have authority equal to or higher than the AtomicCharter. Any rule that contradicts an invariant must go through a charter waiver proposal.
- `INV-ATM-005` — **Host rule amendments require waiver flow** (enforcement: `waiver-required`, breaking change: no)
  Rule: When a host project rule conflicts with a charter invariant, the host must submit a behavior.evolve UpgradeProposal with a charterWaiver field and a linked HumanReviewDecision. Silent override is not permitted.
- `INV-ATM-006` — **Framework work tracking stays target-local** (enforcement: `doctor`, breaking change: yes)
  Rule: The framework repository must not host downstream adopter planning queues or project-specific work tracking artifacts. ATM framework-development tasks may live in the framework repository only as ATM-managed .atm/history/tasks ledger records with CLI transition evidence.
- `INV-ATM-007` — **Public framework docs remain English-only** (enforcement: `doctor`, breaking change: yes)
  Rule: Public contributor-facing documentation in the framework repository must remain English-only and repository-neutral. Non-English planning notes, local experiments, or downstream operating guidance must live in the coordinating host workspace unless they are translated into neutral English framework documentation.

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel task model, registry, or approval flow.
- Treat any planning hint as CLI output, not as template authority.
- If ATM recommends batch, use `batch checkpoint`; do not hand-roll a lifecycle
  loop over low-level `tasks` commands.
- If an `ATM_USER_NOTICE` message or `evidence.userNotice` is present, show it to the user in natural language before executing the returned next action.
- After an onboarding or refresh command succeeds, return to the user original request and continue the actual work.
- Treat `ATM_ACTOR_ID` as the default actor identity variable. `AGENT_IDENTITY`
  is legacy-compatible only.

Do not introduce a second registry, task state, or approval path.
