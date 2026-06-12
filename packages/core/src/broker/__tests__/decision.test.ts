import assert from 'node:assert/strict';
import { calculateBrokerDecision } from '../decision.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from '../types.ts';

function registryWith(intents: readonly ActiveWriteIntent[]): WriteBrokerRegistryDocument {
  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'test-repo',
    workspaceId: 'test-workspace',
    activeIntents: intents
  };
}

function toActiveIntent(intent: WriteIntent, intentId: string): ActiveWriteIntent {
  return {
    intentId,
    taskId: intent.taskId,
    teamRunId: null,
    actorId: intent.actorId,
    baseCommit: intent.baseCommit,
    resourceKeys: {
      files: intent.targetFiles,
      atomIds: intent.atomRefs.map((ref) => ref.atomId),
      atomCids: intent.atomRefs.map((ref) => ref.atomCid),
      atomRanges: intent.atomRefs
        .map((ref) => ref.sourceRange && {
          filePath: ref.sourceRange.filePath,
          lineStart: ref.sourceRange.lineStart,
          lineEnd: ref.sourceRange.lineEnd,
          atomCid: ref.atomCid
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
      generators: intent.sharedSurfaces.generators,
      projections: intent.sharedSurfaces.projections,
      registries: intent.sharedSurfaces.registries,
      validators: intent.sharedSurfaces.validators,
      artifacts: intent.sharedSurfaces.artifacts
    },
    leaseEpoch: 1,
    leaseSeconds: 1800,
    leaseMaxSeconds: 1800,
    heartbeatAt: '2026-01-01T00:00:00.000Z',
    lane: 'direct-brokered'
  };
}

function makeIntent(overrides: Partial<WriteIntent> = {}): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'test' },
    taskId: 'TASK-A',
    actorId: 'agent-a',
    baseCommit: 'abc123',
    targetFiles: ['src/file-a.ts'],
    atomRefs: [
      { atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify' }
    ],
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    requestedLane: 'auto',
    ...overrides
  };
}

function testParallelSafeScenario() {
  const intentA = makeIntent();
  const intentB = makeIntent({
    taskId: 'TASK-B',
    actorId: 'agent-b',
    targetFiles: ['src/file-b.ts'],
    atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify' }]
  });

  const decision = calculateBrokerDecision(intentB, registryWith([toActiveIntent(intentA, 'intent-a')]));
  assert.equal(decision.verdict, 'parallel-safe');
  assert.equal(decision.lane, 'direct-brokered');
  assert.equal(decision.conflicts.length, 0);
  console.log('ok: parallel-safe scenario (disjoint files, CIDs, and read-set)');
}

function testReadSetConflictScenario() {
  const active = makeIntent();
  const readSetIntent = makeIntent({
    taskId: 'TASK-B',
    actorId: 'agent-b',
    targetFiles: ['src/file-b.ts'],
    atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify' }],
    readAtoms: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'create' }]
  });

  const decision = calculateBrokerDecision(readSetIntent, registryWith([toActiveIntent(active, 'intent-a')]));
  assert.equal(decision.verdict, 'blocked-cid-conflict');
  assert.equal(decision.lane, 'blocked');
  assert.ok(decision.conflicts.some((conflict) => conflict.detail.includes('Read-set conflict')));
  console.log('ok: read-set conflict scenario (read dependency blocks parallel-safe admission)');
}

function testSharedSurfaceWinsOverReadSetScenario() {
  const active = makeIntent({
    sharedSurfaces: {
      generators: ['gen-a'],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    }
  });
  const conflictingIntent = makeIntent({
    taskId: 'TASK-B',
    actorId: 'agent-b',
    targetFiles: ['src/file-b.ts'],
    atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify' }],
    readAtoms: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'create' }],
    sharedSurfaces: {
      generators: ['gen-a'],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    }
  });

  const decision = calculateBrokerDecision(conflictingIntent, registryWith([toActiveIntent(active, 'intent-a')]));
  assert.equal(decision.verdict, 'blocked-shared-surface');
  assert.equal(decision.lane, 'blocked');
  assert.ok(decision.conflicts.some((conflict) => conflict.kind === 'generator'));
  console.log('ok: shared-surface blocker wins over read-set conflict');
}

function testCidConflictScenario() {
  const active = makeIntent();
  const conflictingIntent = makeIntent({
    taskId: 'TASK-B',
    actorId: 'agent-b',
    targetFiles: ['src/file-b.ts'],
    atomRefs: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify' }]
  });

  const decision = calculateBrokerDecision(conflictingIntent, registryWith([toActiveIntent(active, 'intent-a')]));
  assert.equal(decision.verdict, 'blocked-cid-conflict');
  assert.equal(decision.lane, 'blocked');
  assert.ok(decision.conflicts.some((conflict) => conflict.kind === 'cid'));
  console.log('ok: CID conflict scenario (same atom identity is blocked)');
}

function testFileOverlapScenario() {
  const active = makeIntent({
    targetFiles: ['src/shared-module.ts'],
    atomRefs: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify' }]
  });
  const overlappingIntent = makeIntent({
    taskId: 'TASK-B',
    actorId: 'agent-b',
    targetFiles: ['src/shared-module.ts'],
    atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify' }]
  });

  const decision = calculateBrokerDecision(overlappingIntent, registryWith([toActiveIntent(active, 'intent-a')]));
  assert.equal(decision.verdict, 'needs-physical-split');
  assert.equal(decision.lane, 'deterministic-composer');
  assert.ok(decision.conflicts.some((conflict) => conflict.kind === 'file-range' && conflict.detail.includes('src/shared-module.ts')));
  console.log('ok: file overlap scenario (same file, disjoint CIDs -> needs-physical-split)');
}

function testFileOverlapWithSyntacticSeparationScenario() {
  const active = makeIntent({
    targetFiles: ['src/shared-module.ts'],
    atomRefs: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify', sourceRange: { filePath: 'src/shared-module.ts', lineStart: 1, lineEnd: 10 } }]
  });
  const overlappingIntent = makeIntent({
    taskId: 'TASK-B',
    actorId: 'agent-b',
    targetFiles: ['src/shared-module.ts'],
    atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify', sourceRange: { filePath: 'src/shared-module.ts', lineStart: 20, lineEnd: 30 } }]
  });

  const decision = calculateBrokerDecision(overlappingIntent, registryWith([toActiveIntent(active, 'intent-a')]));
  assert.equal(decision.verdict, 'parallel-safe');
  assert.equal(decision.lane, 'direct-brokered');
  assert.equal(decision.conflicts.length, 0);
  console.log('ok: same-file syntactic-separation scenario stays parallel-safe');
}

testParallelSafeScenario();
testReadSetConflictScenario();
testSharedSurfaceWinsOverReadSetScenario();
testCidConflictScenario();
testFileOverlapScenario();
testFileOverlapWithSyntacticSeparationScenario();
console.log('all broker decision tests passed');
