---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-next
title: ATM Next
summary: Recommend the next official ATM guidance action from current state.
command: node atm.mjs next --prompt "$ARGUMENTS" --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

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

{{ACTOR_IDENTITY_HANDOFF_GATE}}

First command:

```bash
{{firstCommand}}
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

Translate `evidence.nextAction.governanceReadiness` into an immediate
preparation checklist before implementation:

1. Resolve actor identity now, not at commit time.
2. If framework claim is required, inspect `node atm.mjs framework-mode status --json` and acquire the returned `framework-mode claim` before editing framework-critical files.
3. If the route is on a protected or shared branch, run `node atm.mjs doctor --json` before the first governed write so readiness blockers surface early.
4. Use `governanceReadiness.upstreamRef` when present and run `node atm.mjs hook pre-push --base <upstream-ref> --head HEAD --json` proactively before the final push, or earlier once the branch is ahead, so git-head evidence and branch-queue blockers show up before the real push.
5. Treat `queueRetryCodes` as a shared-branch retry contract, not as an unexpected raw Git failure.

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
{{command}}
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
{{handoffs}}
```

## Charter Invariants

{{CHARTER_INVARIANTS}}

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
