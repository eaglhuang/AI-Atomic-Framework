import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isTombstone } from '../../../../../core/src/commit-attribution/sealed-commit-bundle.ts';
import { resolveTaskScopedCommitBundle } from './commit-bundle-resolution.ts';
import { inspectTaskScopedStagedGovernanceBundle } from './task-scope-staging.ts';

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

// A task-shaped diagnostic without a semantic task identity cannot pass the
// protected-evidence hook. Preserve it, but keep it out of an auto-staged
// task bundle rather than teaching callers to forge task context into it.
const contextlessEvidence = path.join(cwd, '.atm', 'history', 'evidence', 'TASK-CURRENT.runner-publication-takeover.json');
writeFileSync(contextlessEvidence, '{"schemaId":"atm.runnerPublicationTakeoverPlan.v1","sealedSourceSha":"fixture"}\n');
const contextlessEvidenceBundle = resolveTaskScopedCommitBundle({
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
assert.equal(contextlessEvidenceBundle.ok, true);
assert.ok(!contextlessEvidenceBundle.stageFiles.includes('.atm/history/evidence/TASK-CURRENT.runner-publication-takeover.json'));
assert.ok(!contextlessEvidenceBundle.commitFiles.includes('.atm/history/evidence/TASK-CURRENT.runner-publication-takeover.json'));
assert.equal(existsSync(contextlessEvidence), true, 'contextless diagnostic bytes must remain available for inspection');

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

// Declared task scope is a planning envelope, not current byte ownership. A
// narrowed active claim must keep another lane's dirty source out of this
// task's sealed candidate even when the card still declares that source path.
writeFileSync(path.join(cwd, 'src', 'declared-but-unclaimed.ts'), 'export const owner = "other-lane";\n');
const narrowedTask = JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-CURRENT.json'), 'utf8'));
narrowedTask.scopePaths.push('src/declared-but-unclaimed.ts');
narrowedTask.claim.files = [
  '.atm/history/evidence/TASK-CURRENT.*',
  '.atm/history/task-events/TASK-CURRENT/**',
  '.atm/history/tasks/TASK-CURRENT.json',
];
narrowedTask.workAdmissionTicket = {
  schemaId: 'atm.workAdmissionTicket.v1',
  taskId: 'TASK-CURRENT',
  actorId: 'test-actor',
  claimGeneration: 'lease-current',
  grants: [{ kind: 'file-write', values: narrowedTask.claim.files }],
};
const narrowedBundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: 'TASK-CURRENT',
  actorId: 'test-actor',
  taskDocument: narrowedTask,
  message: 'fixture',
  trailers: [],
  apply: true,
  autoStage: true,
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
});
assert.ok(!narrowedBundle.stageFiles.includes('src/declared-but-unclaimed.ts'));
assert.ok(!narrowedBundle.commitFiles.includes('src/declared-but-unclaimed.ts'));
assert.ok(narrowedBundle.skippedExternalDirtyFiles.includes('src/declared-but-unclaimed.ts'));

// Auto-stage must express a task-owned worktree deletion in the same sealed
// candidate that the commit transaction consumes.  Otherwise a staged path can
// disappear between candidate reporting and the actual commit tree.
const deletePath = path.join(cwd, 'src', 'delete-me.ts');
writeFileSync(deletePath, 'export const removeMe = true;\n');
execFileSync('git', ['add', '--', 'src/delete-me.ts'], { cwd });
execFileSync('git', ['commit', '-qm', 'add deletion fixture'], { cwd });
rmSync(deletePath);
const deletionTask = JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-CURRENT.json'), 'utf8'));
deletionTask.scopePaths.push('src/delete-me.ts');
deletionTask.claim.files.push('src/delete-me.ts');
const deletionBundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: 'TASK-CURRENT',
  actorId: 'test-actor',
  taskDocument: deletionTask,
  message: 'fixture',
  trailers: [],
  apply: true,
  autoStage: true,
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
});
assert.ok(deletionBundle.stageFiles.includes('src/delete-me.ts'));
assert.ok(isTombstone(deletionBundle.sealedBundle.entries.find((entry: { path: string }) => entry.path === 'src/delete-me.ts')!), 'auto-staged deletion must be sealed as a tombstone');

// A history-only cleanup task may preserve a released task's explicitly named
// evidence record, but must never receive a directory-shaped cross-task grant.
// This is the recovery path for receipts stranded after their original owner
// has already released its claim.
const releasedTaskId = 'TASK-RELEASED';
const historyCleanupTaskId = 'TASK-HISTORY-CLEANUP';
const releasedEvidencePath = `.atm/history/evidence/${releasedTaskId}.live-index-reconciliation.json`;
writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${releasedTaskId}.json`), `${JSON.stringify({
  workItemId: releasedTaskId,
  status: 'done',
  claim: { state: 'released', actorId: 'prior-agent' },
})}\n`);
writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${historyCleanupTaskId}.json`), `${JSON.stringify({
  workItemId: historyCleanupTaskId,
  status: 'running',
  claim: { state: 'active', actorId: 'test-actor', leaseId: 'lease-history-cleanup', files: [releasedEvidencePath] },
})}\n`);
writeFileSync(path.join(cwd, releasedEvidencePath), `${JSON.stringify({ taskId: releasedTaskId, schemaId: 'atm.liveIndexReconciliation.v1', clean: false })}\n`);
execFileSync('git', ['add', '--', `.atm/history/tasks/${releasedTaskId}.json`, `.atm/history/tasks/${historyCleanupTaskId}.json`, releasedEvidencePath], { cwd });
execFileSync('git', ['commit', '-qm', 'released history fixture'], { cwd });
writeFileSync(path.join(cwd, releasedEvidencePath), `${JSON.stringify({ taskId: releasedTaskId, schemaId: 'atm.liveIndexReconciliation.v1', clean: true })}\n`);
const historyCleanupTask = JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${historyCleanupTaskId}.json`), 'utf8'));
historyCleanupTask.scopePaths = [releasedEvidencePath];
historyCleanupTask.targetAllowedFiles = [releasedEvidencePath];
historyCleanupTask.workAdmissionTicket = {
  schemaId: 'atm.workAdmissionTicket.v1',
  taskId: historyCleanupTaskId,
  actorId: 'test-actor',
  claimGeneration: 'lease-history-cleanup',
  grants: [{ kind: 'file-write', values: [releasedEvidencePath] }],
};
const historyCleanupBundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: historyCleanupTaskId,
  actorId: 'test-actor',
  taskDocument: historyCleanupTask,
  message: 'fixture',
  trailers: [],
  apply: true,
  autoStage: true,
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
});
assert.ok(historyCleanupBundle.stageFiles.includes(releasedEvidencePath), 'an explicitly named receipt owned by a released task must be stageable by a history-only cleanup task');
execFileSync('git', ['add', '--', releasedEvidencePath], { cwd });
assert.equal(
  inspectTaskScopedStagedGovernanceBundle(cwd, historyCleanupTaskId, historyCleanupTask).ok,
  true,
  'the pre-commit ownership check must accept the same explicitly entitled terminal receipt',
);
execFileSync('git', ['restore', '--staged', '--', releasedEvidencePath], { cwd });

// A real claimed task's effective scope includes its own evidence/event
// patterns.  Those intrinsic wildcard entries must not make an otherwise
// history-only cleanup ineligible to preserve one exactly named released
// receipt; no foreign wildcard is allowed.
const ignoredReleasedTaskId = 'TASK-IGNORED-RELEASED';
const ignoredReleasedEvidencePath = `.atm/history/evidence/${ignoredReleasedTaskId}.live-index-reconciliation.json`;
writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${ignoredReleasedTaskId}.json`), `${JSON.stringify({
  workItemId: ignoredReleasedTaskId,
  status: 'done',
  claim: { state: 'released', actorId: 'prior-agent' },
})}\n`);
execFileSync('git', ['add', '--', `.atm/history/tasks/${ignoredReleasedTaskId}.json`], { cwd });
execFileSync('git', ['commit', '-qm', 'ignored released history owner fixture'], { cwd });
writeFileSync(path.join(cwd, ignoredReleasedEvidencePath), `${JSON.stringify({ taskId: ignoredReleasedTaskId, schemaId: 'atm.liveIndexReconciliation.v1', clean: true })}\n`);
const ignoredHistoryCleanupTask = structuredClone(historyCleanupTask);
ignoredHistoryCleanupTask.scopePaths = [
  ignoredReleasedEvidencePath,
  `.atm/history/evidence/${historyCleanupTaskId}.*`,
  `.atm/history/task-events/${historyCleanupTaskId}/**`,
  `.atm/history/tasks/${historyCleanupTaskId}.json`,
];
ignoredHistoryCleanupTask.targetAllowedFiles = ignoredHistoryCleanupTask.scopePaths;
ignoredHistoryCleanupTask.claim.files = ignoredHistoryCleanupTask.scopePaths;
ignoredHistoryCleanupTask.workAdmissionTicket.grants[0].values = ignoredHistoryCleanupTask.scopePaths;
const ignoredHistoryCleanupBundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: historyCleanupTaskId,
  actorId: 'test-actor',
  taskDocument: ignoredHistoryCleanupTask,
  message: 'fixture',
  trailers: [],
  apply: true,
  autoStage: true,
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
});
assert.ok(ignoredHistoryCleanupBundle.stageFiles.includes(ignoredReleasedEvidencePath), 'an explicitly named Git-ignored terminal receipt must enter the sealed candidate');

writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${releasedTaskId}.json`), `${JSON.stringify({
  workItemId: releasedTaskId,
  status: 'running',
  claim: { state: 'active', actorId: 'prior-agent' },
})}\n`);
const activeOwnerBundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: historyCleanupTaskId,
  actorId: 'test-actor',
  taskDocument: historyCleanupTask,
  message: 'fixture',
  trailers: [],
  apply: true,
  autoStage: true,
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
});
assert.ok(!activeOwnerBundle.stageFiles.includes(releasedEvidencePath), 'a live owner must retain exclusive authority over its evidence');

writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${releasedTaskId}.json`), `${JSON.stringify({
  workItemId: releasedTaskId,
  status: 'done',
  claim: { state: 'released', actorId: 'prior-agent' },
})}\n`);
const wildcardCleanupTask = structuredClone(historyCleanupTask);
wildcardCleanupTask.scopePaths = [`.atm/history/evidence/${releasedTaskId}.*`];
wildcardCleanupTask.targetAllowedFiles = [`.atm/history/evidence/${releasedTaskId}.*`];
wildcardCleanupTask.claim.files = [`.atm/history/evidence/${releasedTaskId}.*`];
wildcardCleanupTask.workAdmissionTicket.grants[0].values = [`.atm/history/evidence/${releasedTaskId}.*`];
const wildcardBundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: historyCleanupTaskId,
  actorId: 'test-actor',
  taskDocument: wildcardCleanupTask,
  message: 'fixture',
  trailers: [],
  apply: true,
  autoStage: true,
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
});
assert.ok(!wildcardBundle.stageFiles.includes(releasedEvidencePath), 'a wildcard must not transfer a released task evidence ownership');

const foreignClosurePath = `.atm/history/evidence/${releasedTaskId}.closure-packet.json`;
writeFileSync(path.join(cwd, foreignClosurePath), `${JSON.stringify({ taskId: releasedTaskId, schemaId: 'atm.closurePacket.v1' })}\n`);
const closureCleanupTask = structuredClone(historyCleanupTask);
closureCleanupTask.scopePaths = [foreignClosurePath];
closureCleanupTask.targetAllowedFiles = [foreignClosurePath];
closureCleanupTask.claim.files = [foreignClosurePath];
closureCleanupTask.workAdmissionTicket.grants[0].values = [foreignClosurePath];
const closureBundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: historyCleanupTaskId,
  actorId: 'test-actor',
  taskDocument: closureCleanupTask,
  message: 'fixture',
  trailers: [],
  apply: true,
  autoStage: true,
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
});
assert.ok(!closureBundle.stageFiles.includes(foreignClosurePath), 'a closure packet must never be admitted through historical cleanup');
console.log('commit-bundle-resolution: foreign released residue preserved');
