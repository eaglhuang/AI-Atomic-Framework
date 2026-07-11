import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTempWorkspace, initializeGitRepository } from '../../scripts/temp-root.ts';
import {
  categorizeHistoricalCommitFiles,
  inspectHistoricalDelivery
} from '../../packages/cli/src/commands/tasks/historical-delivery.ts';

function safeRmSync(targetPath: string) {
  try {
    rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // best-effort cleanup for temp workspaces.
  }
}

const declaredFiles = ['src/task-owned.ts', 'release/atm-onefile/atm.mjs'];
const bucketsNoOverlap = categorizeHistoricalCommitFiles({
  taskId: 'TASK-HIST-0049',
  changedFiles: ['src/unrelated-only.ts'],
  declaredFiles
});
assert.equal(bucketsNoOverlap.taskMatchedFiles.length, 0, 'unrelated-only commit must not match task deliverables');
assert.ok(bucketsNoOverlap.outOfScopeSourceFiles.includes('src/unrelated-only.ts'), 'unrelated source must be out-of-scope');

const bucketsMixed = categorizeHistoricalCommitFiles({
  taskId: 'TASK-HIST-0049',
  changedFiles: ['src/task-owned.ts', 'packages/core/src/broker/freeze.ts'],
  declaredFiles
});
assert.ok(bucketsMixed.taskMatchedFiles.includes('src/task-owned.ts'), 'task-owned file must be task-matched');
assert.ok(bucketsMixed.outOfScopeSourceFiles.includes('packages/core/src/broker/freeze.ts'), 'unrelated broker file must be out-of-scope');

const bucketsReleaseAllowed = categorizeHistoricalCommitFiles({
  taskId: 'TASK-HIST-0049',
  changedFiles: ['src/task-owned.ts', 'release/atm-onefile/atm.mjs'],
  declaredFiles
});
assert.ok(bucketsReleaseAllowed.allowedRunnerOutputFiles.includes('release/atm-onefile/atm.mjs'), 'declared runner output must be allowed');
assert.equal(bucketsReleaseAllowed.outOfScopeSourceFiles.length, 0, 'declared runner output must not count as out-of-scope');

const histWorkspace = createTempWorkspace('validate-cli-historical-delivery');
try {
  initializeGitRepository(histWorkspace);
  const ownedPath = path.join(histWorkspace, 'src', 'task-owned.ts');
  mkdirSync(path.dirname(ownedPath), { recursive: true });
  writeFileSync(ownedPath, 'export const owned = true;\n', 'utf8');
  spawnSync('git', ['-C', histWorkspace, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', 'base'], { encoding: 'utf8' });

  const unrelatedPath = path.join(histWorkspace, 'src', 'unrelated-only.ts');
  writeFileSync(unrelatedPath, 'export const unrelated = true;\n', 'utf8');
  spawnSync('git', ['-C', histWorkspace, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', 'unrelated'], { encoding: 'utf8' });
  const unrelatedCommit = spawnSync('git', ['-C', histWorkspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

  const unrelatedInspect = inspectHistoricalDelivery({
    cwd: histWorkspace,
    taskId: 'validate-cli-historical-delivery',
    requestedRef: unrelatedCommit,
    declaredFiles,
    enforceDeclaredScope: true,
    waiverOutOfScopeDelivery: false,
    waiverReason: null
  });
  assert.equal(unrelatedInspect.ok, false, 'historical delivery without task overlap must fail');
  assert.equal(unrelatedInspect.reason, 'no-scoped-deliverable-files', 'must report no scoped deliverable files');

  const freezePath = path.join(histWorkspace, 'packages', 'core', 'src', 'broker', 'freeze.ts');
  mkdirSync(path.dirname(freezePath), { recursive: true });
  writeFileSync(path.join(histWorkspace, 'src', 'task-owned.ts'), 'export const owned = false;\n', 'utf8');
  writeFileSync(freezePath, 'export {};\n', 'utf8');
  spawnSync('git', ['-C', histWorkspace, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', histWorkspace, '-c', 'user.name=ATM', '-c', 'user.email=atm@test', 'commit', '-m', 'mixed'], { encoding: 'utf8' });
  const mixedCommit = spawnSync('git', ['-C', histWorkspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

  const mixedInspect = inspectHistoricalDelivery({
    cwd: histWorkspace,
    taskId: 'validate-cli-historical-delivery',
    requestedRef: mixedCommit,
    declaredFiles,
    enforceDeclaredScope: true,
    waiverOutOfScopeDelivery: false,
    waiverReason: null
  });
  assert.equal(mixedInspect.ok, false, 'mixed commit must fail without waiver');
  assert.equal(mixedInspect.reason, 'out-of-scope-source-files-present', 'must report out-of-scope source files');

  const mixedWaiverInspect = inspectHistoricalDelivery({
    cwd: histWorkspace,
    taskId: 'validate-cli-historical-delivery',
    requestedRef: mixedCommit,
    declaredFiles,
    enforceDeclaredScope: true,
    waiverOutOfScopeDelivery: true,
    waiverReason: 'captain-approved mixed historical delivery for regression'
  });
  assert.equal(mixedWaiverInspect.ok, true, 'mixed commit must pass with waiver and reason');
  assert.equal(mixedWaiverInspect.reason, 'scoped-deliverable-with-waived-out-of-scope', 'must report waived out-of-scope acceptance');
} finally {
  safeRmSync(histWorkspace);
}

console.log('[validate-cli-historical-delivery:test] ok');
