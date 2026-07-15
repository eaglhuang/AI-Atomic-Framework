import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildPreCommitBlockingFindings,
  buildPreCommitFailureEnvelope,
  buildPreCommitRepairHints,
  inspectProtectedAtmStateChanges,
  isPreCommitBaselineFinding,
  isPreCommitEnvironmentFinding,
  isUnconsumedCloseWindowDeferralSnapshot,
  runPreCommitHook,
  selectActionableResidueFindings,
  summarizePreCommitFailureEnvelope
} from '../../packages/cli/src/commands/hook/pre-commit.ts';

const maxLines = 600;
const checkedModules = [
  'packages/cli/src/commands/hook/pre-commit.ts',
  'packages/cli/src/commands/hook/pre-commit/cross-file-consistency.ts',
  'packages/cli/src/commands/hook/pre-commit/failure-envelope.ts',
  'packages/cli/src/commands/hook/pre-commit/implementation.ts',
  'packages/cli/src/commands/hook/pre-commit/input-state.ts',
  'packages/cli/src/commands/hook/pre-commit/scope-ownership.ts',
  'packages/cli/src/commands/hook/pre-commit/support.ts',
  'tests/cli/pre-commit-hook-extraction.test.ts'
];

for (const file of checkedModules) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const lineCount = lines.length;
  const longestLine = Math.max(...lines.map((line) => line.length));
  assert.ok(lineCount <= maxLines, `${file} should stay at or below ${maxLines} lines, saw ${lineCount}`);
  assert.ok(longestLine <= 1000, `${file} should not hide a large module in one long line, saw ${longestLine} chars`);
}

const facade = readFileSync('packages/cli/src/commands/hook/pre-commit.ts', 'utf8').trim();
assert.match(facade, /export \* from '\.\/pre-commit\/implementation\.ts';/);

assert.equal(typeof runPreCommitHook, 'function');
assert.equal(typeof buildPreCommitBlockingFindings, 'function');
assert.equal(typeof buildPreCommitFailureEnvelope, 'function');
assert.equal(typeof buildPreCommitRepairHints, 'function');
assert.equal(typeof summarizePreCommitFailureEnvelope, 'function');
assert.equal(typeof selectActionableResidueFindings, 'function');
assert.equal(typeof inspectProtectedAtmStateChanges, 'function');
assert.equal(typeof isUnconsumedCloseWindowDeferralSnapshot, 'function');
assert.equal(typeof isPreCommitBaselineFinding, 'function');
assert.equal(typeof isPreCommitEnvironmentFinding, 'function');
