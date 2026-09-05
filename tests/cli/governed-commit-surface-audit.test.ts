// ATM-GOV-0410: keep every governed commit surface bound to an isolated index.
// This is a source-level contract audit: it does not invoke a commit or mutate
// the repository index, so it can run safely while another lane owns WIP.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

const commitCommand = read('packages/cli/src/commands/git-governance/implementation/commit-command.ts');
const indexTransaction = read('packages/cli/src/commands/git-governance/implementation/git-index-transaction.ts');
const recordCommit = read('packages/cli/src/commands/git-governance/implementation/record-commit-command.ts');
const sharedDelivery = read('packages/cli/src/commands/broker/batch-execute-actions.ts');

assert.match(commitCommand, /withTaskScopedCommitIndex/);
assert.match(commitCommand, /candidateFiles/);
assert.match(indexTransaction, /runWithSealedTaskScopedCommitIndex/);
assert.match(indexTransaction, /withTaskScopedCommitIndex/);
assert.match(sharedDelivery, /runSharedDeliveryCommitTransaction/);
assert.match(sharedDelivery, /temporaryIndexPath/);
assert.match(recordCommit, /readStagedFiles/);
assert.match(recordCommit, /ATM_GIT_RECORD_COMMIT_STAGING_AMBIGUOUS/);
assert.match(
  recordCommit,
  /explicitPaths\.length > 0 && stagedFiles\.length > 0/,
  'record-commit must reject a non-empty caller index before staging',
);
assert.match(
  recordCommit,
  /requires an empty index so it cannot absorb pre-existing staged work/,
);

console.log('[governed-commit-surface-audit:test] ok');
