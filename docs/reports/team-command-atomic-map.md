# TASK-RFT-0021 Team Command Atomic Map

## Summary

`packages/cli/src/commands/team.ts` owned Team command routing, runtime start messaging, backend admission, and role-provider selection in one large command facade. TASK-RFT-0021 extracts the first decision maps into bounded modules so future Team Agent work can change route policy without editing unrelated runtime or closure logic.

Current line budget: `--max-lines 600`. The ceiling is intentionally parameterized through `validate-atom-file-size.ts` so later RFT waves can tighten it without rewriting the validator.

## Atom Plan

Atom: `atm.team-command-strategy-map`

Pattern: Strategy Map plus small Policy helpers.

Owner module: `packages/cli/src/commands/team.ts`

Callers: `node atm.mjs team ...`

Public surface: Team CLI route behavior remains unchanged for `plan`, `start`, `status`, `validate`, `patrol`, lifecycle commands, `wave`, `knowledge`, `broker`, `observability`, and `handoff`.

Focused test: `node --strip-types packages/cli/src/commands/team/__tests__/team-route-map.spec.ts`

CLI regression: `node --strip-types scripts/validate-team-agents.ts`

Out of scope: deeper Team runtime orchestration, handoff ledger, patrol, broker conflict resolution, and provider execution loops.

Commit split: source extraction and focused docs first; runner release sync only if ATM reports frozen runner drift.

## Extracted Modules

| Module | Pattern | Responsibility |
|---|---|---|
| `packages/cli/src/commands/team/team-route-map.ts` | Strategy Map | Classifies raw Team CLI input into fast-path, special-action, status, lifecycle, patrol, or planning routes. |
| `packages/cli/src/commands/team/team-execution-lane.ts` | Strategy Map | Computes start execution result shape and runtime backend admission without embedding message branching in `runTeam`. |
| `packages/cli/src/commands/team/role-provider-resolution.ts` | Policy helper | Loads repo/CLI provider selection and resolves role override precedence for runtime contract construction. |
| `packages/cli/src/commands/team/__tests__/team-route-map.spec.ts` | Focused spec | Locks route classification, execution lane messages, backend admission, and role-provider override behavior. |

## Validation Notes

The extracted modules and focused test passed the parameterized 600-line check:

```powershell
node --strip-types packages/cli/src/commands/git-governance/validate-atom-file-size.ts --max-lines 600 --files packages/cli/src/commands/team/team-route-map.ts,packages/cli/src/commands/team/team-execution-lane.ts,packages/cli/src/commands/team/role-provider-resolution.ts,packages/cli/src/commands/team/__tests__/team-route-map.spec.ts
```

Team hot-file governance required a broker proposal for `team.ts`. The proposal was generated in the OS temp directory and accepted by `broker proposal create`; `team plan --actor "Codex-GPT 5.5" --broker-proposal-file <proposal>` then returned `ATM_TEAM_PLAN_READY`.

`npm run typecheck` currently reaches the extracted Team code cleanly, then stops on an out-of-scope dirty file: `packages/core/src/broker/__tests__/registry-stale-cleanup.test.ts` imports a non-exported `WriteBrokerRegistryDocument` from `packages/core/src/broker/registry.ts`. Those files are outside TASK-RFT-0021 scope and were not modified by this task.

## Lessons

Keep Team command entry routing as a pure route map. Hot Team surfaces are too easy to regress when route handling, provider selection, and runtime execution messages live in the same function.

When a hot-file proposal is needed, pass the actor explicitly. Otherwise stale `AGENT_IDENTITY` can still contaminate broker proposal ownership even when the task claim used the correct actor identity.
