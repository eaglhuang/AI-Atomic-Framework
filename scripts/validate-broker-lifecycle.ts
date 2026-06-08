import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectBrokerClaimLifecycle, clearBrokerRuntimeStateForTask, recordBrokerClaimIntent } from '../packages/core/src/broker/lifecycle.ts';

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
