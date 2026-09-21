import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectHistoricalCommitScopePatrol } from '../../packages/cli/src/commands/doctor/commit-scope-patrol.ts';

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
}

function createRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-commit-scope-patrol-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'test');
  git(root, 'config', 'user.email', 'test@example.com');
  return root;
}

test('flags a commit whose paths span task scopes', () => {
  const root = createRepo();
  writeFileSync(path.join(root, 'TASK-PRF-0004.txt'), 'a');
  writeFileSync(path.join(root, 'TASK-PRF-0006.txt'), 'b');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'cross scope', '-m', 'ATM-Task: TASK-PRF-0004');
  const result = inspectHistoricalCommitScopePatrol(root);
  assert.equal(result.ok, true);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0].pathTaskIds, ['TASK-PRF-0004', 'TASK-PRF-0006']);
});

test('does not flag a single task commit', () => {
  const root = createRepo();
  writeFileSync(path.join(root, 'TASK-PRF-0004.txt'), 'a');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'single scope');
  const result = inspectHistoricalCommitScopePatrol(root);
  assert.equal(result.findings.length, 0);
});

test('extracts complete dated backlog IDs instead of the year prefix', () => {
  const root = createRepo();
  writeFileSync(path.join(root, 'ATM-BUG-2026-09-001.json'), 'a');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'backlog scope');
  const result = inspectHistoricalCommitScopePatrol(root);
  assert.equal(result.findings.length, 0);
});
