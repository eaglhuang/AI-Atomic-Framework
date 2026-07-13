# Team Agents Validator Atomic Map

## Scope

`TASK-RFT-0023` extracts pure validator-suite helpers from `scripts/validate-team-agents.ts` without changing Team Agents product behavior, case names, or assertions.

## Atom List

| Atom | Pattern | Owner module | Caller |
|---|---|---|---|
| `atm.team-agents-validator.scenario-map` | Strategy Map | `scripts/validators/team-agents/scenario-matrix.ts` | `scripts/validate-team-agents.ts` |
| `atm.team-agents-validator.assertions` | Result Contract Object | `scripts/validators/team-agents/assertions.ts` | `scripts/validate-team-agents.ts` |
| `atm.team-agents-validator.artifact-fixtures` | Adapter/Port | `scripts/validators/team-agents/artifact-fixtures.ts` | `scripts/validate-team-agents.ts` |
| `atm.team-agents-validator.reporter` | Facade | `scripts/validators/team-agents/reporter.ts` | `scripts/validate-team-agents.ts` |

## Line Budget

The extracted atom files are checked through the parameterized cap:

```powershell
node --strip-types packages/cli/src/commands/git-governance/validate-atom-file-size.ts --max-lines 600 --files scripts/validators/team-agents/scenario-matrix.ts,scripts/validators/team-agents/assertions.ts,scripts/validators/team-agents/artifact-fixtures.ts,scripts/validators/team-agents/reporter.ts,docs/reports/team-agents-validator-map.md
```

Current extracted-file line counts are 87, 19, 58, and 4 lines respectively.

## Preserved Behavior

- Existing `--case` names remain unchanged.
- The default validator still runs `lieutenant-escalation` plus the always-on wave-mode self-check.
- Scope lease fixtures, handoff runtime fixtures, and source team-run cleanup keep their original data shapes.
- The main validator remains the CLI facade until follow-up cards split individual case families.
