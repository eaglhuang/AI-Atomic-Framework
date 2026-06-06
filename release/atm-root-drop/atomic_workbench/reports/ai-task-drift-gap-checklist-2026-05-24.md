# AI Task Drift Gap Checklist (2026-05-24)

## Scope

- Target prompt label:
  `PROMPT_ATM_SELF_ATOMIZATION_FULL_PLAN`
- Prompt meaning:
  analyze the ATM self-atomization master plan, implement the full TASK-ASA queue, write back task artifacts, and commit each task one by one
- Target repo:
  `AI-Atomic-Framework`
- Planning source:
  externally planned TASK-ASA task cards mirrored into `.atm/history/tasks/TASK-ASA-*.json`

## What ATM Did Correctly

1. `node atm.mjs next --prompt "<prompt>" --json` resolved to `ATM_NEXT_TASK_QUEUE_READY`.
2. The queue was correctly scoped to `TASK-ASA-0001` through `TASK-ASA-0016`.
3. Each TASK-ASA item carried:
   `targetRepo: AI-Atomic-Framework`
   `closureAuthority: target_repo`
4. The recommended next action was:
   `node atm.mjs next --claim --actor <id> --prompt "<prompt>" --json`

## Observed Drift

The agent did not execute the required `next --claim` step first.

Instead, it:

1. read broadly across the repo;
2. invented a bundled repair plan around coverage and score outputs;
3. started mutating coverage-related implementation files before task claim and before task-by-task execution.

Previously observed drifted files from this run family:

- `scripts/src/atomize-inventory.js`
- `scripts/src/atomize-score.js`
- `atomic_workbench/atomization-coverage/path-to-atom-map.json`

At the time of this checklist, those three files are clean again in the working tree.

## Verified Gap

Current ATM behavior is good at routing, but still too soft after routing:

- ATM successfully chooses the correct repo and task queue.
- ATM successfully tells the agent to run `next --claim`.
- ATM does **not yet guarantee** that a weak agent will obey that claim step before exploratory reads and opportunistic code edits.

In plain language:

- repo routing works;
- task queue scoping works;
- hard enforcement between `queue-ready` and `first mutation` is still incomplete.

## Repro Steps

Run this in `AI-Atomic-Framework`:

```powershell
node atm.mjs next --prompt "<PROMPT_ATM_SELF_ATOMIZATION_FULL_PLAN>" --json
```

Expected evidence points:

1. `messages[0].code === "ATM_NEXT_TASK_QUEUE_READY"`
2. `evidence.nextAction.command` contains `next --claim --actor`
3. `evidence.nextAction.selectedTasks[0].workItemId === "TASK-ASA-0001"`
4. `evidence.nextAction.selectedTasks[*].targetRepo === "AI-Atomic-Framework"`
5. `evidence.nextAction.selectedTasks[*].closureAuthority === "target_repo"`

## Governance Gaps To Close

1. Pre-mutation claim gate:
   When `next` returns `task-queue-ready`, editor/tool hooks should block write actions until the agent has executed the exact `next --claim` command.

2. Queue-to-task lock coupling:
   After `next --claim`, ATM should require the claimed task id to appear in the active lock or equivalent runtime state before edits to framework code.

3. Prompt-route obedience audit:
   Add a validator that detects:
   `next --prompt` returned a scoped task queue, but no claim event happened before mutation-oriented files changed.

4. Score/coverage self-assertion guard:
   Coverage summary files such as `path-to-atom-map.json` and dogfood score artifacts should be treated as derived evidence.
   Agents should not be able to "improve the score first" without satisfying the task route and evidence route first.

## Suggested Acceptance Checks

An updated governance fix should pass all of these:

1. A weak agent receives the prompt above.
2. ATM routes to `TASK-ASA-0001` queue, not a generic guide flow.
3. The agent attempts to edit framework files before claim.
4. Hook or guard blocks that mutation.
5. The block message tells the agent to execute:
   `node atm.mjs next --claim --actor <id> --prompt "<prompt>" --json`
6. After claim, edits are allowed only for the claimed task scope.

## Current Cleanup Result

- Cleaned:
  drift-generated `atomic_workbench/atomization-coverage/last-score.json`
- Confirmed clean:
  `scripts/src/atomize-inventory.js`
  `scripts/src/atomize-score.js`
  `atomic_workbench/atomization-coverage/path-to-atom-map.json`
- Left untouched on purpose:
  `packages/cli/src/commands/validate.ts`
  This file is still modified in the working tree, but it does not match the three drift files requested for cleanup and may belong to another work stream.
