import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  applyOrphanCleanupScan,
  classifyLeasePhase,
  emptyOrphanCleanupState
} from '../orphan-cleanup.ts';
import {
  appendManualOverrideAudit,
  createManualOverrideAuditEntry,
  flushBrokerRecoverySnapshot,
  loadLatestBrokerRecoverySnapshot,
  recoverBrokerRuntime,
  recoverRegistryFromSnapshot,
  revalidateRecoveredLease
} from '../recovery.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument } from '../types.ts';

function registryWith(intents: readonly ActiveWriteIntent[]): WriteBrokerRegistryDocument {
  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'test-repo',
    workspaceId: 'test-workspace',
    activeIntents: intents
  };
}

function makeIntent(overrides: Partial<ActiveWriteIntent> = {}): ActiveWriteIntent {
  const now = Date.now();
  return {
    intentId: 'intent-1',
    taskId: 'TASK-A',
    teamRunId: null,
    actorId: 'agent-a',
    baseCommit: 'abc123',
    resourceKeys: {
      files: ['src/a.ts'],
      atomIds: ['atom-a'],
      atomCids: ['cid-a'],
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    leaseEpoch: now - 60_000,
    leaseSeconds: 300,
    leaseMaxSeconds: 1800,
    heartbeatAt: new Date(now - 60_000).toISOString(),
    lane: 'direct-brokered',
    expiresAt: new Date(now + 240_000).toISOString(),
    ...overrides
  };
}

function testExpiredLeaseRejectedOnRecovery() {
  const now = Date.parse('2026-06-12T08:00:00.000Z');
  const expired = makeIntent({
    expiresAt: new Date(now - 1_000).toISOString(),
    heartbeatAt: new Date(now - 120_000).toISOString()
  });
  const result = recoverRegistryFromSnapshot({
    schemaId: 'atm.brokerRecoverySnapshot.v1',
    specVersion: '0.1.0',
    flushedAt: new Date(now).toISOString(),
    registry: registryWith([expired]),
    orphanCleanupState: emptyOrphanCleanupState(),
    manualOverrideAudit: []
  }, { now });

  assert.equal(result.rejectedIntents.length, 1);
  assert.equal(result.rejectedIntents[0]?.recoveryStatus, 'rejected-stale');
  assert.equal(result.recoveredRegistry.activeIntents.length, 0);
}

function testNonExpiredLeaseRequiresRenewal() {
  const now = Date.parse('2026-06-12T08:00:00.000Z');
  const active = makeIntent({
    expiresAt: new Date(now + 120_000).toISOString(),
    heartbeatAt: new Date(now - 30_000).toISOString()
  });
  const result = recoverRegistryFromSnapshot({
    schemaId: 'atm.brokerRecoverySnapshot.v1',
    specVersion: '0.1.0',
    flushedAt: new Date(now).toISOString(),
    registry: registryWith([active]),
    orphanCleanupState: emptyOrphanCleanupState(),
    manualOverrideAudit: []
  }, { now });

  assert.equal(result.suspectIntents.length, 1);
  assert.equal(result.suspectIntents[0]?.recoveryStatus, 'requires-renewal');
  assert.equal(result.recoveredRegistry.activeIntents.length, 1);
}

function testRevalidationRequiresNewEpoch() {
  const intent = makeIntent({ leaseEpoch: 100 });
  const rejected = revalidateRecoveredLease({
    intent,
    renewalEpoch: 100,
    actorId: 'agent-a'
  });
  assert.equal(rejected.ok, false);

  const accepted = revalidateRecoveredLease({
    intent,
    renewalEpoch: 200,
    actorId: 'agent-a',
    now: Date.now()
  });
  assert.equal(accepted.ok, true);
  assert.ok((accepted.intent?.leaseEpoch ?? 0) > intent.leaseEpoch);
}

function testOrphanCleanupTwoPhaseRelease() {
  const now = Date.parse('2026-06-12T08:00:00.000Z');
  const staleIntent = makeIntent({
    intentId: 'intent-stale',
    heartbeatAt: new Date(now - 1_200_000).toISOString(),
    expiresAt: new Date(now - 1_000).toISOString()
  });
  const firstPass = applyOrphanCleanupScan(registryWith([staleIntent]), emptyOrphanCleanupState(), { now });
  assert.equal(firstPass.result.released.length, 1);
  assert.equal(firstPass.result.registry.activeIntents.length, 0);
}

function testSuspectPromotionBeforeRelease() {
  const now = Date.parse('2026-06-12T08:00:00.000Z');
  const suspectIntent = makeIntent({
    intentId: 'intent-suspect',
    leaseSeconds: 60,
    heartbeatAt: new Date(now - 90_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString()
  });
  assert.equal(classifyLeasePhase(suspectIntent, now), 'suspect');

  const firstPass = applyOrphanCleanupScan(registryWith([suspectIntent]), emptyOrphanCleanupState(), { now });
  assert.equal(firstPass.result.newlySuspect.length, 1);
  assert.equal(firstPass.result.released.length, 0);
  assert.equal(firstPass.result.registry.activeIntents.length, 1);

  const secondPass = applyOrphanCleanupScan(firstPass.result.registry, firstPass.state, {
    now: now + 120_000
  });
  assert.equal(secondPass.result.released.length, 1);
  assert.equal(secondPass.result.registry.activeIntents.length, 0);
}

function testManualOverrideAuditTrail() {
  const entry = createManualOverrideAuditEntry({
    actorId: 'captain',
    taskId: 'TASK-OVERRIDE',
    overrideKind: 'force-claim',
    reason: 'manual override collided with active lease',
    previousLeaseEpoch: 42,
    activeLeaseCollision: true
  });
  assert.equal(entry.severity, 'critical');
  assert.equal(entry.activeLeaseCollision, true);

  const trail = appendManualOverrideAudit([], entry);
  assert.equal(trail.length, 1);
  assert.equal(trail[0]?.overrideKind, 'force-claim');
}

function testSnapshotFlushAndRecover() {
  const tempRoot = mkdtempSync(path.join(process.cwd(), '.atm-temp', 'broker-recovery-'));
  try {
    const intent = makeIntent({ taskId: 'TASK-SNAPSHOT' });
    flushBrokerRecoverySnapshot({
      cwd: tempRoot,
      registry: registryWith([intent])
    });
    const loaded = loadLatestBrokerRecoverySnapshot(tempRoot);
    assert.ok(loaded);
    assert.equal(loaded?.registry.activeIntents[0]?.taskId, 'TASK-SNAPSHOT');

    const recovered = recoverBrokerRuntime({ cwd: tempRoot, now: Date.now() });
    assert.equal(recovered.suspectIntents.length, 1);
    const latestText = readFileSync(path.join(tempRoot, '.atm', 'runtime', 'broker-snapshot', 'latest.json'), 'utf8');
    assert(latestText.includes('TASK-SNAPSHOT'));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

testExpiredLeaseRejectedOnRecovery();
testNonExpiredLeaseRequiresRenewal();
testRevalidationRequiresNewEpoch();
testOrphanCleanupTwoPhaseRelease();
testSuspectPromotionBeforeRelease();
testManualOverrideAuditTrail();
testSnapshotFlushAndRecover();

console.log('broker recovery tests: ok');
