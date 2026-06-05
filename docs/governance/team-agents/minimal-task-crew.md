# Minimal Task Crew Briefing Contract

This contract describes the smallest useful team plan for a normal task.

## Required Roles

- `Task Captain`: owns task lifecycle coordination and final decision authority.
- `Atomization Planner`: reviews scope, atomization risk, and file ownership boundaries.
- `Code Builder`: implements the scoped task deliverables.
- `Check Runner`: runs validators and reports pass or fail evidence.

## Optional Roles

- `Reader`: gathers source context when the task needs more discovery.
- `Evidence Collector`: organizes command-backed evidence for the report.
- `Scope Guardian`: watches for out-of-scope file drift.

## Allowed Files

Only files declared by the task card may be written.
The task plan must list those paths explicitly and keep them narrow.

## Do Not Touch

- `.atm/runtime/**`
- `.atm/history/**`
- unrelated source surfaces outside the task scope
- any planning repository files

## Expected Reports

- A `team plan --task <id> --json` result that names the required roles.
- A validation result that shows whether the plan is safe to start.
- A follow-up team run record only when the coordinator chooses to start.

## Stop Conditions

- Stop if the task needs a stronger lane or a broader scope than the plan allows.
- Stop if a required role cannot be assigned uniquely.
- Stop if the plan would write outside the declared allowed files.
- Stop if validators report blocking permission conflicts.
