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
    lane: 'direct-brokered',
    admission: intent.proposalAdmission ? {
      trigger: intent.proposalAdmission.trigger,
      state: intent.proposalAdmission.summarySubmitted ? 'proposal-submitted' : 'proposal-submitted',
      requiresProposal: intent.proposalAdmission.trigger !== 'not-required',
      summarySubmitted: intent.proposalAdmission.summarySubmitted,
      hotFiles: [...(intent.proposalAdmission.hotFiles ?? [])],
      boundedRegions: [...(intent.proposalAdmission.boundedRegions ?? [])],
      rearbitrationRequired: false,
      reason: intent.proposalAdmission.notes ?? 'test admission'
    } : undefined
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
  assert.equal(decision.admission?.state, 'not-required');
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
  assert.equal(decision.admission?.state, 'composer-routed');
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

function testProposalFirstHotFileScenario() {
  const decision = calculateBrokerDecision(makeIntent({
    targetFiles: ['src/hot.ts'],
    proposalAdmission: {
      trigger: 'hot-file',
      summarySubmitted: false,
      hotFiles: ['src/hot.ts'],
      boundedRegions: [{ filePath: 'src/hot.ts', lineStart: 1, lineEnd: 20 }]
    }
  }), registryWith([]));
  assert.equal(decision.verdict, 'parallel-safe');
  assert.equal(decision.admission?.state, 'proposal-submitted');
  assert.equal(decision.admission?.requiresProposal, true);
  console.log('ok: hot-file proposal-first scenario emits proposal-submitted state');
}

function testProposalFirstBlockedBeforeWriteScenario() {
  const active = makeIntent({
    taskId: 'TASK-A',
    targetFiles: ['src/shared-hot.ts'],
    atomRefs: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify' }],
    sharedSurfaces: { generators: ['shared-gen'], projections: [], registries: [], validators: [], artifacts: [] }
  });
  const conflictingIntent = makeIntent({
    taskId: 'TASK-B',
    actorId: 'agent-b',
    targetFiles: ['src/shared-hot.ts'],
    atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify' }],
    sharedSurfaces: { generators: ['shared-gen'], projections: [], registries: [], validators: [], artifacts: [] },
    proposalAdmission: {
      trigger: 'shared-surface-risk',
      summarySubmitted: true,
      hotFiles: ['src/shared-hot.ts']
    }
  });
  const decision = calculateBrokerDecision(conflictingIntent, registryWith([toActiveIntent(active, 'intent-a')]));
  assert.equal(decision.verdict, 'blocked-shared-surface');
  assert.equal(decision.admission?.state, 'blocked-before-write');
  console.log('ok: proposal-first conflict emits blocked-before-write');
}

function testProposalDisjointRegionsRouteComposerBeforeWrite() {
  const active = makeIntent({
    taskId: 'TASK-A',
    actorId: 'agent-a',
    targetFiles: ['src/shared-hot.ts'],
    atomRefs: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify' }],
    proposalAdmission: {
      trigger: 'hot-file',
      summarySubmitted: true,
      hotFiles: ['src/shared-hot.ts'],
      boundedRegions: [{ filePath: 'src/shared-hot.ts', lineStart: 1, lineEnd: 10 }]
    }
  });
  const newIntent = makeIntent({
    taskId: 'TASK-B',
    actorId: 'agent-b',
    targetFiles: ['src/shared-hot.ts'],
    atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify' }],
    proposalAdmission: {
      trigger: 'same-file-overlap-risk',
      summarySubmitted: true,
      boundedRegions: [{ filePath: 'src/shared-hot.ts', lineStart: 20, lineEnd: 30 }]
    }
  });
  const decision = calculateBrokerDecision(newIntent, registryWith([toActiveIntent(active, 'intent-a')]));
  assert.equal(decision.verdict, 'needs-physical-split');
  assert.equal(decision.lane, 'deterministic-composer');
  assert.equal(decision.admission?.state, 'composer-routed');
  console.log('ok: disjoint proposal regions route through composer before write');
}

function testSameOwnerProposalDisjointRegionsRouteComposerBeforeWrite() {
  const active = makeIntent({
    taskId: 'TASK-A',
    actorId: 'agent-a',
    targetFiles: ['src/shared-owner-map.ts'],
    atomRefs: [{
      atomId: 'atm.shared-owner-map',
      atomCid: 'cid-owner-a',
      operation: 'modify',
      sourceRange: {
        filePath: 'src/shared-owner-map.ts',
        lineStart: 1,
        lineEnd: 12
      }
    }],
    proposalAdmission: {
      trigger: 'hot-file',
      summarySubmitted: true,
      hotFiles: ['src/shared-owner-map.ts'],
      boundedRegions: [{ filePath: 'src/shared-owner-map.ts', lineStart: 1, lineEnd: 12 }]
    }
  });
  const newIntent = makeIntent({
    taskId: 'TASK-B',
    actorId: 'agent-b',
    targetFiles: ['src/shared-owner-map.ts'],
    atomRefs: [{
      atomId: 'atm.shared-owner-map',
      atomCid: 'cid-owner-b',
      operation: 'modify',
      sourceRange: {
        filePath: 'src/shared-owner-map.ts',
        lineStart: 20,
        lineEnd: 28
      }
    }],
    proposalAdmission: {
      trigger: 'same-file-overlap-risk',
      summarySubmitted: true,
      boundedRegions: [{ filePath: 'src/shared-owner-map.ts', lineStart: 20, lineEnd: 28 }]
    }
  });
  const decision = calculateBrokerDecision(newIntent, registryWith([toActiveIntent(active, 'intent-a')]));
  assert.equal(decision.verdict, 'needs-physical-split');
  assert.equal(decision.lane, 'deterministic-composer');
  assert.equal(decision.admission?.state, 'composer-routed');
  console.log('ok: same-owner disjoint proposal regions route through composer before write');
}

function testSameOwnerProposalOverlapRemainsBlocked() {
  const active = makeIntent({
    taskId: 'TASK-A',
    actorId: 'agent-a',
    targetFiles: ['src/shared-owner-map.ts'],
    atomRefs: [{
      atomId: 'atm.shared-owner-map',
      atomCid: 'cid-owner-a',
      operation: 'modify',
      sourceRange: {
        filePath: 'src/shared-owner-map.ts',
        lineStart: 1,
        lineEnd: 20
      }
    }],
    proposalAdmission: {
      trigger: 'hot-file',
      summarySubmitted: true,
      hotFiles: ['src/shared-owner-map.ts'],
      boundedRegions: [{ filePath: 'src/shared-owner-map.ts', lineStart: 1, lineEnd: 20 }]
    }
  });
  const newIntent = makeIntent({
    taskId: 'TASK-B',
    actorId: 'agent-b',
    targetFiles: ['src/shared-owner-map.ts'],
    atomRefs: [{
      atomId: 'atm.shared-owner-map',
      atomCid: 'cid-owner-b',
      operation: 'modify',
      sourceRange: {
        filePath: 'src/shared-owner-map.ts',
        lineStart: 10,
        lineEnd: 10
      }
    }],
    proposalAdmission: {
      trigger: 'same-file-overlap-risk',
      summarySubmitted: true,
      boundedRegions: [{ filePath: 'src/shared-owner-map.ts', lineStart: 10, lineEnd: 10 }]
    }
  });
  const decision = calculateBrokerDecision(newIntent, registryWith([toActiveIntent(active, 'intent-a')]));
  assert.equal(decision.verdict, 'blocked-cid-conflict');
  assert.equal(decision.lane, 'blocked');
  assert.ok(Boolean(decision.decompositionRequest));
  console.log('ok: same-owner overlapping proposal regions remain blocked');
}

function testProposalOverlapParksFirstWriterForRearbitration() {
  const active = makeIntent({
    taskId: 'TASK-A',
    actorId: 'agent-a',
    targetFiles: ['src/shared-hot.ts'],
    atomRefs: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify' }],
    proposalAdmission: {
      trigger: 'hot-file',
      summarySubmitted: true,
      hotFiles: ['src/shared-hot.ts'],
      boundedRegions: [{ filePath: 'src/shared-hot.ts', lineStart: 5, lineEnd: 15 }]
    }
  });
  const newIntent = makeIntent({
    taskId: 'TASK-B',
    actorId: 'agent-b',
    targetFiles: ['src/shared-hot.ts'],
    atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify' }],
    proposalAdmission: {
      trigger: 'same-file-overlap-risk',
      summarySubmitted: true,
      boundedRegions: [{ filePath: 'src/shared-hot.ts', lineStart: 10, lineEnd: 18 }]
    }
  });
  const decision = calculateBrokerDecision(newIntent, registryWith([toActiveIntent(active, 'intent-a')]));
  assert.equal(decision.verdict, 'blocked-active-lease');
  assert.equal(decision.admission?.state, 'blocked-before-write');
  assert.equal(decision.admission?.rearbitrationRequired, true);
  console.log('ok: overlapping proposal regions park first writer and block before write');
}

testParallelSafeScenario();
testReadSetConflictScenario();
testSharedSurfaceWinsOverReadSetScenario();
testCidConflictScenario();
testFileOverlapScenario();
testFileOverlapWithSyntacticSeparationScenario();
testProposalFirstHotFileScenario();
testProposalFirstBlockedBeforeWriteScenario();
testProposalDisjointRegionsRouteComposerBeforeWrite();
testSameOwnerProposalDisjointRegionsRouteComposerBeforeWrite();
testSameOwnerProposalOverlapRemainsBlocked();
testProposalOverlapParksFirstWriterForRearbitration();
console.log('all broker decision tests passed');
