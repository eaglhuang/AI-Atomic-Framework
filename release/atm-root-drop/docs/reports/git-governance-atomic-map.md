# git-governance Atomic Map

Task: `TASK-RFT-0020`

Source before split: `packages/cli/src/commands/git-governance.ts`

## Extracted Atoms

| Atom | File | Pattern | Responsibility |
| --- | --- | --- | --- |
| `atm.git-governance.commit-scope-policy` | `packages/cli/src/commands/git-governance/commit-scope-policy.ts` | Policy Object | Path normalization, task-scope matching, governance task id extraction, protected governance path detection, and claim intent normalization. |
| `atm.git-governance.commit-bundle-filter` | `packages/cli/src/commands/git-governance/commit-bundle-filter.ts` | Result Contract helper | Decides whether a file belongs to the governed task bundle and assembles the task-scoped commit file set. |
| `atm.git-governance.governance-residue-policy` | `packages/cli/src/commands/git-governance/governance-residue-policy.ts` | Policy Object | Classifies foreign governance residue that can be deferred and generated residue requiring manual review. |
| `atm.git-governance.atom-file-size-validator` | `packages/cli/src/commands/git-governance/validate-atom-file-size.ts` | Validator Script | Enforces the RFT hard limit that extracted atom/map/script/report source files stay at or below 600 lines. |

## Facade Boundary

`git-governance.ts` remains the command facade and still owns CLI flow, repository I/O, git command execution, live-index mutation, and ATM evidence/commit orchestration.

The extracted atoms are intentionally pure or nearly pure:

- no direct git execution;
- no live-index mutation;
- no task ledger writes;
- stable return shapes that can be tested without a repository fixture.

## Line Budget

All new atom, map, script, and report files in this task are subject to the current 600-line RFT ceiling. The ceiling is passed as a validator parameter (`--max-lines 600`) so later RFT waves can tighten it without changing the validator source. The command used for this task is:

```bash
node --strip-types packages/cli/src/commands/git-governance/validate-atom-file-size.ts --max-lines 600 --files packages/cli/src/commands/git-governance/commit-scope-policy.ts,packages/cli/src/commands/git-governance/commit-bundle-filter.ts,packages/cli/src/commands/git-governance/governance-residue-policy.ts,packages/cli/src/commands/git-governance/validate-atom-file-size.ts,packages/cli/src/commands/git-governance/__tests__/commit-scope-policy.spec.ts,docs/reports/git-governance-atomic-map.md
```

## Proof

- `node --strip-types packages/cli/src/commands/git-governance/__tests__/commit-scope-policy.spec.ts`
- `node --strip-types packages/cli/src/commands/git-governance/validate-atom-file-size.ts --max-lines 600 --files ...`
- `npm run typecheck`
- `npm run validate:cli`
- `node --strip-types scripts/validate-governance-commands.ts --mode validate`
- `node --strip-types scripts/validate-git-hooks-enforcement.ts`
- `git diff --check`

## Follow-Up Candidates

- Extract the live-index staging adapter from `git-governance.ts` after this policy split is stable.
- Reuse the 600-line validator from later RFT cards, then promote it to a shared `scripts/` validator under a separate scoped task.
