import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateBrokerDecision } from '../decision.ts';
import {
  buildBlockingRegistryFindingEvidence,
  cleanupStaleWithEvidence,
  describeBlockingRegistryIntent,
  loadRegistry,
  resolveConflictBlockingIntent,
  saveRegistry,
  type WriteBrokerRegistryDocument
} from '../registry.ts';
import type { ActiveWriteIntent, WriteIntent } from '../types.ts';

function emptyRegistry(): WriteBrokerRegistryDocument {
  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'test-repo',
    workspaceId: 'test-workspace',
    activeIntents: []
  };
}

function makeActiveIntent(overrides: Partial<ActiveWriteIntent> = {}): ActiveWriteIntent {
  const now = Date.now();
  return {
    intentId: 'intent-live',
    taskId: 'TASK-LIVE',
    teamRunId: null,
    actorId: 'agent-live',
    baseCommit: 'abc123',
    resourceKeys: {
      files: ['src/live.ts'],
      atomIds: ['atom-live'],
      atomCids: ['cid-live'],
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    leaseEpoch: now - 60_000,
    leaseSeconds: 1800,
    leaseMaxSeconds: 1800,
    heartbeatAt: new Date(now - 60_000).toISOString(),
    lane: 'direct-brokered',
    expiresAt: new Date(now + 1_200_000).toISOString(),
    ...overrides
  };
}

function testCleanupStaleWithEvidenceRemovesExpiredLease() {
  const now = Date.parse('2026-07-11T08:00:00.000Z');
  const live = makeActiveIntent({
    expiresAt: new Date(now + 120_000).toISOString(),
    heartbeatAt: new Date(now - 30_000).toISOString()
  });
  const stale = makeActiveIntent({
    intentId: 'intent-stale',
    taskId: 'TASK-STALE',
    actorId: 'agent-stale',
    expiresAt: new Date(now - 1_000).toISOString(),
    heartbeatAt: new Date(now - 86_400_000).toISOString()
  });
  const result = cleanupStaleWithEvidence({
    ...emptyRegistry(),
    activeIntents: [live, stale]
  }, {
    now,
    registryPath: '.atm/runtime/broker-parallel-0041-0042/write-broker.registry.json'
  });

  assert.equal(result.removedCount, 1);
  assert.equal(result.registry.activeIntents.length, 1);
  assert.equal(result.removed[0]?.taskId, 'TASK-STALE');
  assert.equal(result.removed[0]?.owner, 'agent-stale');
  assert.equal(result.removed[0]?.classification, 'expired-lease');
  assert.equal(result.removed[0]?.registryPath, '.atm/runtime/broker-parallel-0041-0042/write-broker.registry.json');
  assert.match(result.guidance, /agent-stale/);
  assert.match(result.guidance, /node atm\.mjs broker cleanup --json/);
  console.log('ok: cleanupStaleWithEvidence removes expired lease with owner/age guidance');
}

function testDescribeBlockingRegistryIntentFlagsTerminalResidue() {
  const now = Date.parse('2026-07-11T08:00:00.000Z');
  const stale = makeActiveIntent({
    taskId: 'TASK-TEAM-0041',
    actorId: 'captain',
    expiresAt: new Date(now - 1_000).toISOString(),
    heartbeatAt: new Date(now - 86_400_000).toISOString()
  });
  const described = describeBlockingRegistryIntent(stale, {
    registryPath: '.atm/runtime/broker-parallel-0041-0042/write-broker.registry.json',
    now
  });

  assert.equal(described.owner, 'captain');
  assert.equal(described.ageLabel, '1d 0h');
  assert.equal(described.terminalResidue, true);
  assert.equal(described.isStale, true);
  console.log('ok: describeBlockingRegistryIntent reports path owner and age');
}

function testBuildBlockingRegistryFindingEvidenceIncludesCleanupCommand() {
  const now = Date.parse('2026-07-11T08:00:00.000Z');
  const stale = makeActiveIntent({
    taskId: 'TASK-TEAM-0041',
    actorId: 'captain',
    expiresAt: new Date(now - 1_000).toISOString(),
    heartbeatAt: new Date(now - 86_400_000).toISOString()
  });
  const finding = buildBlockingRegistryFindingEvidence({
    registryPath: '.atm/runtime/broker-parallel-0041-0042/write-broker.registry.json',
    blockingIntent: stale,
    baseReason: 'Proposal-first lane is active; broker recorded a provisional write lease.',
    now
  });

  assert.match(finding.detail, /registry=\.atm\/runtime\/broker-parallel-0041-0042\/write-broker\.registry\.json/);
  assert.match(finding.detail, /owner=captain/);
  assert.match(finding.detail, /task=TASK-TEAM-0041/);
  assert.equal(finding.cleanupCommand, 'node atm.mjs broker cleanup --json');
  assert.match(finding.guidance, /terminal stale residue/);
  console.log('ok: buildBlockingRegistryFindingEvidence emits cleanup command');
}

function testResolveConflictBlockingIntentFromDecision() {
  const now = Date.parse('2026-07-11T08:00:00.000Z');
  const blocking = makeActiveIntent({
    taskId: 'TASK-TEAM-0041',
    actorId: 'captain',
    resourceKeys: {
      files: ['packages/cli/src/commands/broker.ts'],
      atomIds: ['atm.proposal-first-team-gate'],
      atomCids: ['atm-proposal-first-team-gate'],
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    }
  });
  const registry: WriteBrokerRegistryDocument = {
    ...emptyRegistry(),
    activeIntents: [blocking]
  };
  const incoming: WriteIntent = {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'test' },
    taskId: 'TASK-TEAM-0040',
    actorId: 'captain',
    baseCommit: 'abc123',
    targetFiles: ['packages/cli/src/commands/broker.ts'],
    atomRefs: [{
      atomId: 'atm.proposal-first-team-gate',
      atomCid: 'atm-proposal-first-team-gate',
      operation: 'modify'
    }],
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    requestedLane: 'auto'
  };
  const decision = calculateBrokerDecision(incoming, registry);
  const resolved = resolveConflictBlockingIntent(decision, registry);

  assert.ok(resolved);
  assert.equal(resolved?.taskId, 'TASK-TEAM-0041');
  console.log('ok: resolveConflictBlockingIntent maps decision conflict to registry entry');
}

function testLoadRegistryPersistCleanupOption() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-registry-stale-'));
  const registryPath = path.join(tempDir, 'write-broker.registry.json');
  const now = Date.parse('2026-07-11T08:00:00.000Z');
  const stale = makeActiveIntent({
    expiresAt: new Date(now - 1_000).toISOString(),
    heartbeatAt: new Date(now - 86_400_000).toISOString()
  });
  saveRegistry(registryPath, {
    ...emptyRegistry(),
    activeIntents: [stale]
  });

  const loadedWithoutPersist = loadRegistry(registryPath, { persistCleanup: false });
  assert.equal(loadedWithoutPersist.activeIntents.length, 0, 'load should still return cleaned registry in memory');

  const rawAfterNoPersist = JSON.parse(readFileSync(registryPath, 'utf8')) as WriteBrokerRegistryDocument;
  assert.equal(rawAfterNoPersist.activeIntents.length, 1, 'persistCleanup=false should leave stale entry on disk');

  const withPersist = loadRegistry(registryPath, { persistCleanup: true });
  assert.equal(withPersist.activeIntents.length, 0, 'persistCleanup=true should persist cleanup');

  const rawAfterPersist = JSON.parse(readFileSync(registryPath, 'utf8')) as WriteBrokerRegistryDocument;
  assert.equal(rawAfterPersist.activeIntents.length, 0, 'disk state should be cleaned after persist');

  rmSync(tempDir, { recursive: true, force: true });
  console.log('ok: loadRegistry persistCleanup option preserves opt-out behavior');
}

testCleanupStaleWithEvidenceRemovesExpiredLease();
testDescribeBlockingRegistryIntentFlagsTerminalResidue();
testBuildBlockingRegistryFindingEvidenceIncludesCleanupCommand();
testResolveConflictBlockingIntentFromDecision();
testLoadRegistryPersistCleanupOption();
console.log('broker registry stale-cleanup tests: ok');
