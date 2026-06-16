<!-- doc_id: doc_governance_batch_playbook -->
# ATM Batch Playbook

> **Audience**: AI agents working through any ATM-governed editor integration (Claude Code, Codex, Copilot, Cursor, Gemini, Antigravity/Windsurf).
> **Owner**: `atm.integration-playbook-map`
> **Status**: canonical reference — all editor integrations must point here.

This document is the **single source of truth** for how an AI agent uses ATM.
The `node atm.mjs next --json` runtime output (`atm.channelPlaybook.v1`) and
every editor adapter's skill manifest reference this document; if the runtime
output and this document disagree, this document wins and the runtime must be
updated.

---

## Quick orientation

ATM exposes three working channels. Pick the one that matches your situation:

| Channel | When to use | Closure path |
|---|---|---|
| **batch** | You have a fixed list of related tasks (e.g. 16 tasks for a milestone). | `batch checkpoint` closes the queue head and advances. |
| **normal** | You have exactly one explicit task card. | `tasks close` after evidence. |
| **fast** | Small, low-risk edits (typos, comments, tiny fixes) that don't deserve a task card. | One commit; no task close. |

If you are unsure, run:

```bash
node atm.mjs next --prompt "<what the user asked>" --json
```

The `channelPlaybook.channel` field in the response tells you which channel
ATM picked.

---

## Channel 1: Batch playbook (P0)

Batch mode is for moving through a known set of tasks in dependency order
without re-claiming each one manually.

### Batch playbook states

The `atm.channelPlaybook.v1` response includes a `state` field that tells you
which of the three batch phases you are in:

| State | Meaning | First required command |
|---|---|---|
| **`queue-preview`** | ATM has built a task queue but you have not claimed any task yet. This is a read-only preview — no lock, no active head. | `node atm.mjs next --claim --actor <id> --prompt "<prompt>" --json` |
| **`queue-head-active`** | A task is the current queue head. Only work on that head; do not skip ahead or switch to single-task flow. | `node atm.mjs batch checkpoint --actor <id> --json` after delivering the head. |
| **`repair-required`** | The batch runtime is inconsistent (e.g. `batchRun.json` and `task-queue` disagree). **Do not continue work** until ATM reports the batch is clean. | `node atm.mjs batch repair --actor <id> --batch <batchId> --json` |

If ATM returns `state: 'repair-required'`, stop immediately and run the
`repairCommand` printed in the playbook before touching any task files.

### Mental model in plain words

- You ask ATM to claim a batch of tasks (or a planning doc that contains them).
- ATM gives you **one task at a time** as the "queue head".
- For each queue head: **implement → evidence → checkpoint → commit**.
- Normal one-task work does **not** stop at validators or evidence; it ends only after `tasks close` has been run and recorded.
- `batch checkpoint` closes the current queue head and advances; ATM picks the
  next one from the same `batchId`.
- You commit **once per task**, packaging deliverables + ATM ledger entries
  together.

### Canonical command sequence

```bash
# 1. Start the batch
node atm.mjs next --claim --actor <id> --prompt "<plan or task list>" --json

# 2. For each queue head, repeat steps 2.1 - 2.6
#    2.1 Implement the real non-.atm deliverables
#    2.2 Run validators required by the task card
#    2.3 Capture evidence
node atm.mjs evidence add \
  --task <queue-head-task-id> \
  --actor <id> \
  --kind test \
  --freshness fresh \
  --summary "<what passed>" \
  --artifacts <real-files> \
  --validators <validator-name> \
  --command "<command>" \
  --exit-code 0 \
  --stdout-sha256 sha256:<hash> \
  --stderr-sha256 sha256:<hash> \
  --json

#    2.4 Stage deliverables + evidence (but do not commit yet)
git add <deliverables> .atm/history/evidence/<queue-head-task-id>.json

#    2.5 Checkpoint to close this task and advance the queue
node atm.mjs batch checkpoint --actor <id> --json

#    2.6 Commit deliverables + checkpoint state in one commit
git add .atm/history/tasks/<queue-head-task-id>.json \
        .atm/history/task-events/<queue-head-task-id>/
git commit -m "<scope>: complete <queue-head-task-id>"

# 3. The next queue head is automatically claimed by checkpoint.
#    Repeat step 2 until batch returns "batch complete".
```

### Do

- Trust ATM to own the queue order — don't pre-pick tasks.
- Add evidence **before** checkpoint so closure_packet is complete.
- Keep one commit per task; never lump two tasks into one commit.
- Read `batch status --batch <id>` to see where you are after interruptions.
- For normal single-task work, never stop after evidence: finish the delivery with `tasks close` before you commit.

### Don't

- ❌ Do not run `tasks reserve` / `promote` / `claim` / `close` manually
  during a batch. Those are low-level / maintainer commands; in batch mode
  ATM owns lifecycle.
- ❌ Do not run `next --prompt` with a later single task id to leave batch;
  use `batch checkpoint` to advance.
- ❌ Do not commit before `batch checkpoint` succeeds.
- ❌ Do not close later tasks before the queue head is delivered.
- ❌ Do not use `.atm/history/**` changes alone as the deliverable; deliverables
  must be real non-`.atm` files declared by the task card.

### Common errors and what they mean

| Error code | Plain meaning | Fix |
|---|---|---|
| `ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE` | Framework critical files are still modified (e.g. uncommitted `packages/cli/src/*.ts`). | Make a governed delivery commit, then close with `--historical-delivery <commit>` or follow the checkpoint repair command ATM prints. |
| `ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID` with `missing: ['validationPasses/...']` | Closure packet is missing required validator evidence. | Run the validator, attach evidence with `--validators <name>`, then checkpoint. |
| `ATM_TASK_SCOPE_EXPANSION_REQUIRED` | A staged or pending file is outside `taskDirectionLock.allowedFiles`. | Use `tasks scope --add <paths>` (do NOT edit lock JSON directly). |
| `ATM_BATCH_CONTEXT_ACTIVE` | You are inside a batch and tried to use single-task flow. | Use `batch checkpoint` instead of `tasks close`. |
| `ATM_RUNNER_SYNC_REQUIRED` | The frozen `atm.mjs` is older than `packages/cli/src/`. | Run `npm run build`, or use `node atm.dev.mjs` for source-first validation. |

### Framework critical close gate

Framework critical files have a narrower close path than ordinary task files.
The normal task lifecycle is still:

```text
claim -> implement -> validators -> evidence add -> tasks close -> commit
```

If `tasks close` is blocked by `ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE`, do not
edit ledger files by hand and do not ignore the gate. The gate means ATM cannot
close the task while framework critical deliverables are still an uncommitted
working-tree diff. The governed repair path is:

```text
governed delivery commit -> tasks close --historical-delivery <commit> -> closure commit
```

The delivery commit must contain the scoped non-`.atm` deliverables that were
implemented under the active claim and validated with command-backed evidence.
Then `tasks close --historical-delivery <commit>` verifies that earlier commit
instead of trusting an empty working tree. The final closure commit records the
ATM ledger updates produced by `tasks close`.

This is not a weaker evidence rule. It exists so agents do not confuse a
critical-diff close gate with permission to bypass ATM. Validators and evidence
are still required before the task can close.

### Resuming after interruption

If your session was interrupted (context switch, crash, power loss):

```bash
# See where you are:
node atm.mjs batch status --batch <batchId> --json

# Or, with the comprehensive view:
node atm.mjs status --json
```

The response includes one of these phases:
`ready-to-implement` / `evidence-missing` / `checkpoint-required` /
`commit-window-open` / `repair-required` / `safe-to-continue`, plus the
exact `requiredCommand` to resume.

---

## Channel 2: Normal playbook (single task)

Use this when the user explicitly selects one task card.

```bash
# 1. Claim
node atm.mjs next --claim --actor <id> --prompt "<task id or description>" --json

# 2. Implement the real non-.atm deliverables
# 3. Run required validators
# 4. Capture evidence (same shape as batch step 2.3 above)
# 5. Close the task
node atm.mjs tasks close --task <task-id> --actor <id> --status done --json

# 6. Commit deliverables + ledger entries together
git add <deliverables> \
        .atm/history/tasks/<task-id>.json \
        .atm/history/evidence/<task-id>.json \
        .atm/history/task-events/<task-id>/
git commit -m "<scope>: complete <task-id>"
```

For ordinary files, keep the lifecycle in this exact order:

```text
claim -> implement -> validators -> evidence add -> tasks close -> commit
```

For framework critical files, use the same claim, validation, and evidence
requirements. The only exception is close timing: if `tasks close` reports
`ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE`, first make a governed delivery commit
for the real scoped deliverables, then close with:

```bash
node atm.mjs tasks close --task <task-id> --actor <id> --status done --historical-delivery <commit> --json
```

After that close succeeds, make a separate closure commit for the generated
ATM task, evidence, and task-event ledger updates.

### Historical batch reconstruction

When a real delivery already landed as one coherent commit package, use
`evidence historical-batch` to reconstruct per-task evidence slices without
pretending the work was validated one card at a time. See
`docs/governance/historical-batch-evidence.md` for the full operator flow.

### Don't

- ❌ Do not manually `tasks reserve / promote / claim` before `next --claim`.
- ❌ Do not close without real non-`.atm` deliverables.
- ❌ Do not commit task closure separately from the deliverable it proves.

---

## Channel 3: Fast quickfix playbook

Only for small, low-risk edits (typos, missing comments, trivial follow-ups
from another card). It is **not** a task-card closure path.

```bash
node atm.mjs next --claim --actor <id> --prompt "<short description>" --json
# Edit ONLY the allowed files returned by ATM
# Run the smallest relevant validator
git add <changed files>
git commit -m "<message>"
```

### Don't

- ❌ Do not edit `.atm/history/**`.
- ❌ Do not close task cards in this channel.
- ❌ Do not expand the scope after the quickfix lock is created.

---

## Cross-channel principles

### Evidence is command-backed

Every closure-quality validator pass must be recorded as evidence with:
- `--command "<exact command line>"`
- `--exit-code 0` (or use diagnostic evidence kind for legitimate `!= 0`)
- `--stdout-sha256` and `--stderr-sha256` (use `evidence run` / `--recent-run`
  to auto-capture when available)

Failed command runs **cannot** be marked as validation passes. Use
`--kind diagnostic` with `--expected-outcome blocked|warn|fail` for gates
that are intentionally non-zero (e.g. a graduation gate reporting "blocked").

### Scope is mutable — through the CLI, never by hand

If you discover during implementation that you need to write a file outside
the task's `allowedFiles`:

```bash
node atm.mjs tasks scope --add path1,path2,path3 --task <task-id> --actor <id> --json
```

One amendment, multiple paths, one audit event. **Never edit
`.atm/runtime/locks/**/*.lock.json` by hand** — ATM treats that as
`ATM_RUNTIME_LOCK_MANUAL_EDIT` and blocks further governed mutations.

### Cross-repo planning tasks

Some task cards have `target_repo` pointing at a **planning repo** (e.g.
the project's design/spec repo, not the framework code repo). For those
cards:
- Deliverables live in the planning repo's working tree.
- ATM CLI still runs from the framework repo for validators and evidence.
- Commit happens in the planning repo, and that commit is the closure.
- Framework `.atm/history/tasks/<task-id>.json` only mirrors the closure;
  the planning repo commit is the source of truth.

### Subagent / parallel execution

ATM may propose safe parallelism only for **non-overlapping**,
**dependency-satisfied** tasks. If two tasks touch the same file, ATM keeps
them serial. Never spin up parallel agents on overlapping scope; the
governance gates assume one-writer-at-a-time per file.

---

## Glossary

| Term | Meaning |
|---|---|
| **batchId** | Stable identifier for a fixed task list. Survives interruptions. Returned by `next --claim --tasks ...` and required by `batch checkpoint`. |
| **queue head** | The current task in a batch. Only one queue head at a time. |
| **taskDirectionLock** | Per-task `.atm/runtime/locks/<task-id>.lock.json` that lists `allowedFiles`, planning paths, and actor. Enforced by pre-tool and pre-commit hooks. |
| **closure packet** | The JSON that proves a task can close. Includes `validationPasses[]`, `diagnosticEvidence[]`, and a manifest of staged files. |
| **commit window** | After `batch checkpoint`, the just-closed task's deliverables remain commitable even though the queue has advanced. See `TASK-AAO-0037`. |
| **scope amendment** | The official way to add files to a task's `allowedFiles` mid-implementation. Goes through `tasks scope --add` and writes an audit event. |
| **command-backed evidence** | Evidence record that contains the exact command, exit code, and stdout/stderr sha256 of a validator run. The only kind accepted as a `validationPass`. |

---

## References

- Runtime playbook source: `packages/cli/src/commands/next.ts` (look for
  `buildChannelPlaybook` / `atm.channelPlaybook.v1`).
- Cross-cutting acceptance plan: `TASK-AAO-0036` and the End-to-End Agent
  Journey Scenario in the AAO planning doc.
- Editor integration adapters that consume this playbook:
  - Claude Code: `.claude/skills/`
  - Codex: `integrations/codex-skills/`
  - Copilot: `.github/`
  - Cursor: `.cursor/rules/skills/`
  - Gemini: `.gemini/commands/`
  - Antigravity/Windsurf: workspace-root instructions
- Reusable template fragments for editor adapters:
  `templates/agent-pack/batch-playbook-fragment.md`,
  `templates/agent-pack/normal-playbook-fragment.md`,
  `templates/agent-pack/fast-playbook-fragment.md`.
