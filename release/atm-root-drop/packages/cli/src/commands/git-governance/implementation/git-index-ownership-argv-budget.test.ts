import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ownershipPath = path.resolve('packages/cli/src/commands/git-index-ownership.ts');
const transactionPath = path.resolve('packages/cli/src/commands/git-governance/implementation/git-index-transaction.ts');
const ownershipSource = readFileSync(ownershipPath, 'utf8');
const transactionSource = readFileSync(transactionPath, 'utf8');

assert.match(
  ownershipSource,
  /forEachPathspecBatch|planPathspecBatches/,
  'git index ownership must route repository-sized metadata path lists through the canonical argv budget planner',
);
assert.match(
  transactionSource,
  /forEachPathspecBatch|planPathspecBatches/,
  'git index transaction must route repository-sized restore path lists through the canonical argv budget planner',
);
assert.match(
  transactionSource,
  /fixedArgs:\s*\[\s*["']ls-files["']|fixedArgs:\s*\[\s*["']restore["']/,
  'batched git index calls must charge their fixed git arguments to the shared budget',
);

console.log('[git-index-ownership-argv-budget] ok');
