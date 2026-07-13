import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectBrokerClaimLifecycle, clearBrokerRuntimeStateForTask, cleanupBrokerRuntimeSnapshots, recordBrokerClaimIntent } from '../packages/core/src/broker/lifecycle.ts';

const mode = process.argv.includes('--mode') ? (process.argv[process.argv.indexOf('--mode') + 1] ?? 'validate') : 'validate';
const tempRoot = mkdtempSync(path.join(process.cwd(), '.atm-temp', 'broker-lifecycle-'));

try {
  mkdirSync(path.join(tempRoot, '.atm', 'runtime'), { recursive: true });

  const blockedRegistryPath = path.join(tempRoot, '.atm', 'runtime', 'write-broker.registry.json');
  writeFileSync(blockedRegistryPath, `${JSON.stringify({
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'local-repo',
    workspaceId: 'main',
    activeIntents: [
      {
        intentId: 'intent-1',
        taskId: 'TASK-CID-0022',
        teamRunId: null,
        actorId: 'other-actor',
        baseCommit: 'base-commit',
        resourceKeys: {
          files: ['packages/cli/src/commands/next.ts'],
          atomIds: [],
          atomCids: [],
          generators: [],
          projections: [],
          registries: [],
          validators: [],
          artifacts: []
        },
        leaseEpoch: Date.now(),
        lane: 'blocked',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }
    ]
  }, null, 2)}\n`, 'utf8');

  const blocked = inspectBrokerClaimLifecycle({
    cwd: tempRoot,
    taskId: 'TASK-CID-0022',
    actorId: '001'
  });
  assert.equal(blocked.ok, false, 'blocked registry intent must fail claim preflight');
  assert.equal(blocked.blocked, true, 'blocked registry intent must be flagged blocked');
  assert.equal(blocked.blockingIntent?.actorId, 'other-actor', 'blocking intent should preserve the owning actor');

  const clearedState = clearBrokerRuntimeStateForTask({
    cwd: tempRoot,
    taskId: 'TASK-CID-0022'
  });
  assert.equal(clearedState.activeIntents.length, 0, 'clearBrokerRuntimeStateForTask must remove the task intent');
  const clearedText = readFileSync(blockedRegistryPath, 'utf8');
  assert(!clearedText.includes('TASK-CID-0022'), 'cleared registry must not retain the task intent');

  const intentDir = path.join(tempRoot, '.atm', 'runtime', 'broker-intents');
  mkdirSync(intentDir, { recursive: true });
  writeFileSync(path.join(intentDir, 'TASK-CID-LIVE.json'), `${JSON.stringify({ taskId: 'TASK-CID-LIVE' }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(intentDir, 'TASK-CID-STALE.json'), `${JSON.stringify({ taskId: 'TASK-CID-STALE' }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(tempRoot, '.atm', 'runtime', 'broker-shared-surface-queues.json'), `${JSON.stringify({
    schemaId: 'atm.brokerSharedSurfaceQueues.v1',
    queues: [
      {
        surfacePath: 'docs/governance/atm-bug-and-optimization-backlog.md',
        entries: [
          { taskId: 'TASK-CID-LIVE', actorId: '001', surfacePath: 'docs/governance/atm-bug-and-optimization-backlog.md', leaseEpoch: 1, baseHash: 'sha256:live', reason: 'live', releaseCondition: 'release', queuedAt: new Date().toISOString() },
          { taskId: 'TASK-CID-STALE', actorId: '002', surfacePath: 'docs/governance/atm-bug-and-optimization-backlog.md', leaseEpoch: 2, baseHash: 'sha256:stale', reason: 'stale', releaseCondition: 'release', queuedAt: new Date().toISOString() }
        ]
      }
    ]
  }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(tempRoot, '.atm', 'runtime', 'broker-shared-surface-freezes.json'), `${JSON.stringify({
    schemaId: 'atm.brokerSharedSurfaceFreezes.v1',
    records: [
      { status: 'pending', signal: { taskId: 'TASK-CID-LIVE' } },
      { status: 'released', signal: { taskId: 'TASK-CID-STALE' } }
    ]
  }, null, 2)}\n`, 'utf8');

  const snapshotCleanup = cleanupBrokerRuntimeSnapshots({
    cwd: tempRoot,
    activeTaskIds: ['TASK-CID-LIVE']
  });
  assert.deepEqual(snapshotCleanup.removedIntentSnapshots, ['broker-intents/TASK-CID-STALE.json'], 'cleanup must remove stale per-task intent snapshots only');
  assert.equal(existsSync(path.join(intentDir, 'TASK-CID-LIVE.json')), true, 'cleanup must preserve live per-task intent snapshots');
  assert.equal(existsSync(path.join(intentDir, 'TASK-CID-STALE.json')), false, 'cleanup must remove stale per-task intent snapshots');
  assert.equal(snapshotCleanup.prunedSharedQueueEntries, 1, 'cleanup must prune stale shared queue entries');
  assert.equal(snapshotCleanup.prunedSharedFreezeRecords, 1, 'cleanup must prune released shared freeze records');

  const recorded = recordBrokerClaimIntent({
    cwd: tempRoot,
    taskId: 'TASK-CID-0099',
    actorId: '001',
    lane: 'direct-brokered',
    targetFiles: ['packages/cli/src/commands/next.ts']
  });
  assert(recorded.activeIntents.some((entry) => entry.taskId === 'TASK-CID-0099'), 'recordBrokerClaimIntent must persist an active intent');
  const preflight = inspectBrokerClaimLifecycle({
    cwd: tempRoot,
    taskId: 'TASK-CID-0099',
    actorId: '001'
  });
  assert.equal(preflight.ok, true, 'same-actor claim preflight should pass');
  assert.equal(preflight.blocked, false, 'same-actor claim preflight should not block');

  console.log(`[broker-lifecycle:${mode}] ok`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
