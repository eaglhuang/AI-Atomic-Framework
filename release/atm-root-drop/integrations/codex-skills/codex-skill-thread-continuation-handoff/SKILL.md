---
name: codex-skill-thread-continuation-handoff
description: Create a clean Codex continuation handoff when a thread is too long, needs a fresh restart, or the user wants a new blank thread that inherits the current project's true state, active priorities, and next actions without relying on old chat history. Use when Codex should summarize the current thread into a durable handoff artifact, preserve short/mid/long plans, list dirty state and guarded boundaries, and prepare the next thread to reread repo entry guidance before continuing work.
---

# Codex Skill Thread Continuation Handoff

Use this skill when the current thread has become long, messy, interrupted, or overloaded and the user wants a new clean Codex thread that can continue the same project safely.

The goal is not to copy chat history. The goal is to turn the current thread into a durable handoff that a new thread can reread from disk, then restart from repository truth.

## Workflow

1. Identify the real workspace state.
2. Write a durable handoff document on disk.
3. Create a new blank Codex thread.
4. Make the new thread read the handoff first.
5. Make the new thread rerun the repo entry gate instead of trusting old chat memory.

## Required Handoff Content

Include these sections in the handoff document:

- Current objective:
  State the real active objective, not every past tangent.
- Repository roots:
  Include target repo, planning repo, and any other repo the next thread must know.
- Confirmed completed state:
  List commits, task ids, and closure state that are already done.
- Current dirty state:
  Separate "may touch next" from "must not mix into next commit".
- Mainline priorities:
  Put the real product path first.
- Side routes:
  Keep paper, docs, or research lines separate from the mainline.
- Dispatch rhythm:
  Say what Captain owns versus what workers should do.
- Short / mid / long plan:
  Keep this compact and decision-oriented.
- First commands:
  Tell the next thread exactly what to read and what command to run first.
- Warnings:
  Preserve any important mistakes not to repeat.

## Handoff Rules

- Prefer repo truth over chat claims.
- Preserve exact commit SHAs when they matter.
- Preserve task ids exactly.
- Call out residue, staged files, and runtime-only files explicitly.
- If a repo has a required entry command such as `node atm.mjs next --prompt ... --json`, make the next thread run it again.
- If a repo requires reading `README.md` first, say that explicitly.
- If a workflow has protected boundaries, write them plainly.

## New Thread Prompt Shape

The new thread prompt should be short and procedural:

1. set the requested new title
2. state the repo roots
3. forbid assuming old chat history
4. point to the handoff file path
5. tell the new thread to read the repo entry guidance again
6. require a first status report before implementation

Do not paste the whole handoff into the thread prompt if a file path will do.

## For ATM Repositories

When the project is an ATM repository:

- tell the new thread to read `README.md`
- tell it to run `node atm.mjs next --prompt "<current user request>" --json`
- tell it to surface `ATM_USER_NOTICE` or `evidence.userNotice` before proceeding
- tell it to read `evidence.nextAction.playbook` before edits, commits, or closeout
- distinguish target repo work from planning repo mirrors
- call out `.atm/runtime/team-runs/` as runtime-only when relevant

If Team Agents are part of the working style, tell the next thread to run:

```text
node atm.mjs team plan --task <TASK-ID> --json
node atm.mjs team validate --task <TASK-ID> --json
node atm.mjs team start --task <TASK-ID> --actor <actor> --json
```

before normal claim flow when the task is actually being started.

## Output Pattern

Create one durable handoff file and one new thread.

The handoff file should be specific to the current project and date.
The skill itself stays generic.

## Guardrails

- Do not treat the new thread as a memory dump.
- Do not ask the new thread to trust unstaged assumptions.
- Do not mix unrelated dirty files into the next task plan.
- Do not reopen old closed work unless the handoff says why.
- Do not let the handoff replace the repo entry gate.
