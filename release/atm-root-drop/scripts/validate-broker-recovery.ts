import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  applyOrphanCleanupScan,
  emptyOrphanCleanupState
} from '../packages/core/src/broker/orphan-cleanup.ts';
import {
  createManualOverrideAuditEntry,
  flushBrokerRecoverySnapshot,
  recoverBrokerRuntime,
  recoverRegistryFromSnapshot,
  revalidateRecoveredLease
} from '../packages/core/src/broker/recovery.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument } from '../packages/core/src/broker/types.ts';

const mode = process.argv.includes('--mode') ? (process.argv[process.argv.indexOf('--mode') + 1] ?? 'validate') : 'validate';
const tempRoot = mkdtempSync(path.join(process.cwd(), '.atm-temp', 'broker-recovery-validate-'));

function registryWith(intents: readonly ActiveWriteIntent[]): WriteBrokerRegistryDocument {
  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'local-repo',
    workspaceId: 'main',
    activeIntents: intents
  };
}

try {
  mkdirSync(path.join(tempRoot, '.atm', 'runtime', 'broker-snapshot'), { recursive: true });
  const now = Date.parse('2026-06-12T08:00:00.000Z');
  const expiredIntent: ActiveWriteIntent = {
    intentId: 'intent-expired',
    taskId: 'TASK-EXPIRED',
    teamRunId: null,
    actorId: '008',
    baseCommit: 'base',
    resourceKeys: {
      files: ['packages/core/src/broker/recovery.ts'],
      atomIds: [],
      atomCids: [],
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    leaseEpoch: now - 600_000,
    leaseSeconds: 300,
    leaseMaxSeconds: 1800,
    heartbeatAt: new Date(now - 600_000).toISOString(),
    lane: 'direct-brokered',
    expiresAt: new Date(now - 1_000).toISOString()
  };

  const recovery = recoverRegistryFromSnapshot({
    schemaId: 'atm.brokerRecoverySnapshot.v1',
    specVersion: '0.1.0',
    flushedAt: new Date(now).toISOString(),
    registry: registryWith([expiredIntent]),
    orphanCleanupState: emptyOrphanCleanupState(),
    manualOverrideAudit: []
  }, { now });
  assert.equal(recovery.rejectedIntents.length, 1, 'expired snapshot lease must be rejected');
  assert.equal(recovery.recoveredRegistry.activeIntents.length, 0, 'expired lease must not remain active');

  const activeIntent: ActiveWriteIntent = {
    ...expiredIntent,
    intentId: 'intent-active',
    taskId: 'TASK-ACTIVE',
    expiresAt: new Date(now + 120_000).toISOString(),
    heartbeatAt: new Date(now - 30_000).toISOString()
  };
  const suspectRecovery = recoverRegistryFromSnapshot({
    schemaId: 'atm.brokerRecoverySnapshot.v1',
    specVersion: '0.1.0',
    flushedAt: new Date(now).toISOString(),
    registry: registryWith([activeIntent]),
    orphanCleanupState: emptyOrphanCleanupState(),
    manualOverrideAudit: [
      createManualOverrideAuditEntry({
        actorId: 'captain',
        taskId: 'TASK-ACTIVE',
        overrideKind: 'lease-bypass',
        reason: 'validator recovery proof',
        previousLeaseEpoch: activeIntent.leaseEpoch,
        activeLeaseCollision: false,
        recordedAt: new Date(now).toISOString()
      })
    ]
  }, { now });
  assert.equal(suspectRecovery.suspectIntents.length, 1, 'non-expired snapshot lease must require renewal');
  assert.equal(suspectRecovery.auditTrail.length, 1, 'manual override audit trail must survive recovery');

  const renewed = revalidateRecoveredLease({
    intent: activeIntent,
    renewalEpoch: activeIntent.leaseEpoch + 1,
    actorId: '008',
    now
  });
  assert.equal(renewed.ok, true, 'renewal must accept a newer epoch from the owning actor');

  const orphanPass = applyOrphanCleanupScan(registryWith([activeIntent]), emptyOrphanCleanupState(), { now });
  assert.equal(orphanPass.result.released.length, 0, 'healthy lease must not be released on first orphan scan');

  flushBrokerRecoverySnapshot({
    cwd: tempRoot,
    registry: registryWith([activeIntent]),
    manualOverrideAudit: suspectRecovery.auditTrail
  });
  const runtimeRecovery = recoverBrokerRuntime({ cwd: tempRoot, now });
  assert.equal(runtimeRecovery.suspectIntents.length, 1, 'runtime recovery must surface suspect leases');
  const snapshotText = readFileSync(path.join(tempRoot, '.atm', 'runtime', 'broker-snapshot', 'latest.json'), 'utf8');
  assert(snapshotText.includes('manualOverrideAudit'), 'snapshot must persist manual override audit trail');

  console.log(`[broker-recovery:${mode}] ok`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
