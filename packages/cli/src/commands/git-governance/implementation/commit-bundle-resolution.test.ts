import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTaskScopedCommitBundle } from './commit-bundle-resolution.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-foreign-residue-'));
execFileSync('git', ['init', '-q'], { cwd });
execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd });
execFileSync('git', ['config', 'user.name', 'ATM Test'], { cwd });
mkdirSync(path.join(cwd, '.atm', 'history', 'evidence'), { recursive: true });
mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
mkdirSync(path.join(cwd, 'src'), { recursive: true });
writeFileSync(path.join(cwd, 'src', 'delivery.ts'), 'export const delivery = true;\n');
writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-CURRENT.json'), `${JSON.stringify({
  workItemId: 'TASK-CURRENT', status: 'running', scopePaths: ['src/delivery.ts', '.atm/history/evidence/TASK-CURRENT.runner-sync-receipt.json'],
  claim: { actorId: 'test-actor', leaseId: 'lease-current', claimedAt: '2026-08-09T00:00:00.000Z', heartbeatAt: new Date().toISOString(), ttlSeconds: 3600, files: ['src/delivery.ts', '.atm/history/evidence/TASK-CURRENT.runner-sync-receipt.json'], state: 'active' },
})}\n`);
writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-FOREIGN.json'), `${JSON.stringify({ workItemId: 'TASK-FOREIGN', status: 'done' })}\n`);
const foreignManifest = path.join(cwd, '.atm', 'history', 'evidence', 'TASK-FOREIGN.bundle-manifest.json');
writeFileSync(foreignManifest, '{"schemaId":"fixture"}\n');
execFileSync('git', ['add', '.'], { cwd });
execFileSync('git', ['commit', '-qm', 'fixture'], { cwd });

// Recreate a foreign generated residue exactly as a completed task can leave
// it in the shared worktree. The current task's deferred commit must not erase
// it, even if the residue is individually safe for its owning lifecycle.
writeFileSync(foreignManifest, '{"schemaId":"fixture","residue":true}\n');
const bundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: 'TASK-CURRENT',
  actorId: 'test-actor',
  taskDocument: JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-CURRENT.json'), 'utf8')),
  message: 'fixture',
  trailers: [],
  apply: true,
  autoStage: false,
  deferForeignStaged: true,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
});

assert.equal(existsSync(foreignManifest), true, 'foreign released bundle residue must survive another task commit transaction');
assert.equal(bundle.ok, true, `completed foreign residue must not block a path-bounded commit: ${bundle.blockedCode} ${bundle.blockedSummary}`);
assert.ok(bundle.skippedExternalDirtyFiles.includes('.atm/history/evidence/TASK-FOREIGN.bundle-manifest.json'));

writeFileSync(foreignManifest, '{"schemaId":"fixture"}\n');

// A shared index can legitimately be stale while the task-owned worktree is
// intact (for example after a preserved emergency WIP commit). Auto-stage must
// seal the explicit worktree overlay, not promote the stale deletion into a
// protected-state destructive write or mutate the caller's index.
const currentReceipt = path.join(cwd, '.atm', 'history', 'evidence', 'TASK-CURRENT.runner-sync-receipt.json');
writeFileSync(currentReceipt, '{"schemaId":"fixture","receipt":true}\n');
execFileSync('git', ['add', '--', '.atm/history/evidence/TASK-CURRENT.runner-sync-receipt.json'], { cwd });
execFileSync('git', ['commit', '-qm', 'current receipt'], { cwd });
execFileSync('git', ['rm', '--cached', '--', '.atm/history/evidence/TASK-CURRENT.runner-sync-receipt.json'], { cwd });
writeFileSync(currentReceipt, '{"schemaId":"fixture","receipt":"recovered"}\n');
const staleIndexBundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: 'TASK-CURRENT',
  actorId: 'test-actor',
  taskDocument: JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-CURRENT.json'), 'utf8')),
  message: 'fixture',
  trailers: [],
  apply: true,
  autoStage: true,
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
});
assert.equal(staleIndexBundle.ok, true, `auto-stage must not mistake a task-owned worktree overlay for a protected deletion: ${staleIndexBundle.blockedCode} ${staleIndexBundle.blockedSummary}`);
assert.equal(execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=D'], { cwd, encoding: 'utf8' }).trim(), '.atm/history/evidence/TASK-CURRENT.runner-sync-receipt.json');
console.log('commit-bundle-resolution: foreign released residue preserved');
