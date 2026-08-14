import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sealCommitBundle } from '../../../../../core/src/commit-attribution/sealed-commit-bundle.ts';
import {
  assertCommitAttribution,
  readCommittedTreeEntries,
  runWithSealedTaskScopedCommitIndex
} from './sealed-commit-attribution.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-sealed-commit-parity-'));
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
mkdirSync(path.join(repo, 'src'), { recursive: true });
writeFileSync(path.join(repo, 'src', 'expected.ts'), 'export const expected = 1;\n');
writeFileSync(path.join(repo, 'src', 'actual.ts'), 'export const actual = 1;\n');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'actual commit'], { cwd: repo, stdio: 'ignore' });
const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const expectedBlob = execFileSync('git', ['hash-object', 'src/expected.ts'], { cwd: repo, encoding: 'utf8' }).trim();

assert.throws(() => assertCommitAttribution({
  sealed: sealCommitBundle({ entries: [{ path: 'src/expected.ts', mode: '100644', blobId: expectedBlob, provenance: 'task-scope', disposition: 'present' }] }),
  actual: readCommittedTreeEntries(repo, commitSha),
  surface: 'test post-commit tree parity', actorId: 'validator', taskId: 'ATM-GOV-0371'
}), (error: unknown) => (error as { code?: string }).code === 'ATM_COMMIT_ATTRIBUTION_MISMATCH');

// A commit can move HEAD before the wrapper regains control. The transaction
// must still fail closed instead of returning a success receipt for a tree
// that differs from its sealed candidate.
writeFileSync(path.join(repo, 'src', 'expected.ts'), 'export const expected = 2;\n');
writeFileSync(path.join(repo, 'src', 'actual.ts'), 'export const actual = 2;\n');
const sealedExpectedBlob = execFileSync('git', ['hash-object', 'src/expected.ts'], { cwd: repo, encoding: 'utf8' }).trim();
const sealedExpected = sealCommitBundle({
  entries: [{ path: 'src/expected.ts', mode: '100644', blobId: sealedExpectedBlob, provenance: 'task-scope', disposition: 'present' }]
});
const headBeforeMismatchedTransaction = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

assert.throws(() => runWithSealedTaskScopedCommitIndex({
  cwd: repo,
  paths: ['src/expected.ts'],
  provenance: 'task-scope',
  actorId: 'validator',
  taskId: 'ATM-GOV-0371',
  surface: 'test sealed transaction',
  sealSource: { kind: 'sealed-bundle', bundle: sealedExpected },
  run: (env) => execFileSync('git', ['commit', '--only', '-m', 'mismatched commit', '--', 'src/actual.ts'], { cwd: repo, env, stdio: 'ignore' })
}), (error: unknown) => (error as { code?: string }).code === 'ATM_COMMIT_ATTRIBUTION_MISMATCH');

assert.notEqual(
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  headBeforeMismatchedTransaction,
  'fixture must prove that the transaction detects a post-commit mismatch after HEAD advances'
);

console.log('[sealed-commit-attribution] committed-tree mismatch fails closed.');
