import assert from 'node:assert/strict';
import { selectPreCloseLineBudgetTouchedFiles } from '../../packages/cli/src/commands/taskflow/close-preflight.ts';

const selected = selectPreCloseLineBudgetTouchedFiles({
  cwd: process.cwd(),
  foreignActiveDirtyFiles: [
    'packages/cli/src/commands/taskflow/commit-bundle-assembly.ts',
    '.atm/history/tasks/ATM-GOV-0260.json'
  ],
  readTouched: () => [
    'packages/cli/src/commands/taskflow/commit-bundle-assembly.ts',
    'tests/cli/git-pathspec-emergency-skill-contract.test.ts',
    'packages/cli/src/commands/taskflow/close-preflight.ts',
    '.atm/history/tasks/ATM-GOV-0260.json'
  ]
});

assert.deepEqual(
  selected,
  [
    'tests/cli/git-pathspec-emergency-skill-contract.test.ts',
    'packages/cli/src/commands/taskflow/close-preflight.ts'
  ],
  'pre-close line-budget touched set must drop foreign-active dirty files'
);

assert.ok(
  !selected.includes('packages/cli/src/commands/taskflow/commit-bundle-assembly.ts'),
  'foreign ATM-GOV-0260 assembly WIP must not enter pre-close line-budget scan'
);
assert.ok(
  selected.includes('tests/cli/git-pathspec-emergency-skill-contract.test.ts'),
  'current-task contract test must remain in the pre-close line-budget scan'
);

console.log('close-preflight-foreign-line-budget.test passed');
