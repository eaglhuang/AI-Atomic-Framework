# ATM New User Workflow

A friendly guide for the first day with ATM. Read this once and you will know how to take a single sentence — *"I want users to export a CSV report"* — and turn it into a task that opens, runs, validates, and closes across two repos, without ever hand-editing governance files.

## Who this guide is for

- **Human project owners, tech leads, and PMs** evaluating whether to adopt ATM.
- **AI agents and worker bots** that just landed in an ATM-governed repo and need to know what to do next.
- **New adopter repositories** that do not yet have a host-specific adaptor and want to start with the lowest possible setup.

If you already know the ATM internals (`.atm/history`, closure packets, residue classifiers, governed bundles), this guide is the layer below that. It explains the normal way to use ATM. The internals are still there, but you should not have to touch them by hand.

## The short version (7 steps)

This is the whole normal flow. Everything else in this guide expands on it.

1. **Human describes the work** in plain language. Example: *"I want users to export a CSV report."*
2. **AI drafts a task card** from that sentence (title, goal, scope, validators). The human does not have to write markdown first.
3. **`taskflow open --write`** creates or reuses the planning card and imports it into the target runtime.
4. **AI runs `next --prompt`** to ask ATM what to do next. AI does not guess.
5. **AI runs `next --claim`** to take the task and lock its scope.
6. **AI implements, validates, and records command-backed evidence.**
7. **`taskflow close --write`** closes the target and planning repos, and produces the dual-repo governed commit bundle.

That is the whole loop. Steps 3 and 7 are the only two "magic" commands you really need to memorize.

## Roles in this guide

To keep things readable we use three labels:

- **Human says** — what the human types or asks for in plain language.
- **AI should** — what the AI agent runs or produces.
- **ATM does** — what the framework guarantees behind the scenes.

## Example: from one sentence to a task

> **Human says:** *"I want users to export a CSV report."*

The human did not open an editor. They did not pick a task id. They did not write markdown. That is fine.

> **AI should:**
> 1. Read this sentence as an intent.
> 2. Draft a title (`"Export CSV report"`), a one-paragraph goal, a small list of scope paths, and one or two validators (typecheck, a unit test).
> 3. Run `taskflow open --dry-run` first to preview, then `taskflow open --write` to actually open.

> **ATM does:**
> - Writes the task card into the **planning repo** (adopter repo).
> - Imports it into the **target runtime** as a ledger entry.
> - Returns a task id (e.g. `TASK-APP-0001`).
> - Gives the AI an `orchestrationPlan` so it knows what already happened and what to do next.

The human never opens `.atm/history/`. The AI never writes there either.

---

## Step 1: Preview the task

Dry-run first. Nothing is written. This is your "show me what would happen" command.

```bash
node atm.mjs taskflow open --dry-run \
  --profile <adopter-repo>/taskflow.profile.json \
  --title "Export CSV report" \
  --json
```

> The `<adopter-repo>` placeholder points at your planning or adopter repo, the one that owns the task cards. The framework repo itself does not ship `taskflow.profile.json`; you write one when you adopt ATM. See `docs/specs/taskflow-profile-v1.md` for the schema.

**What you see:**

- A top-level `writeReadinessHint` (`atm.taskflowOpenWriteReadinessHint.v1`) that tells you in plain language whether `--write` will succeed:
  - `status: "ready"` — `--write` is good to go.
  - `status: "fallback"` — profile is missing or in template-only mode; `--write` will fail closed. The `missingPrerequisites` array names exactly which profile policy fields or explicit flags to add.
  - `status: "incomplete"` — profile is loaded but `--task-id` / `--output` were not derivable; same `missingPrerequisites` list applies.
- The `tasks new` command ATM would run to generate the task card (low-level generator surface).
- The `tasks import` command ATM would run to load the card into the target runtime (backend synchronization surface).

**Why this matters:** the `writeReadinessHint` is the one field you read first. You no longer have to dig into `orchestrationPlan.hostPolicy.fallbackBehavior` to learn why `--write` would fail.

## Step 2: Open the task (write)

When the dry-run looks right, swap `--dry-run` for `--write`:

```bash
node atm.mjs taskflow open --write \
  --profile <adopter-repo>/taskflow.profile.json \
  --title "Export CSV report" \
  --json
```

**What ATM does:**

- In **profile-only** mode (the lowest adoption tier), the task card is written into the planning/adopter repo at the canonical path declared by the profile.
- The target repo receives the same card through `tasks import --write` as a runtime ledger entry.
- You do **not** need to touch `.atm/history/` by hand.

If ATM fails closed with `ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK`, your profile is incomplete or the opener is in describe-only mode. Read the diagnostic, fix the profile, then retry.

## Step 3: Ask ATM what to do next

Do not guess. Ask:

```bash
node atm.mjs next --prompt "Export CSV report" --json
```

**Why:** ATM looks at the prompt, the open tasks, the queue, and any active claims, and routes you to exactly one next action. The AI agent should treat this as authoritative. If `next` says "claim this task", claim it. If `next` says "the repository needs bootstrap first", do that first.

When `next` resolves the prompt to a specific task, the result includes a `taskScopedClaimCommand` field — the explicit `--task TASK-XXX` form. **Prefer that command over re-typing the natural-language prompt** in Step 4. It is shorter, more deterministic, and avoids prompt-resolution ambiguity if you retry.

## Step 4: Claim the task

If `next` already resolved to a single task, claim with the explicit task id (recommended):

```bash
node atm.mjs next --claim \
  --actor <actor> \
  --task TASK-XXXX-0001 \
  --json
```

The prompt form still works and is useful when the human did not specify a task id:

```bash
node atm.mjs next --claim \
  --actor <actor> \
  --prompt "Export CSV report" \
  --json
```

**What ATM does:**

- Issues a lease scoped to a specific list of `allowedFiles`.
- Locks that scope so no other agent steps on the same files.
- Records a `claim` event in the task's event stream.

**Why this matters:** after this point the AI knows exactly which files it is allowed to touch. Editing outside that list is a violation, not a creative choice.

## Step 5: Implement and validate

Now the AI does the actual work. The rules are simple:

- **Only edit files inside `allowedFiles`** from the claim response.
- **Run the validators declared on the task card through `evidence run`** when you are ready to record them (typecheck, lint, the focused test, whatever the card listed).
- **Record evidence as command runs**, not as chat summaries or plain terminal history. ATM wants the command, exit code, and output hashes, not "I think it works".

Normal validator capture uses `evidence run`:

```bash
node atm.mjs evidence run --task TASK-XXXX-0001 --actor <actor> --command "npm run typecheck" --validators typecheck --json
node atm.mjs evidence run --task TASK-XXXX-0001 --actor <actor> --command "npm run validate:cli" --validators validate:cli --json
```

Running `npm run typecheck` in a plain terminal can help you debug, but it is not task evidence until ATM captures it with `evidence run`. `evidence add` is the raw/manual surface for operators who already have the exact command, exit code, and sha256 output digests.

If the work pulls in a linked surface that was not in the original `allowedFiles` (a doc, a help snapshot, a test, or a generated artifact), widen the scope through the audited lane instead of editing the lock by hand:

```bash
node atm.mjs tasks scope add --task TASK-XXXX-0001 --actor <actor> --add docs/foo.md --class doc-sync --phase during-implementation --reason "linked doc" --json
```

This records a `scope-amendment` event with its class, phase, and `mode: normal`, and that history stays visible at closeout. `tasks scope repair` is the protected emergency variant — it needs `--emergency-approval` and `--reason` and records `mode: repair`. Reach for it only when a human approved a maintenance exception.

## Step 6: Preview the close

Before closing, dry-run the close. This is the same idea as Step 1, applied to the closeback:

```bash
node atm.mjs taskflow close \
  --task TASK-XXXX-0001 \
  --actor <actor> \
  --dry-run \
  --json
```

**What you see:**

- Which files would be staged in the **target repo** (governance events, closure packet, evidence).
- Which files would be staged in the **planning repo** (task card status update, roster updates).
- Whether the close is safe to run automatically (`normal-close`), needs reconciliation (`historical-delivery-close`), needs planning-mirror repair (`planning-mirror-sync-repair`), needs `repair-closure` (`residue-repair`), or needs a human (`ambiguous-manual-review`).

If `closeMode` is `ambiguous-manual-review`, **stop and bring in a human**. Do not force-close.

## Step 7: Close and commit

When the dry-run looks clean:

```bash
node atm.mjs taskflow close \
  --task TASK-XXXX-0001 \
  --actor <actor> \
  --write \
  --json
```

**What ATM does, by default:**

- Computes the dual-repo governed commit bundle (`atm.taskflowGovernedCommitBundle.v1`).
- **Exact-stages** the listed files in the target repo and the planning repo. Unrelated dirty files are *not* staged.
- **Auto-commits** both repos with deterministic, governed commit messages.
- Returns the commit SHAs.

You did not have to think about which files belong to the bundle. ATM knows, because it has the closure packet, the claim, and the task ledger.

### Stage-only variant

For emergency repair or when the Captain wants to inspect the bundle before committing:

```bash
node atm.mjs taskflow close \
  --task TASK-XXXX-0001 \
  --actor <actor> \
  --write \
  --no-commit \
  --json
```

This stages both repos but does **not** commit. The HEAD of both repos stays where it was. You get back the deterministic commit commands so you can run them yourself after review.

### Fail-closed guarantee

If the planning path is missing or unreadable, `taskflow close --write` fails closed with `ATM_TASKFLOW_CLOSE_COMMIT_BUNDLE_INCOMPLETE` *before* touching the target repo. You do not end up with a half-closed pair where target is closed and planning is not.

---

## Integration levels

You do not have to write a custom adaptor to start using ATM. There are three tiers, and the lowest is good enough for real work.

| Level | What you provide | What you get |
|---|---|---|
| **Profile-only** (recommended starting point) | A `taskflow.profile.json` with task id format, canonical output path pattern, roster policy, opener/closeback metadata. | `taskflow open --write` and `taskflow close --write` work end-to-end across both repos. |
| **Light adaptor** | A small host wrapper that customizes slug/numbering/local status fields. Still calls `taskflow open` and `taskflow close`. | Same governed flow, plus host-specific ergonomics. |
| **Full adaptor / SDK** | A project-specific facade (UI, custom commands) that maps local concepts onto the profile contract and calls ATM under the hood. | Product-grade UX while ATM remains the single governed route. Full adaptors **must not** become a second close authority. |

**Profile-only is a real product, not a placeholder.** A new project should be able to adopt ATM by writing one profile file. If you are stuck because "we have not built the adaptor yet" — you don't need one.

---

## What AI agents must not do

These rules exist because they have been violated, and each violation cost a real recovery cycle.

- **Do not edit `.atm/history/**` by hand.** Ever. Even when "just fixing one field" looks tempting. Governance writes are CLI-only.
- **Do not skip `next`.** The router exists so two agents do not claim the same scope. If you bypass it, you will eventually corrupt the queue.
- **Do not call `tasks close`, `tasks reconcile`, or `tasks repair-closure` as the normal path.** Those are protected backend / emergency surfaces. The official operator lanes are `taskflow open` and `taskflow close`. The backend commands exist for repair and edge cases — they are not your daily driver.
- **`tasks new` and `tasks import` are not protected, but they are still not the normal operator path.** `tasks new` is the **low-level template generator** (no governed lifecycle, no runtime import). `tasks import` is the **runtime synchronization surface** (loads a planning markdown into the target ledger). `taskflow open --write` already calls both internally — invoke them directly only when you have a clear reason (e.g. generating a template offline).
- **Do not use `--force`, `--no-verify`, broad cleanup commands, historical waivers, or `git reset --hard`** unless a human approved emergency maintenance for that specific scope.
- When `--no-verify` is unavoidable, obtain `backend.gitHookBypass` approval (`node atm.mjs emergency approve ... --allowed-flag --no-verify`) and pass `--emergency-approval` to `node atm.mjs git commit`. Inspect the audit trail with `node atm.mjs emergency audit --json`. Authorization is not completion: check `outcome` for `authorized`, `succeeded`, or `failed` plus any `repairCandidate`.
- **Do not claim "source done", "planning done", or "mailbox done" as governed done.** Governed done means the target repo ledger is closed *and* a closure packet exists *and* a close event was recorded. Anything less is not done.

If you find yourself reaching for any of the above, stop and report to the human.

---

## Emergency maintenance

There is a separate lane for legacy recovery, residue repair, stale lock cleanup, waiver issuance, and runner recovery. It is intentionally not part of the daily workflow.

- Emergency operations require **human-approved authorization** (a future protected lease will formalize this).
- Normal feature work **does not** use this lane.
- If the AI is unsure whether something is emergency-only, the answer is: ask a human.

This guide deliberately does not document the protected backend commands in detail. If you need them, you will be told.

---

## Cheat sheet

```bash
# Preview open
node atm.mjs taskflow open --dry-run \
  --profile <adopter-repo>/taskflow.profile.json --title "..." --json

# Open (writes the task card and imports it)
node atm.mjs taskflow open --write \
  --profile <adopter-repo>/taskflow.profile.json --title "..." --json

# Ask ATM what to do next
node atm.mjs next --prompt "..." --json

# Claim the task and lock the scope
node atm.mjs next --claim --actor <actor> --prompt "..." --json

# Preview close
node atm.mjs taskflow close --task TASK-... --actor <actor> --dry-run --json

# Close + default auto-commit (target + planning bundle)
node atm.mjs taskflow close --task TASK-... --actor <actor> --write --json

# Close + stage only (no commit; for Captain review or emergency repair)
node atm.mjs taskflow close --task TASK-... --actor <actor> --write --no-commit --json
```

That's the whole normal workflow. Seven steps, three commands you really need to remember (`taskflow open`, `next`, `taskflow close`), and one promise from ATM: governed work goes through the official lanes, and the daily path does not require touching governance files by hand.

If a step does not feel smooth, that is a product gap, not a user error — please report it. This guide is the contract; the CLI should keep getting closer to it.
