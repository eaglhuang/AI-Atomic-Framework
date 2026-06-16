<!-- doc_id: doc_team_tmpl_patrol_report -->
# Patrol Report Template

## Task

- Task ID: `TASK-TEAM-0006`
- Patrol kind: `<read-only | read-only-with-explicit-write-authority>`
- Goal: `<one-sentence patrol goal>`
- Related task card: `<task card path or id>`
- Intended use: `<daily | claim-preflight | close-preflight | big-script patrol report>`
- Run ID: `<run id>`

## Captain

- Captain agent: `<captain>`
- Captain identity: `<agent identity>`
- Started at: `<RFC3339 timestamp>`
- Team: `<team>`

## Patrol Scope

- Allowed files:
  - `<path>`
- Do-not-touch paths:
  - `.atm/runtime/**`
  - `.atm/history/**`
  - `<out-of-scope path>`
- Out of scope:
  - `<explicit exclusions>`
- Read-only rule: patrols are read-only unless a separate task card grants write permission.

## Patrol Plan

- Read-only by default: `<yes | no>`
- Explicit write authority (if any): `<path or none>`
- Patrol surface:
  - `<file / validator / map / docs>`
- Recommended check slice:
  - `<smallest safe slice>`
- Do-not-cross boundary:
  - `<boundary>`
- Split recommendation:
  - `<keep together | split here>`
- Severity: `<low | medium | high>`

## Validation Plan

| Validator | Command | Expected exit | Notes |
| --- | --- | --- | --- |
| typecheck | `npm run typecheck` | 0 | |
| focused | `node --strip-types scripts/validate-team-agents-templates.ts --task TASK-TEAM-0006` | 0 | |
| diff hygiene | `git diff --check` | 0 | |

## Evidence Plan

- command runs:
  - `<command>`
- artifact paths:
  - `<artifact path>`
- evidence file:
  - `.atm/history/evidence/TASK-TEAM-0006.json`

## Stop Conditions

- validator exit code is non-zero
- required scope path is missing
- `.atm/runtime/**` would be modified
- the patrol would widen beyond read-only without captain approval
- task lock cannot be acquired
- the plan would write outside the declared allowed files
- findings require a different task card

## Worker Report

- worker: 003
- dispatch: R51C
- status:
- captain-corrective-thread-dispatch-used:
- Run ID: `<run id>`
- Team: `<team>`
- Severity: `<low | medium | high>`
- Findings: `<summary of findings>`
- Safe-to-proceed: `<yes | no>`
- Suggested command: `<command or none>`
- Follow-up: `<next action or none>`
- notes:
