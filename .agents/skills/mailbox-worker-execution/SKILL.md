---
name: mailbox-worker-execution
description: Mailbox worker execution workflow. Use for worker intake threads that claim a dispatch, read the full card, complete the card's required work, and only then report completion.
---

# Mailbox Worker Execution

## Purpose

This skill is for mailbox worker threads such as `001`, `002`, and `003`.

The worker's job is not to "reply nicely" or "fill a report template".
The worker's job is to:

1. first read `C:\Users\User\3KLife\docs\ai_atomic_framework\ATM開發實務操作指南.md`
2. claim or read the active dispatch
3. read the dispatch card fully
4. complete the required work inside the allowed scope
5. run the required validators or checks
6. only then report completion
7. immediately notify the main captain thread after the formal report is sent

## First-Read Rule

Before doing any dispatch work, the worker must first read:

`C:\Users\User\3KLife\docs\ai_atomic_framework\ATM開發實務操作指南.md`

This is a mandatory first step for every worker thread.

Do not skip this step.
Do not treat the dispatch card as the only document.

## Core Rule

Treat the active dispatch card as the authority.

The worker must follow the card's:

- scope
- deliverables
- validators
- Report Contract
- write authority boundary

## Read-Fully Rule

If a dispatch is active, read the dispatch card fully before acting.

Do not reduce the task to:

- "I saw the card"
- "I acknowledged the card"
- "I sent a report"

## Completion Rule

A worker may report completion only when the card's required work is actually done.

The worker may not mark done merely because:

- the card was read
- the card was claimed
- one command was run
- one validator passed
- a report body was drafted

## Partial Work Is Not Completion

Running only a subset of the card requirements is not enough.

The worker must not send a completion report if it has not yet completed:

- the required work
- the required validator coverage
- the required evidence level

## Blocker Rule

If the worker cannot finish the required work, it must report a blocker honestly.

Do not pretend completion.
Do not send a "PASS" style report when the work is incomplete.

## Report Rule

When the work is actually complete:

- follow the dispatch card's Report Contract exactly
- include command-backed evidence when required
- list what was actually changed or touched
- be explicit about validator PASS/FAIL

Do not send thin reports like:

- `ok`
- `done`
- `PASS` without details

## Immediate Captain Notification

After the worker successfully sends the formal mailbox report, it should also immediately send a short direct message to the main captain thread.

That direct message is not the formal report.
It is only a wake-up notification so the captain does not have to wait for the next heartbeat cycle.

The notification should include:

- worker id
- dispatch id
- whether the work was reported as done or blocked
- the mailbox report path if known

Suggested message:

```text
worker=<id> dispatch=<dispatchId> status=<done|blocked> report=<reportPath if known>
```

## Safe Default

If uncertain whether the card is truly complete, the safe default is:

- do not mark done
- explain what remains
- report blocker / uncertainty

## Thread Behavior

If the card says the work is too large or should use a stronger model, the intake thread should escalate per the local worker prompt.

If the work is appropriate for the current worker thread, the worker should do the complete allowed work, not just a token action.
