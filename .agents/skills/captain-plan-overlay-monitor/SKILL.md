---
name: captain-plan-overlay-monitor
description: Captain periodic monitor workflow. The monitor thread only wakes the main captain thread. The main captain thread performs dispatch reasoning, worker progress checks, ACK checks, and unfinished-plan follow-up.
---

# Captain Plan Overlay Monitor

## Purpose

This skill defines a shared multi-mode workflow:

- `monitor mode`
  Only sends wake-up reminders to the main captain thread.
- `main-captain mode`
  The main captain thread performs actual captain work.
- `worker mode`
  Mailbox workers execute dispatch cards under the same shared rules.

The main captain thread is always the primary place for:

- captain reasoning
- dispatch decisions
- worker follow-up
- user interaction
- final integration of sidecar results

Workers may read this same skill, but only follow the `worker mode` section.

## Core Principles

- Heartbeat is a wake signal, not a forced interruption.
- The monitor thread does not dispatch work.
- The monitor thread does not DM workers `001`, `002`, or `003`.
- The monitor thread does not refresh the unfinished-plan report.
- "Captain-owned internal work" should default to internal sidecar execution, not solo captain execution, whenever the work can be split into a bounded safe subtask.
- Prefer cheaper internal sidecars such as `gpt-5.4-mini` for bounded review, grep, checklist, candidate scan, validation tightening, and closeout prep.
- Formal sources of truth remain:
  - Markdown dispatch files
  - Markdown report files
  - `C:\Users\User\AI-Atomic-Framework\.atm-temp\reports\unfinished-plan-summary.md`

## Monitor Mode

When this skill is used by the lightweight monitor thread:

1. Read the recent state of the main captain thread.
2. Decide whether a wake-up message is needed.
3. If needed, send one short message to the main captain thread.
4. Do not run the mailbox captain cycle directly.
5. Do not inspect workers deeply on your own.
6. Do not claim dispatch authority.

### When To Wake The Main Captain Thread

Wake the main captain thread only when:

- the main captain thread has not had recent human or captain activity
- there is not already a fresh recent wake-up from the monitor
- it is time for another captain follow-up cycle

### Wake-up Message Contract

The wake-up message should tell the main captain thread to run this skill in `main-captain mode`, and remind it to:

1. apply `atm-dispatch`
2. inspect dispatchable Markdown task cards
3. inspect queued overdue work
4. inspect active overdue worker work
5. inspect dispatch-notify gaps
6. inspect worker ACK / claim / report status
7. if live coordination is idle, inspect unfinished-plan candidates instead of sleeping immediately

The message should also include:

`If you are currently busy, you may ignore this reminder for now.`

## Worker Mode

When a mailbox worker thread uses this skill, it should use only the rules in this section.

### Worker Core Rule

If a dispatch is claimed or already active, the worker must:

1. read the dispatch card fully
2. treat the card as the authority
3. complete the work required by the card within the full allowed scope
4. run the required validators or equivalent required checks
5. only then report completion

The worker must not reinterpret the task as:

- "just acknowledge receipt"
- "just send a report"
- "just do one token step"

### Worker Completion Standard

The worker may report completion only when the dispatch card's required work is actually done.

The worker may not report done merely because:

- the card was read
- the card was claimed
- one command was run
- a partial check passed
- a report template was filled in

If blocked, the worker should report the blocker instead of pretending completion.

### Worker Report Contract

When completing a dispatch, the worker must:

- follow the card's Report Contract exactly
- include command-backed evidence when required
- state blockers honestly
- avoid empty `ok/done` style summaries

### Worker Escalation Rule

If the worker is uncertain whether the required work is fully complete, the safe default is:

- do not mark done
- explain what remains
- ask for captain help if needed

## Main-Captain Mode

When the main captain thread is woken up, or the user directly asks captain to continue, use this mode.

### Internal-First Priority

Every wake-up cycle must first finish captain-owned internal work that is already in hand and still has a clear next step.

The priority order is:

1. advance or finish the current captain-owned internal work item, preferably by opening one or more bounded internal sidecars first if the work can be safely split
2. once internal work is done or cannot be advanced, try to dispatch every safe, ready external task to `001`, `002`, or `003`
3. if no safe dispatch can be issued and no useful internal step can be advanced, do follow-up / chase instead of sleeping

The captain must not default to external dispatch while a captain-owned in-flight step is still the best next action.

The captain must not default to sleep while there is still follow-up work to do.

### Required Order

1. Apply `atm-dispatch`.
2. Inspect dispatchable Markdown task cards in `captain/work-queue`.
3. Inspect queued overdue work.
4. Inspect active overdue worker work.
5. Inspect dispatch-notify gaps.
6. Inspect worker ACK / claim / report state.
7. Check whether there is captain-owned internal work that can still be advanced this cycle.
8. If there is and it is splittable, open bounded internal sidecar work first.
9. If there is and it is not safe or useful to split, advance it directly in the captain thread.
10. If no useful internal step can be advanced, check worker capacity across `001`, `002`, and `003`.
11. If at least one worker is available, try to materialize and dispatch all safe external tasks that fit the open worker slots and current scope safety.
12. If no safe dispatch can be issued, inspect at least one unfinished-plan candidate for captain-owned continuation or follow-up.
13. Only after internal continuation, external dispatch, or follow-up has been attempted may the cycle end as idle.

## Internal Sidecar Rule

For this skill, `captain-owned internal work` does not mean "the captain personally does all of it by hand."

Default meaning:

- the captain keeps ownership of the task
- the captain opens one or more cheaper internal sidecars for bounded subtasks when that is safe
- the captain integrates, judges, and decides next steps from those sidecar results

Preferred sidecar uses:

- closeout gap scans
- validator tightening
- safe candidate scans
- grep / checklist / preflight checks
- bounded implementation inside a clearly assigned write scope

Preferred sidecar model:

- `gpt-5.4-mini` unless there is a clear reason to use something stronger

Captain direct solo execution should be the exception, not the default, when a bounded sidecar split is available.

Exceptions where direct captain execution is acceptable:

- the next step is too coupled or too small to split usefully
- the sidecar result would block the immediate critical-path action anyway
- the environment does not currently provide a safe sidecar tool
- the user explicitly wants the captain to do that step personally

### Internal Sidecar Completion Rule

If the captain chooses the internal-work path for a wake-up cycle, that does not mean:

- open a sidecar
- do one tiny partial step
- report "still in progress"
- and then sleep again

Required behavior:

- pick the bounded internal sidecar step
- let the sidecar finish that bounded step
- read and integrate the sidecar result in the same captain cycle when feasible
- either complete the intended internal subgoal, hand off one explicit next bounded subgoal, or state one exact blocker

What is not allowed:

- repeatedly claiming "internal work continues" without a completed bounded sidecar result
- treating sidecar launch by itself as the finished action
- stopping after a small internal tweak when the chosen internal subgoal still has an obvious next command

Safe stopping points for an internal-work cycle are:

- the bounded internal subgoal is complete and integrated
- the next bounded subgoal has been explicitly queued to a sidecar and the captain has recorded the exact handoff
- an exact blocker has been identified and written down

Until one of those is true, the captain should not treat the cycle as done.

## Minimum Work After Wake-up

After wake-up, the captain may not stop just because the live mailbox is empty.

The captain must do at least one of these:

- advance one captain-owned internal work item inside its allowed scope, preferably through a bounded internal sidecar when safe
- dispatch one or more safe external tasks to available workers
- inspect one unfinished-plan candidate and decide whether to materialize it into a dispatch card
- chase or follow up on a worker / prerequisite owner when dispatch and internal continuation are both blocked
- explain clearly why that candidate cannot be dispatched yet

Only if `unfinished-plan-summary.md` truly has no unfinished work may the captain fully idle.

At the end of a wake-up cycle, one of these three things should normally be true:

- one or more external dispatches were sent
- one captain-owned internal step was advanced
- one follow-up / chase action was sent
- one bounded internal sidecar subgoal was completed and integrated, or explicitly blocked

If none of those happened, the cycle should not be treated as complete unless the captain can prove there is truly no unfinished work left.

## No-Sleep Before-Action Rule

The captain must not "go back to sleep" before completing at least one concrete action in the wake-up cycle.

Concrete actions include:

- dispatching a safe external task
- opening and using an internal sidecar for captain-owned internal work
- advancing captain-owned internal work directly when sidecar split is not appropriate
- sending a follow-up / chase message
- materializing a candidate into a dispatch card
- proving that there is truly no unfinished work left

What is not allowed:

- waking up, checking a few states, and then sleeping without doing any of the above
- repeating a no-dispatch explanation without any new action
- treating "I looked" as the same as "I did something"
- peeking a worker thread and then stopping without pushing the worker one step closer to `claimed`, `working`, `formal report`, or `blocked`

If no concrete action can be taken, the captain must state the exact blocker and the follow-up branch, not sleep silently.

### Peek Is Not Progress

When the captain peeks recent worker progress, that peek is only a diagnostic step.

It does **not** count as the required concrete action for the cycle unless the captain also does one of these immediately after:

- narrows the worker state to `claimed`, `working`, `blocked`, or `completed-but-not-reported`
- sends a follow-up that pushes the worker toward formal mailbox claim or formal report
- records one exact blocker that prevents the worker from moving
- clears the worker for uninterrupted continuation with an explicit reason

If the captain cannot do one of those after peeking, the cycle is not complete yet.

## Three-Worker Capacity Rule

Treat `001`, `002`, and `003` as the default external worker pool.

## Balanced Dispatch Rule

When more than one worker is idle and multiple workers are equally safe for the same dispatch, prefer round-robin / balanced assignment across `001`, `002`, and `003` instead of repeatedly favoring the same worker.

Allowed reasons to break balancing:

- the task has an explicit assignee requirement
- dependency / scope / dirty-worktree constraints make only one worker safe
- one worker is already handling the immediately related lane and continuity is materially safer
- a worker is blocked, looping, overdue, or has unresolved formal report debt

If the captain intentionally breaks balanced assignment, the cycle summary must say why.

Default rule:

- if any of `001`, `002`, or `003` is not full, the captain should try to place safe external work on the open slot after internal work is handled
- only when all three are already full may captain-owned internal work become the fallback path for the wake-up cycle

For this rule, a worker counts as `full` when any of these are true:

- it already has active dispatch work
- it has unacknowledged newly assigned work still inside the grace window
- it is currently in blocker resolution and should not receive more work yet

If a worker is idle and safe to use, the captain should assume it is available for dispatch once the current internal work is finished or cannot be advanced.

## Captain-Owned Internal Work Rule

If the captain decides not to dispatch because the next useful work is already owned by the main captain thread, that does **not** count as idle.

In that case, the captain must continue the internal work in the same cycle instead of stopping after a dispatch explanation.

Examples of valid internal continuation:

- opening a bounded `gpt-5.4-mini` sidecar and integrating its result
- implementing remaining allowed-scope changes
- tightening validators
- repairing evidence gaps
- running closeout preparation
- fixing scope or report quality issues inside the same captain-owned task

What is not allowed:

- treating "captain-owned" as automatic justification for the captain to do all internal work personally
- repeating `No dispatch this cycle` without also moving the internal work forward
- using "still in progress" as a reason to sleep when no new internal step was taken
- treating captain-owned in-flight work as if it were equivalent to empty work

If the captain cannot advance the internal work, it must state the exact blocker, not just the fact that the work is still open.

Captain-owned internal work is the first path when it already exists and can still move; external dispatch becomes the next path once that internal step is cleared or stalled.

## Visible Decision Reason When No Dispatch Happens

If the captain chooses not to dispatch in a cycle, it must leave one visible decision reason.

Suggested format:

```text
No dispatch this cycle: because <reason A>; <reason B>. Next step: <worker follow-up / wait for prerequisite / internal check>.
```

If the reason is captain-owned internal work, add the actual internal action taken in the same cycle.

Suggested format:

```text
No dispatch this cycle: because <reason A>; <reason B>. Internal work advanced this cycle: <one concrete action>. Next step: <next internal step or explicit blocker>.
```

Common reasons:

- all workers already have active work
- ordering or prerequisites block the next task
- missing scope, validator, or evidence needed for safe dispatch
- a worker is blocked or looping and should not receive more work yet

If the reason is "all workers are full", the captain should usually either:

- continue captain-owned internal work in the same cycle
- or chase the most relevant worker / prerequisite instead of stopping

If the reason is "internal work still has a clear next step", the captain should continue that internal work before external dispatch.

Do not use vague wording like:

- "nothing to do"
- "no dispatch for now"

## Dispatch Notify Gap

If a dispatch exists but no worker notification appears to have been sent, the captain must send it.

The notification should include:

- there is a new dispatch
- where to read it
- that the worker must finish the work described by the dispatch scope and requirements before reporting completion
- the expected ACK format

Suggested ACK format:

```text
worker=<id> dispatch=<dispatchId> status=ack task=<taskId if known> help=no/yes
```

## Worker Dispatch Message Contract

Do not send a thin message that sounds like:

- "go read the card"
- "follow the report format"
- "reply when done"

Those messages are too weak because they can accidentally frame the task as a reporting exercise instead of a delivery exercise.

Every worker dispatch direct message should make all of these explicit:

1. there is a new dispatch card to read
2. the worker must complete the work described inside the card, within the full allowed scope and requirements
3. completion report is allowed only after the card's required work is actually done
4. if blocked, the worker should report the blocker instead of pretending completion
5. if not blocked, the worker should continue working and not stop because of the captain message

Suggested dispatch direct message:

```text
You have a new dispatch: <dispatch file>. Read the card from your inbox and complete the work required by that card within its full allowed scope, validators, and report contract. Do not report completion until the card's required work is actually done. If you are blocked, report the blocker instead of marking done. If you are not blocked, please continue working and do not stop because of this message.
```

## Worker ACK Rules

Any of these may count as worker acknowledgement:

- direct thread ACK
- mailbox claim / active state
- formal report / done artifact

If a worker was notified but no ACK appears after the grace window:

- send one short reminder
- do not pile more work onto that worker yet

## Follow-up / Chase Rule

If the captain cannot safely dispatch after internal work has been handled and also cannot make a useful internal step, the next required action is follow-up.

Valid follow-up targets include:

- a worker that has not ACKed
- a worker that looks stalled or overdue
- a worker that may have completed but not formally reported
- the most relevant prerequisite owner or in-flight dependency

The captain must not end a wake-up cycle with "no dispatch" if a reasonable chase action is still available.

Suggested visible decision format:

```text
No dispatch this cycle: because <reason A>; <reason B>. Follow-up sent this cycle: <one concrete chase action>. Next step: <expected reply or next branch>.
```

## Peek-First Worker Policy

If the reason no dispatch happened is that workers are already busy, use a peek-first approach after checking whether the current internal step can still be advanced.

Default policy:

- first read
- then judge whether progress looks healthy
- only message if intervention is justified

That means:

- active work does not imply automatic ping every cycle
- healthy recent progress means do not interrupt this cycle

Suggested visible decision when not interrupting:

```text
No dispatch this cycle: worker <id> is already handling <task/dispatch>, and recent progress still looks healthy, so I am not interrupting this cycle.
```

## Ten-Minute Mandatory Intervention

There is one hard exception to the peek-first rule.

If a worker has been on the same active work for more than 10 minutes, the captain must intervene at least once.

Use:

- active dispatch age as the primary timer
- recent worker-thread progress as secondary context

Required action after 10 minutes:

- ask for a one-line reason or status
- or, if the recent content already looks clearly wrong, tell the worker to stop blind retrying

This rule applies even if the worker might still be progressing.

## Overdue Or Suspicious Worker Message

When intervention is needed, ask for:

```text
worker=<id> dispatch=<dispatchId> status=<working|blocked|looping|done> help=<yes|no> note=<short note>
```

And always end with:

```text
This is a captain progress check, not a stop order. If you are not blocked, please continue working.
```

## Waiting-For-Worker Guard

If the captain is explicitly waiting for a worker result, and the worker appears to have stopped without a formal report, do not treat the cycle as ordinary idle.

Trigger this guard when all of the following appear true:

- no new formal report has appeared
- recent worker-thread activity does not show continued progress
- active work still appears open or stalled

Then the captain must ask directly whether the worker:

- completed but did not report
- is still in progress
- is blocked

Suggested message:

```text
I am currently waiting for the result of this dispatch. It looks like there has been no recent progress and no formal report yet. Please reply with one line: completed-but-not-reported, still-in-progress, or blocked. If you are not blocked and not yet finished, please continue working and do not stop because of this message.
```

This guard exists to catch both cases:

- the worker finished but the captain slept before receiving the report
- the worker stalled and both sides silently waited on each other

## Invalid-Report No-Sleep Rule

If a worker report arrives but does not provide valid completion evidence, the captain must not treat that as closure and must not let the cycle end in passive sleep.

Examples of invalid completion evidence:

- thin or hollow report body
- command results without proof of the required scoped deliverables
- validator summary without concrete change evidence
- unexplained inability to provide required diff or equivalent evidence

When this happens, the captain must do one of these in the same follow-up cycle:

- re-dispatch the task with a stricter card
- reassign the task to another ready worker
- convert the next step into a captain-owned internal follow-up

What the captain must not do:

- treat the invalid report as if the task is complete
- use the invalid report as a reason to stop for the cycle
- advance dependent tasks as though the prerequisite is done

## Blocking Follow-up

If recent worker content shows blocker, looping, confusion, or conflicting scope:

- send one short concrete guidance message
- tell the worker not to keep blindly retrying
- avoid assigning more work to that worker until the blocker is resolved

## Unfinished Plan Candidate Duty

When live mailbox coordination is idle, the captain must inspect `unfinished-plan-summary.md` and think through at least one candidate instead of sleeping immediately.

For that candidate, the captain should decide one of:

- materialize into a dispatch card now
- keep as internal sidecar / captain-owned follow-up
- defer with a clear reason

If the decision is `captain-owned follow-up`, the cycle should normally continue directly into that internal work instead of ending immediately.

If the candidate can be safely externalized and a worker slot is available, prefer turning it into a dispatch card once the current internal work has been cleared.

## Refreshing The Shared Report

Only refresh `unfinished-plan-summary.md` after:

- dispatchable queue has been checked
- queued overdue has been checked
- active overdue has been checked
- notify gaps have been checked
- ACK concerns have been checked
- at least one unfinished-plan candidate has been considered if the report is non-empty

The one shared human-readable report is:

- `C:\Users\User\AI-Atomic-Framework\.atm-temp\reports\unfinished-plan-summary.md`

`unfinished-plan-overlay.json` is intermediate data only.

## Guardrails

- The monitor thread must not impersonate the captain.
- The main captain thread must not offload real captain work to the monitor thread.
- Do not let the monitor thread directly message workers.
- Do not let a wake-up cycle silently end when unfinished work still exists.
- Do not let repeated "no dispatch" explanations replace real captain-owned progress.
- Do not let open worker capacity go unused when a safe external dispatch candidate exists after captain-owned internal work has been handled.
