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
writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-FOREIGN.json'), `${JSON.stringify({ workItemId: 'TASK-FOREIGN', status: 'planned' })}\n`);
const foreignManifest = path.join(cwd, '.atm', 'history', 'evidence', 'TASK-FOREIGN.bundle-manifest.json');
writeFileSync(foreignManifest, '{"schemaId":"fixture"}\n');
execFileSync('git', ['add', '.'], { cwd });
execFileSync('git', ['commit', '-qm', 'fixture'], { cwd });

// An unclaimed foreign generated manifest may remain in a shared worktree.
// Preserve it without turning a path-bounded commit into a global refusal.
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
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
});

assert.equal(existsSync(foreignManifest), true, 'foreign generated bundle residue must survive another task commit transaction');
assert.equal(bundle.ok, true, `un-staged foreign residue must not block a path-bounded commit: ${bundle.blockedCode} ${bundle.blockedSummary}`);
assert.ok(bundle.skippedExternalDirtyFiles.includes('.atm/history/evidence/TASK-FOREIGN.bundle-manifest.json'));

// A retained foreign deletion must likewise stay out of a different task's
// bounded commit.  The safety gate protects destructive writes that enter the
// commit, not unrelated index residue that the transaction explicitly parks.
execFileSync('git', ['rm', '--cached', '--', '.atm/history/evidence/TASK-FOREIGN.bundle-manifest.json'], { cwd });
writeFileSync(path.join(cwd, 'src', 'delivery.ts'), 'export const delivery = "current";\n');
const foreignDeletionBundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: 'TASK-CURRENT',
  actorId: 'test-actor',
  taskDocument: JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-CURRENT.json'), 'utf8')),
  message: 'fixture',
  trailers: [],
  apply: true,
  autoStage: true,
  deferForeignStaged: true,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
});
assert.equal(foreignDeletionBundle.ok, true, `foreign retained deletion must not block a bounded commit: ${foreignDeletionBundle.blockedCode} ${foreignDeletionBundle.blockedSummary}`);
assert.ok(foreignDeletionBundle.skippedExternalDirtyFiles.includes('.atm/history/evidence/TASK-FOREIGN.bundle-manifest.json'));
execFileSync('git', ['reset', '--', '.atm/history/evidence/TASK-FOREIGN.bundle-manifest.json'], { cwd });
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

// A tracked path may have both staged and unstaged changes. Auto-stage means
// the worktree is authoritative for that task path; subtracting every staged
// path from the overlay would silently commit the older index blob.
execFileSync('git', ['add', '--', 'src/delivery.ts'], { cwd });
writeFileSync(path.join(cwd, 'src', 'delivery.ts'), 'export const delivery = "worktree-overlay";\n');
const stagedDeliveryBlob = execFileSync('git', ['rev-parse', ':src/delivery.ts'], { cwd, encoding: 'utf8' }).trim();
const worktreeDeliveryBlob = execFileSync('git', ['hash-object', '--', 'src/delivery.ts'], { cwd, encoding: 'utf8' }).trim();
assert.notEqual(stagedDeliveryBlob, worktreeDeliveryBlob, 'fixture must be MM with different blobs');
const mmBundle = resolveTaskScopedCommitBundle({
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
const sealedDelivery = mmBundle.sealedBundle.entries.find((entry: { path: string }) => entry.path === 'src/delivery.ts');
assert.ok(mmBundle.stageFiles.includes('src/delivery.ts'), 'MM path must remain in auto-stage worktree overlay');
assert.equal(sealedDelivery?.blobId, worktreeDeliveryBlob, 'sealed candidate must use worktree bytes for MM path');
assert.notEqual(sealedDelivery?.blobId, stagedDeliveryBlob, 'older staged blob must not override worktree bytes');
console.log('commit-bundle-resolution: foreign released residue preserved');
