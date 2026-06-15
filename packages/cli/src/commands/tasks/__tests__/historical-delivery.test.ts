import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  categorizeHistoricalCommitFiles,
  inspectHistoricalDelivery
} from '../historical-delivery.ts';
import { runEvidence } from '../../evidence.ts';

function fail(message: string): never {
  console.error(`[historical-delivery.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function git(cwd: string, args: readonly string[]) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function commitAll(cwd: string, message: string) {
  git(cwd, ['add', '-A']);
  git(cwd, ['-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

const declaredFiles = ['src/task-owned.ts', 'release/atm-onefile/atm.mjs'];
const buckets = categorizeHistoricalCommitFiles({
  taskId: 'TASK-HIST',
  changedFiles: [
    'src/task-owned.ts',
    '.atm/history/evidence/TASK-HIST.json',
    '.atm/history/evidence/OTHER.json',
    'release/atm-onefile/atm.mjs',
    'src/unrelated.ts'
  ],
  declaredFiles
});
assert(buckets.taskMatchedFiles.includes('src/task-owned.ts'), 'task-owned source must be task-matched');
assert(buckets.governanceFiles.includes('.atm/history/evidence/TASK-HIST.json'), 'same-task evidence must be governance');
assert(buckets.allowedRunnerOutputFiles.includes('release/atm-onefile/atm.mjs'), 'declared runner output must be allowed');
assert(buckets.outOfScopeSourceFiles.includes('src/unrelated.ts'), 'unrelated source must be out of scope');
assert(buckets.ignoredFiles.includes('.atm/history/evidence/OTHER.json'), 'other-task governance must be ignored');

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-historical-delivery-'));
try {
  git(repo, ['init']);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'task-owned.ts'), 'export const owned = true;\n', 'utf8');
  commitAll(repo, 'base');

  writeFileSync(path.join(repo, 'src', 'unrelated-only.ts'), 'export const unrelated = true;\n', 'utf8');
  const unrelatedCommit = commitAll(repo, 'unrelated');
  let report = inspectHistoricalDelivery({
    cwd: repo,
    taskId: 'TASK-HIST',
    requestedRef: unrelatedCommit,
    declaredFiles,
    enforceDeclaredScope: true,
    waiverOutOfScopeDelivery: false,
    waiverReason: null
  });
  assert(!report.ok, 'commit without scoped deliverable must fail');
  assert(report.reason === 'no-scoped-deliverable-files', 'missing scoped deliverable reason must be stable');

  writeFileSync(path.join(repo, 'src', 'task-owned.ts'), 'export const owned = false;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'unrelated.ts'), 'export const unrelated = true;\n', 'utf8');
  const mixedCommit = commitAll(repo, 'mixed');
  report = inspectHistoricalDelivery({
    cwd: repo,
    taskId: 'TASK-HIST',
    requestedRef: mixedCommit,
    declaredFiles,
    enforceDeclaredScope: true,
    waiverOutOfScopeDelivery: false,
    waiverReason: null
  });
  assert(!report.ok, 'mixed commit must fail without waiver');
  assert(report.reason === 'out-of-scope-source-files-present', 'mixed commit reason must identify out-of-scope source');
  assert(report.fileBuckets.outOfScopeSourceFiles.includes('src/unrelated.ts'), 'mixed report must preserve out-of-scope bucket');

  report = inspectHistoricalDelivery({
    cwd: repo,
    taskId: 'TASK-HIST',
    requestedRef: mixedCommit,
    declaredFiles,
    enforceDeclaredScope: true,
    waiverOutOfScopeDelivery: true,
    waiverReason: 'captain-approved mixed historical delivery for regression'
  });
  assert(report.ok, 'mixed commit must pass with explicit waiver reason');
  assert(report.waiverApplied, 'waived mixed commit must record waiverApplied');

  mkdirSync(path.join(repo, '.atm', 'history', 'tasks'), { recursive: true });
  writeFileSync(path.join(repo, '.atm', 'history', 'tasks', 'TASK-HIST.json'), JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-HIST',
    status: 'ready',
    scopePaths: ['src/task-owned.ts'],
    deliverables: ['src/task-owned.ts']
  }, null, 2), 'utf8');

  const batchResult = await runEvidence([
    'historical-batch',
    '--cwd', repo,
    '--delivery-repo', repo,
    '--actor', 'tester',
    '--tasks', 'TASK-HIST',
    '--commits', mixedCommit,
    '--validators', 'git diff --check',
    '--validator-command', 'git diff --check',
    '--write'
  ]);
  assert(batchResult.ok, 'historical-batch write must succeed');
  const batchPath = path.join(repo, String(batchResult.evidence.batchPath));
  assert(batchPath.includes(path.join('.atm', 'history', 'evidence', 'historical-batches')), 'historical batch path must be under historical-batches');
  const taskEvidencePath = path.join(repo, '.atm', 'history', 'evidence', 'TASK-HIST.json');
  const taskEvidence = JSON.parse(readFileSync(taskEvidencePath, 'utf8')) as any;
  const record = taskEvidence.evidence?.[0];
  assert(record?.evidenceFreshness === 'historical-reference', 'task slice must be historical-reference');
  assert(record?.details?.historicalBatch?.batchId, 'task slice must reference historical batch id');
  assert(record?.details?.historicalBatch?.matchedFiles?.includes('src/task-owned.ts'), 'task slice must keep matched files');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('[historical-delivery.test] ok');
