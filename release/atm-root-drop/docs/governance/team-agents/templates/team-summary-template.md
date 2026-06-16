<!-- doc_id: doc_team_tmpl_team_summary -->
# Team Summary Template

Use this template for the coordinator or Captain closeout summary after role
reports and validators are complete.

## Decision

- `<done | closeout-ready | blocked-by-scope-gap>`
- Decided by: `<agent id>`
- Decision time: `<RFC3339 timestamp>`

## Implementation Summary

- Files added:
  - `<path>`
- Files modified:
  - `<path>`
- Files deleted:
  - `<path>`
- Behavior delta:
  - `<docs-only | runtime delta summary>`
- Scope drift:
  - `<none | description>`

## Validators

| Validator | Command | Exit | Notes |
| --- | --- | --- | --- |
| typecheck | `npm run typecheck` | 0 | |
| focused | `node --strip-types scripts/validate-team-agents-templates.ts --task TASK-TEAM-0004` | 0 | |
| diff hygiene | `git diff --check` | 0 | |

All close-ready summaries must record the actual exit code for every required
validator.

## Evidence

- Evidence file:
  - `.atm/history/evidence/<TASK-ID>.json`
- command runs:
  - `<count>`
- artifact paths:
  - `<path>`
- Close command:
  - `node atm.mjs tasks close --task <TASK-ID> --actor <actor-id> --status done --json`
- Close result:
  - `<closed | blocked | not-run>`
- Commit SHA:
  - `<sha or none>`

## Risk

- Residual risk: `<risk>`
- Downstream impact: `<impact>`
- Suggested follow-up card: `<task id or none>`

## Close-Ready

- Close-Ready: `<yes | blocked-by:<reason>>`
- Required before yes:
  - deliverables exist
  - validators pass
  - evidence is recorded
  - close command succeeds
