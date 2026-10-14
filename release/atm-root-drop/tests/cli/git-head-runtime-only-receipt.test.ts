import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendGitHeadEvidenceJsonl, ensureGovernedGitHeadEvidenceStagedForCommit } from '../../packages/cli/src/commands/git-governance/implementation/git-head-evidence-transaction.ts';
import { writeStagedGitHeadEvidence } from '../../packages/cli/src/commands/hook/pre-commit/input-state.ts';
import { gitHeadEvidencePaths, readLatestGitHeadReceiptTaskId } from '../../packages/cli/src/commands/git-head-evidence.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-head-runtime-only-'));
try {
  const trackedReceipt = path.join(repo, gitHeadEvidencePaths.trackedReceipt);
  appendGitHeadEvidenceJsonl(trackedReceipt, {
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [{
      evidenceKind: 'validation',
      details: {
        actorId: 'fixture-agent',
        taskId: 'TASK-GIT-HEAD-0416',
        git: {
          commitSha: 'a'.repeat(40),
          treeSha: 'b'.repeat(40),
          parentCommitShas: ['c'.repeat(40)]
        }
      }
    }]
  });

  const runtimePath = path.join(repo, gitHeadEvidencePaths.runtimeJsonl);
  assert.equal(existsSync(runtimePath), true, 'raw journal must be written to runtime storage');
  assert.equal(existsSync(trackedReceipt), false, 'runtime evidence must not create a tracked receipt');

  const rawLines = readFileSync(runtimePath, 'utf8').trim().split(/\r?\n/);
  assert.equal(rawLines.length, 1, 'raw journal must retain the complete event separately');
  const raw = JSON.parse(rawLines[0]) as Record<string, any>;
  assert.equal(raw.schemaVersion, 'atm.gitHeadEvidence.v0.1');
  assert.equal(raw.evidence[0].details.git.treeSha, 'b'.repeat(40));
  assert.equal(raw.evidence[0].details.taskId, 'TASK-GIT-HEAD-0416');

  const legacyReceiptPath = path.join(repo, gitHeadEvidencePaths.trackedReceipt);
  mkdirSync(path.dirname(legacyReceiptPath), { recursive: true });
  writeFileSync(legacyReceiptPath, JSON.stringify({
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [{ details: { taskId: 'TASK-LEGACY-RECEIPT-0001' } }]
  }), 'utf8');
  const legacyBytes = readFileSync(legacyReceiptPath, 'utf8');
  assert.equal(readLatestGitHeadReceiptTaskId(repo), 'TASK-GIT-HEAD-0416',
    'runtime receipts take precedence over legacy tracked snapshots');
  assert.equal(readFileSync(legacyReceiptPath, 'utf8'), legacyBytes,
    'legacy receipts remain read-only inputs');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'Runtime Receipt Fixture');
  git('config', 'user.email', 'receipt@example.invalid');
  writeFileSync(path.join(repo, '.gitignore'), '.atm/\n', 'utf8');
  writeFileSync(path.join(repo, 'product.txt'), 'before\n', 'utf8');
  git('add', '--', '.gitignore', 'product.txt');
  git('commit', '-m', 'fixture baseline');
  const parent = git('rev-parse', 'HEAD');
  writeFileSync(path.join(repo, 'product.txt'), 'after\n', 'utf8');
  git('add', '--', 'product.txt');
  const stagedTree = git('write-tree');
  ensureGovernedGitHeadEvidenceStagedForCommit(repo, 'fixture-agent');
  const hookReceipt = writeStagedGitHeadEvidence(repo, ['product.txt'], []);
  assert.equal(hookReceipt.ok, true);
  assert.equal(git('write-tree'), stagedTree, 'wrapper and hook must not alter the staged tree');
  assert.equal(git('diff', '--cached', '--name-only'), 'product.txt');
  git('commit', '-m', 'product repair\n\nATM-Actor: fixture-agent\nATM-Task: TASK-GIT-HEAD-0416');
  assert.equal(git('show', '--format=', '--name-only', 'HEAD'), 'product.txt');
  assert.equal(git('rev-parse', 'HEAD^'), parent);
  assert.equal(git('rev-parse', 'HEAD^{tree}'), stagedTree);
  assert.match(git('log', '-1', '--format=%B'), /ATM-Actor: fixture-agent/);
  assert.match(git('log', '-1', '--format=%B'), /ATM-Task: TASK-GIT-HEAD-0416/);
  assert.equal(git('status', '--porcelain'), '', 'runtime observations must not dirty the product worktree');
  assert.equal(readFileSync(legacyReceiptPath, 'utf8'), legacyBytes);
  console.log('[git-head-runtime-only-receipt] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
