# Team Plan Vocabulary And Roster Drift Cleanup

Status: active

Owner: Team Agents planning/runtime

Purpose: canonical cleanup scope for TASK-TEAM-0065 after TASK-TEAM-0049 was intentionally skipped.

## Canonical Error Codes

| Canonical code | Historical / equivalent code | Meaning |
|---|---|---|
| `ATM_TEAM_WRITE_SCOPE_EXCEEDED` | `ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS` | A write attempt or file.write lease is outside the active Team task scope. |
| `ATM_TEAM_RUNTIME_NOT_AVAILABLE` | `ATM_TEAM_RUNTIME_BACKEND_MISSING` | Requested runtime backend or adapter is not available for the selected Team runtime mode. |
| `ATM_TEAM_AGENT_PROFILE_MISSING` | `ATM_TEAM_RECIPE_NOT_FOUND` | Requested Team role/profile/recipe could not be resolved. |

## Canonical Runtime Vocabulary

`broker-only` is the canonical execution kind for governance-only Team runs. Historical `humanless-disabled` wording is deprecated.

`decisionClass`, `decisionReason`, `requiresHumanSignoff`, `requiresAdr`, `violationStatus`, and `escalationTarget` are runtime-visible fields on Team plan/run/status surfaces. `broker-conflict-blocked` is the canonical blocked violation status for M8E broker conflict enforcement.

When documents use phase labels, they must include the owning document name. The Team Agents automation plan and the Captain-led SOP both use phase language; phase numbers are not globally comparable without the document title.

Coordinator/Captain naming:

| Name | Canonical use |
|---|---|
| Coordinator | Runtime owner of task.lifecycle, git.write, and final evidence authority inside a Team run. |
| Captain | Human or governing planning authority that can approve escalation and dispatch. |
| Lieutenant | Escalated coordination boundary, not a lifecycle owner. |
| Closure Steward | Catalog-ready specialized role, roster-deferred until a dedicated card promotes it. |

`broker-only` has three distinct meanings and must be qualified when ambiguity matters:

| Usage | Meaning |
|---|---|
| runtimeMode | No provider worker is spawned. |
| executionSurface | Governance-only run state is written. |
| provider selection fallback | Provider metadata may exist, but execution is disabled. |

Provider default stance:

- SOP examples may prefer OpenAI-compatible defaults for local dogfood.
- The automation plan may reference Anthropic as the Tier A direct API reference.
- Runtime config must treat provider defaults as repo/configurable policy, not a hard-coded universal default.

## Roster Reconciliation Scope

Planning repo `docs/ai_atomic_framework/team-agents/tasks/README.md` must mirror the target ledger instead of acting as an independent source of truth.

Required planning_repo doc-only cleanup:

- Mark TASK-TEAM-0008, 0009, 0011, 0012, and 0043 through 0045 according to the target ledger.
- Record TASK-TEAM-0028 as abandoned with the reason that its historical planning semantics were superseded by later gate-parity cards.
- Add roster rows for TASK-TEAM-0046 through TASK-TEAM-0052.
- Add TASK-TEAM-0053 through TASK-TEAM-0065 as completion-plan cards when opened.
- Include this L1 through L5 canonical roster scale:
  - L1: Coordinator, Atomization Planner, Implementer, Validator.
  - L2: L1 plus Reader and Evidence Collector.
  - L3: L2 plus Scope Guardian.
  - L4: L3 plus Lieutenant boundary.
  - L5: L4 plus Review Agent and Knowledge Scout.

## Explicit Non-TEAM Scope

Cross-repo mirror triangulation bugs remain in the ATM bug backlog cluster `ATM-BUG-2026-07-10-074`, `077`, `078`, `080`, and `081`. They are not new Team task numbers.

Professional roles Data Pipeline Agent, DB/Container Agent, CI Agent, Web Research Agent, QA Lead, and Closure Steward are catalog-ready and roster-deferred. Do not count them as missing Team runtime roles until a dedicated promotion card assigns runtime semantics.

The stale lock `ATM-FRAMEWORK-TEMP-codex-team-broker` must be released through the formal CLI/runtime release path only. Do not hand-edit `.atm/runtime/**`.

## Skill Surface Sync

Team Agents runtime changes must update the canonical skill templates before an adapter refresh is considered complete. The required surfaces are:

- `templates/skills/atm-dispatch.skill.md` for Captain/dispatch wording, L1 through L5 crew scale, `--team-size`, `--role-provider`, `team start --execute`, governance fields, `team.required`, and `broker-conflict-blocked`.
- `templates/skills/atm-next.skill.md` for returned next-action semantics, execution-lane warnings, evidence surfaces, `runtimeTier`, `atm.teamProviderRunArtifact.v1`, `atm.reviewAgentSignature.v1`, knowledge permissions, and observability events.
- `templates/skills/atm-governance-router.skill.md` for natural-language routing into Team Agents without bypassing the governed `next` / `guide` entry.
- `templates/skills/atm-task-card-authoring.skill.md` for task-card frontmatter and acceptance evidence covering `team.required`, `teamLevel`, role providers, runtime tiers, review signatures, knowledge permissions, and observability event types.
- `templates/skills/atm-evidence.skill.md` for evidence interpretation, hard-gate handling, review signature authority, and knowledge permission boundaries.
- `templates/skills/mailbox-worker-execution.skill.md` for spawned-worker limits: workers never self-close, self-commit, bypass broker, or continue after `broker-conflict-blocked`.

After changing those templates, refresh installed editor surfaces through `node atm.mjs integration add <adapter> --force --json` and verify each installed adapter with `node atm.mjs integration verify <adapter> --json`. Current target adapters are `claude-code`, `codex`, `copilot`, `cursor`, `gemini`, and `antigravity`.
