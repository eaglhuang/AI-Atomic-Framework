import assert from 'node:assert/strict';
import { parsePorcelainWorktreePaths } from '../../packages/cli/src/commands/next/playbook-projection/active-work-summary.ts';

const porcelain = [
  ' M packages/changed.ts',
  'M  packages/staged-only.ts',
  'MM packages/staged-and-changed.ts',
  '?? packages/untracked.ts',
  ' R packages/renamed-old.ts',
  'packages/renamed-new.ts'
].join('\0') + '\0';

assert.deepEqual(
  parsePorcelainWorktreePaths(porcelain),
  [
    'packages/changed.ts',
    'packages/renamed-new.ts',
    'packages/staged-and-changed.ts',
    'packages/untracked.ts'
  ],
  'dirtyFiles must match the previous diff + untracked contract'
);

assert.deepEqual(
  parsePorcelainWorktreePaths('M  staged-only.ts\0'),
  [],
  'staged-only paths remain owned by readStagedFiles, not dirtyFiles'
);

console.log('governance-readiness git status parser assertions passed');
