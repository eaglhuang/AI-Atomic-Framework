import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const files = [
  'packages/cli/src/commands/hook/pre-commit/support.ts',
  'packages/cli/src/commands/hook/pre-commit/cross-task-admission.ts',
  'packages/cli/src/commands/hook/pre-commit/failure-envelope.ts',
  'packages/cli/src/commands/broker/types.ts'
];

for (const relativePath of files) {
  const source = readFileSync(path.join(root, relativePath), 'utf8');
  assert.doesNotMatch(
    source,
    /(?:\b(?:readonly\s+)?\w+\??\s*:\s*|Record<string,\s*)any\b/,
    `${relativePath} must keep its hook/broker boundary types explicit`
  );
}

console.log('[pre-commit-no-explicit-any] ok');
