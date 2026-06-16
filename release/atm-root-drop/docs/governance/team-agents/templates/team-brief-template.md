<!-- doc_id: doc_team_tmpl_brief -->
# Team Brief Template

Use this template when a coordinator or Captain starts a scoped team run. Keep
the brief Markdown-first, explicit about write authority, and narrow enough that
each assigned agent can tell when to stop.

## Task

- Task ID: `<TASK-ID>`
- Channel: `<fast | normal | batch>`
- Goal: `<one-sentence goal>`
- Related task card: `<task card path or id>`
- Planning source: `<plan path or none>`

## Captain

- Captain agent: `<coordinator | captain | external-dispatcher>`
- Captain identity: `<agent identity>`
- Started at: `<RFC3339 timestamp>`
- Close authority: `<target_repo | planning_repo | captain_only>`

## Team

| Role | Agent ID | Permissions |
| --- | --- | --- |
| coordinator | `<id>` | `task.lifecycle`, `git.write`, `evidence.write` |
| reader | `<id>` | `file.read` |
| scope-guardian | `<id>` | `file.read` |
| implementer | `<id>` | `file.write` |
| validator | `<id>` | `exec.validator` |
| evidence-collector | `<id>` | `file.read` |

Permission notes:

- `file.write` is limited to the allowed files listed below.
- Read-only roles must report findings and must not mutate files.
- External builders require explicit write scope before editing.

## Scope

- Allowed files:
  - `<path>`
- Do-not-touch paths:
  - `.atm/runtime/**`
  - `.atm/history/**`
  - `<out-of-scope path>`
- Forbidden repositories:
  - `<repo path or none>`
- Out of scope:
  - `<explicit exclusions>`

## Atomization Plan

- Primary atom: `atm.team-agents-template-map`
- Related atoms: `<related atom ids>`
- Capability touched: `<capability surface>`
- Command surface: `<commands / scripts / docs>`
- Large-script risk: `<low | medium | high>`
- Map update needed: `<yes | no>`
- Recommended implementation slice: `<smallest safe slice>`
- Do-not-cross boundary: `<boundary>`
- Split recommendation: `<keep together | split here>`

## Assignment

| Role | Assigned Work | Expected Report |
| --- | --- | --- |
| reader | `<files or context to inspect>` | `agent-report` with files read and findings |
| scope-guardian | `<allowed/forbidden scope to verify>` | `agent-report` with scope risks and stop conditions |
| implementer | `<files to change and intended delta>` | `agent-report` with files changed and commands run |
| validator | `<validators to run>` | `agent-report` with command exits and failures |
| evidence-collector | `<evidence to add or verify>` | `agent-report` with artifacts and evidence status |

## Validation Plan

| Validator | Command | Expected exit | Notes |
| --- | --- | --- | --- |
| typecheck | `npm run typecheck` | 0 | |
| focused | `node --strip-types scripts/validate-team-agents-templates.ts --task TASK-TEAM-0004` | 0 | |
| diff hygiene | `git diff --check` | 0 | |

Every required validator must exit `0` before the task can be summarized as
close-ready.

## Evidence Plan

- command runs:
  - `<command>`
- artifact paths:
  - `<artifact path>`
- evidence file:
  - `.atm/history/evidence/<TASK-ID>.json`

## Expected Report

- Each assigned role returns one `agent-report` using
  `docs/governance/team-agents/templates/agent-report-template.md`.
- The coordinator or Captain consolidates reports into one `team-summary` using
  `docs/governance/team-agents/templates/team-summary-template.md`.
- The final report names the claim actor, changed files, validator exits,
  evidence path, close result, commit SHA when available, and scope drift.

## Stop Conditions

- validator exit code is non-zero
- required scope path is missing
- `.atm/runtime/**` would be modified
- `.atm/history/**` would be manually modified outside the ATM CLI lifecycle
- large-script risk exceeds the plan
- task lock cannot be acquired
- the plan would write outside the declared allowed files
- the selected task ID does not match the intended task
