import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  createCommitRangeGuardReport,
  isAncestorCommit,
  normalizeOptionalText,
  parseCommitRangeArgs
} from '../commit-range-guard.ts';
import { CliError } from '../../shared.ts';

const cwd = process.cwd();
const head = 'HEAD';
const base = runGitScalar(cwd, ['merge-base', 'HEAD', 'HEAD~1']) ?? head;

const report = createCommitRangeGuardReport(cwd, base, head);
assert.equal(report.schemaId, 'atm.commitRangeGuardReport.v1');
assert.equal(typeof report.ok, 'boolean');
assert.equal(Array.isArray(report.findings), true);

const emptyRange = createCommitRangeGuardReport(cwd, head, head);
assert.equal(emptyRange.criticalCommits.length, 0);
assert.equal(emptyRange.changedFiles.length, 0);

const parsed = parseCommitRangeArgs(['commit-range', '--cwd', cwd, '--base', base, '--head', head]);
assert.equal(parsed.base, base);
assert.equal(parsed.head, head);

assert.equal(normalizeOptionalText('  x  '), 'x');
assert.equal(normalizeOptionalText(''), null);

if (base !== head) {
  assert.equal(isAncestorCommit(cwd, base, head), true);
}

const narrowBase = runGitScalar(cwd, ['rev-parse', 'HEAD~1']);
if (narrowBase && narrowBase !== head) {
  const narrowRange = createCommitRangeGuardReport(cwd, narrowBase, head);
  assert.equal(typeof narrowRange.ok, 'boolean');
  if (narrowRange.findings.length > 0) {
    assert.equal(narrowRange.ok, false);
    assert.ok(narrowRange.findings.every((entry) => typeof entry.code === 'string'));
  }
}

assert.throws(
  () => parseCommitRangeArgs(['commit-range', '--base', base]),
  (error: unknown) => error instanceof CliError
);

console.log('[commit-range-guard.spec] ok');

function runGitScalar(repoCwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd: repoCwd, encoding: 'utf8' });
  return result.status === 0 && result.stdout?.trim() ? result.stdout.trim() : null;
}
