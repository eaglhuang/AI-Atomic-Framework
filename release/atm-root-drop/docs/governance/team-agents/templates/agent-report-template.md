<!-- doc_id: doc_team_tmpl_agent_report -->
# Agent Report Template

Use this template for every role report produced during a team run. Prefer
short, evidence-backed facts over narrative status.

## Role

- Role: `<coordinator | reader | scope-guardian | implementer | validator | evidence-collector | other>`
- Agent ID: `<id>`
- Agent identity: `<agent identity>`
- Parent task: `<TASK-ID>`
- Assigned work: `<brief assignment>`

## Status

- Status: `<in-progress | done | blocked | needs-review>`
- Round: `<number>`
- Started at: `<RFC3339 timestamp>`
- Reported at: `<RFC3339 timestamp>`
- Scope drift: `<none | description>`

## Files Read

- `<path>`

Use `none` only when the role truly did not inspect files.

## Files Changed

- `<path>` - `<added | modified | deleted | none>`

Read-only roles should report `none`.

## Commands Run

| # | Command | Exit | Notes |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 0 | clean |
| 2 | `node --strip-types scripts/validate-team-agents-templates.ts --task TASK-TEAM-0004` | 0 | all required sections present |

## Findings

- `<finding>`

Include positive confirmations as findings when they unblock closeout, such as
scope checks, validator coverage, or evidence presence.

## Blockers

- `<blocker or none>`

Use `none` only when the agent sees no blocking issue.

## Recommendation

- `<close | continue | escalate>`

## Handoff

- Next actor: `<captain | coordinator | validator | none>`
- Next action: `<action or none>`
