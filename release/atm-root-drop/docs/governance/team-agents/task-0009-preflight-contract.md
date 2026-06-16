# TASK-TEAM-0009 Preflight Contract

## Task

- Task ID: `TASK-TEAM-0009`
- Title: `Team plan dry-run resolver`
- Purpose: define the preflight gate for the next team planning integration card without waiting for another long referee cycle
- Related task cards: `TASK-TEAM-0007`, `TASK-TEAM-0008`

## Dependency Map

- `TASK-TEAM-0007` supplies the captain sizing dry-run contract.
- `TASK-TEAM-0008` supplies the lieutenant escalation rules.
- `TASK-TEAM-0009` consumes both contracts and turns them into a single captain-checkable plan gate.
- `TASK-TEAM-0009` must not introduce a second validator family.

## Acceptance Checklist

- `team plan --task TASK-TEAM-0009 --json` returns a stable dry-run plan.
- The response exposes `dryRun: true`, `runtimeWritten: false`, and `agentsSpawned: false`.
- The response includes the captain decision, team sizing, required roles, optional roles, atomization plan, and stop conditions.
- The response makes `TASK-TEAM-0007` / `TASK-TEAM-0008` dependencies explicit as checklist items, not waiting statements.
- The command stays read-only and does not write `.atm/runtime/**`.
- The plan is closeout-ready when the validator and docs agree on the same acceptance wording.

## Mailbox Materialization Note

The mailbox root cause from R49 was not an intake failure. The failure mode was that a formal dispatch was not materialized into the worker inbox path, so the worker only saw a reminder and no claimable main card.

Corrective dispatch rule:

1. captain writes the real dispatch file to the captain outbox;
2. captain materializes the same file into each target worker inbox;
3. reminder messages may be sent in addition, but they never replace the main dispatch;
4. worker intake only trusts `agents/<id>/inbox/*.dispatch.md` as the claimable source of truth.

## Corrective Dispatch Rules

- Use a real `.dispatch.md` file for every worker.
- Keep the dispatch file name stable between outbox and inbox delivery.
- Do not rely on a thread-only message for intake.
- If a thread is used for corrective dispatch, the thread text must still point to an actual inbox file.

## Captain Handoff

- Next governed move: `TASK-TEAM-0009` planning / referee handoff packet
- Captain-facing use: check the dependency checklist before opening the next integration card
- Reviewer note: this contract is read-only planning guidance, not runtime authority

## Worker Report

- worker: 003
- dispatch: R52-TEAM-M3-20260610T2005+08:00
- status: closeout-ready
- captain-corrective-thread-dispatch-used: yes
- notes: R49-style reminder-only dispatches are insufficient for intake; this contract makes the inbox materialization requirement explicit.
