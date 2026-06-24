import assert from 'node:assert/strict';
import { evaluateConflictMatrix } from '../conflict-matrix.ts';
import type { ActiveWriteIntent, WriteIntent } from '../types.ts';

function makeIntent(overrides: Partial<WriteIntent> = {}): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'test' },
    taskId: 'TASK-A',
    actorId: 'actor-a',
    baseCommit: 'abc123',
    targetFiles: ['src/one.ts'],
    atomRefs: [
      { atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify', sourceRange: { filePath: 'src/one.ts', lineStart: 1, lineEnd: 10 } }
    ],
    sharedSurfaces: {
      generators: ['gen-a'],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    requestedLane: 'auto',
    ...overrides
  };
}

function asActive(intent: WriteIntent, taskId: string, overrides: Partial<ActiveWriteIntent> = {}): ActiveWriteIntent {
  return {
    intentId: `${taskId}-intent`,
    taskId,
    teamRunId: null,
    actorId: intent.actorId,
    baseCommit: intent.baseCommit,
    resourceKeys: {
      files: intent.targetFiles,
      atomIds: intent.atomRefs.map((ref) => ref.atomId),
      atomCids: intent.atomRefs.map((ref) => ref.atomCid),
      readAtomIds: (intent.readAtoms ?? []).map((ref) => ref.atomId),
      readAtomCids: (intent.readAtoms ?? []).map((ref) => ref.atomCid),
      generators: intent.sharedSurfaces.generators,
      projections: intent.sharedSurfaces.projections,
      registries: intent.sharedSurfaces.registries,
      validators: intent.sharedSurfaces.validators,
      artifacts: intent.sharedSurfaces.artifacts,
      atomRanges: intent.atomRefs
        .map((ref) => ref.sourceRange && {
          filePath: ref.sourceRange.filePath,
          lineStart: ref.sourceRange.lineStart,
          lineEnd: ref.sourceRange.lineEnd,
          atomCid: ref.atomCid
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    },
    leaseEpoch: 1,
    leaseSeconds: 1800,
    leaseMaxSeconds: 1800,
    heartbeatAt: '2026-01-01T00:00:00.000Z',
    lane: 'direct-brokered',
    ...overrides
  };
}

function testAllow() {
  const newIntent = makeIntent();
  const matrix = evaluateConflictMatrix(newIntent, []);
  assert.equal(matrix.arbitrationVerdict, 'allow');
  assert.equal(matrix.conflicts.length, 0);
  console.log('ok: baseline intent yields allow');
}

function testWatchForSharedSurface() {
  const active = asActive(
    makeIntent({ taskId: 'TASK-B', actorId: 'actor-b' }),
    'TASK-B'
  );
  const newIntent = makeIntent({
    taskId: 'TASK-C',
    actorId: 'actor-c'
  });
  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.equal(matrix.arbitrationVerdict, 'freeze');
  assert.ok(matrix.conflicts.some((conflict) => conflict.kind === 'shared-surface'));
  console.log('ok: shared-surface overlap maps to freeze');
}

function testWatchForFileRangeOverlap() {
  const active = asActive(
    makeIntent({
      taskId: 'TASK-B',
      actorId: 'actor-b',
      sharedSurfaces: {
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: []
      },
      targetFiles: ['src/one.ts'],
      atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify', sourceRange: { filePath: 'src/one.ts', lineStart: 20, lineEnd: 30 } }]
    }),
    'TASK-B'
  );
  const newIntent = makeIntent({
    taskId: 'TASK-C',
    actorId: 'actor-c',
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    atomRefs: [{ atomId: 'atom-c', atomCid: 'cid-c', operation: 'modify', sourceRange: { filePath: 'src/one.ts', lineStart: 15, lineEnd: 25 } }]
  });
  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.equal(matrix.arbitrationVerdict, 'freeze');
  assert.ok(matrix.conflicts.some((conflict) => conflict.kind === 'file-range'));
  console.log('ok: overlapping source ranges maps to freeze');
}

function testWatchForDisjointFileRange() {
  const active = asActive(
    makeIntent({
      taskId: 'TASK-B',
      actorId: 'actor-b',
      sharedSurfaces: {
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: []
      },
      atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify', sourceRange: { filePath: 'src/one.ts', lineStart: 20, lineEnd: 30 } }]
    }),
    'TASK-B'
  );
  const newIntent = makeIntent({
    taskId: 'TASK-C',
    actorId: 'actor-c',
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    atomRefs: [{ atomId: 'atom-c', atomCid: 'cid-c', operation: 'modify', sourceRange: { filePath: 'src/one.ts', lineStart: 1, lineEnd: 10 } }]
  });
  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.equal(matrix.arbitrationVerdict, 'watch');
  assert.ok(matrix.conflicts.some((conflict) => conflict.kind === 'file-range'));
  console.log('ok: disjoint ranges map to watch');
}

function testReadSetConflict() {
  const activeIntent = asActive(
    makeIntent({ taskId: 'TASK-B', actorId: 'actor-b', atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify' }] }),
    'TASK-B'
  );
  const newIntent = makeIntent({
    taskId: 'TASK-C',
    actorId: 'actor-c',
    readAtoms: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify' }],
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    }
  });
  const matrix = evaluateConflictMatrix(newIntent, [activeIntent]);
  assert.equal(matrix.arbitrationVerdict, 'watch');
  assert.ok(matrix.conflicts.some((conflict) => conflict.kind === 'read-set'));
  console.log('ok: read-set overlap maps to watch');
}

function testActiveReadSetConflict() {
  const activeIntent = asActive(
    makeIntent({
      taskId: 'TASK-B',
      actorId: 'actor-b',
      readAtoms: [{ atomId: 'atom-c', atomCid: 'cid-c', operation: 'modify' }],
      atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify' }]
    }),
    'TASK-B'
  );
  const newIntent = makeIntent({
    taskId: 'TASK-C',
    actorId: 'actor-c',
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    atomRefs: [{ atomId: 'atom-c', atomCid: 'cid-c', operation: 'modify' }]
  });
  const matrix = evaluateConflictMatrix(newIntent, [activeIntent]);
  assert.equal(matrix.arbitrationVerdict, 'watch');
  assert.ok(matrix.conflicts.some((conflict) => conflict.kind === 'read-set' && conflict.detail.includes('read by active task')));
  console.log('ok: active read-set overlap maps to watch');
}

function testTakeoverForMalformedIntent() {
  const newIntent = makeIntent({ atomRefs: [] as any, targetFiles: [] as any });
  const matrix = evaluateConflictMatrix(newIntent as any, []);
  assert.equal(matrix.arbitrationVerdict, 'takeover');
  assert.equal(matrix.conflicts[0].kind, 'intent-shape');
  console.log('ok: malformed intent maps to takeover');
}

function testTakeoverForStaleLease() {
  const stale = asActive(
    makeIntent({
      taskId: 'TASK-B',
      actorId: 'actor-b',
      sharedSurfaces: {
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: []
      },
      atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify', sourceRange: { filePath: 'src/lease.ts', lineStart: 1, lineEnd: 2 } }]
    }),
    'TASK-B',
    { expiresAt: '2000-01-01T00:00:00.000Z' }
  );
  const matrix = evaluateConflictMatrix(makeIntent({ taskId: 'TASK-C' }), [stale]);
  assert.equal(matrix.arbitrationVerdict, 'takeover');
  assert.equal(matrix.conflicts[0].kind, 'lease');
  console.log('ok: stale lease maps to takeover');
}

function testTakeoverForStaleLeaseEpoch() {
  const active = asActive(
    makeIntent({
      taskId: 'TASK-B',
      actorId: 'actor-b',
      sharedSurfaces: {
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: []
      },
      atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify', sourceRange: { filePath: 'src/lease-epoch.ts', lineStart: 1, lineEnd: 2 } }]
    }),
    'TASK-B',
    { leaseEpoch: 1, expiresAt: '2099-01-01T00:00:00.000Z' }
  );
  const matrix = evaluateConflictMatrix(makeIntent({ taskId: 'TASK-C' }), [active], { currentEpoch: 2 });
  assert.equal(matrix.arbitrationVerdict, 'takeover');
  assert.equal(matrix.conflicts[0].kind, 'lease');
  assert.match(matrix.conflicts[0].detail, /currentEpoch 2/);
  console.log('ok: stale lease epoch maps to takeover');
}

function testFreezeForSameAtomCidWriteWrite() {
  const active = asActive(
    makeIntent({
      taskId: 'TASK-B',
      actorId: 'actor-b',
      targetFiles: ['src/two.ts'],
      sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
      atomRefs: [{ atomId: 'atom-shared', atomCid: 'cid-shared', operation: 'modify', sourceRange: { filePath: 'src/two.ts', lineStart: 100, lineEnd: 110 } }]
    }),
    'TASK-B'
  );
  const newIntent = makeIntent({
    taskId: 'TASK-C',
    actorId: 'actor-c',
    targetFiles: ['src/three.ts'],
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
    atomRefs: [{ atomId: 'atom-shared', atomCid: 'cid-shared', operation: 'modify', sourceRange: { filePath: 'src/three.ts', lineStart: 1, lineEnd: 10 } }]
  });
  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.equal(matrix.arbitrationVerdict, 'freeze');
  assert.ok(matrix.conflicts.some((conflict) => conflict.kind === 'cid'));
  assert.ok(matrix.conflicts.some((conflict) => conflict.detail.includes('cid-shared') || conflict.detail.includes('atom-shared')));
  console.log('ok: same-atom write/write maps to freeze with cid conflict');
}

function testFreezeForSharedArtifactDrift() {
  const active = asActive(
    makeIntent({
      taskId: 'TASK-B',
      actorId: 'actor-b',
      targetFiles: ['src/two.ts'],
      sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: ['release/dist/atm-bundle.js'] },
      atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify', sourceRange: { filePath: 'src/two.ts', lineStart: 1, lineEnd: 5 } }]
    }),
    'TASK-B'
  );
  const newIntent = makeIntent({
    taskId: 'TASK-C',
    actorId: 'actor-c',
    targetFiles: ['src/three.ts'],
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: ['release/dist/atm-bundle.js'] },
    atomRefs: [{ atomId: 'atom-c', atomCid: 'cid-c', operation: 'modify', sourceRange: { filePath: 'src/three.ts', lineStart: 1, lineEnd: 5 } }]
  });
  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.equal(matrix.arbitrationVerdict, 'freeze');
  const artifactConflict = matrix.conflicts.find((conflict) => conflict.kind === 'shared-surface' && conflict.detail.includes('artifact'));
  assert.ok(artifactConflict, 'expected shared-surface artifact conflict');
  assert.ok(artifactConflict!.detail.includes('release/dist/atm-bundle.js'), 'generated artifact owner must be named in detail');
  assert.equal(artifactConflict!.blockingTask, 'TASK-B');
  console.log('ok: generated artifact drift maps to freeze and names artifact owner');
}

function testFreezeForSharedRegistry() {
  const active = asActive(
    makeIntent({
      taskId: 'TASK-B',
      actorId: 'actor-b',
      targetFiles: ['src/two.ts'],
      sharedSurfaces: { generators: [], projections: [], registries: ['atom-registry-main'], validators: [], artifacts: [] },
      atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify', sourceRange: { filePath: 'src/two.ts', lineStart: 1, lineEnd: 5 } }]
    }),
    'TASK-B'
  );
  const newIntent = makeIntent({
    taskId: 'TASK-C',
    actorId: 'actor-c',
    targetFiles: ['src/three.ts'],
    sharedSurfaces: { generators: [], projections: [], registries: ['atom-registry-main'], validators: [], artifacts: [] },
    atomRefs: [{ atomId: 'atom-c', atomCid: 'cid-c', operation: 'modify', sourceRange: { filePath: 'src/three.ts', lineStart: 1, lineEnd: 5 } }]
  });
  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.equal(matrix.arbitrationVerdict, 'freeze');
  assert.ok(matrix.conflicts.some((conflict) => conflict.kind === 'shared-surface' && conflict.detail.includes('registry')));
  console.log('ok: shared registry surface maps to freeze');
}

function testFreezeForSharedValidator() {
  const active = asActive(
    makeIntent({
      taskId: 'TASK-B',
      actorId: 'actor-b',
      targetFiles: ['src/two.ts'],
      sharedSurfaces: { generators: [], projections: [], registries: [], validators: ['npm:typecheck'], artifacts: [] },
      atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify', sourceRange: { filePath: 'src/two.ts', lineStart: 1, lineEnd: 5 } }]
    }),
    'TASK-B'
  );
  const newIntent = makeIntent({
    taskId: 'TASK-C',
    actorId: 'actor-c',
    targetFiles: ['src/three.ts'],
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: ['npm:typecheck'], artifacts: [] },
    atomRefs: [{ atomId: 'atom-c', atomCid: 'cid-c', operation: 'modify', sourceRange: { filePath: 'src/three.ts', lineStart: 1, lineEnd: 5 } }]
  });
  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.equal(matrix.arbitrationVerdict, 'freeze');
  assert.ok(matrix.conflicts.some((conflict) => conflict.kind === 'shared-surface' && conflict.detail.includes('validator')));
  console.log('ok: shared validator surface maps to freeze');
}

function testFreezeForSharedProjection() {
  const active = asActive(
    makeIntent({
      taskId: 'TASK-B',
      actorId: 'actor-b',
      targetFiles: ['src/two.ts'],
      sharedSurfaces: { generators: [], projections: ['atom-map-projection'], registries: [], validators: [], artifacts: [] },
      atomRefs: [{ atomId: 'atom-b', atomCid: 'cid-b', operation: 'modify', sourceRange: { filePath: 'src/two.ts', lineStart: 1, lineEnd: 5 } }]
    }),
    'TASK-B'
  );
  const newIntent = makeIntent({
    taskId: 'TASK-C',
    actorId: 'actor-c',
    targetFiles: ['src/three.ts'],
    sharedSurfaces: { generators: [], projections: ['atom-map-projection'], registries: [], validators: [], artifacts: [] },
    atomRefs: [{ atomId: 'atom-c', atomCid: 'cid-c', operation: 'modify', sourceRange: { filePath: 'src/three.ts', lineStart: 1, lineEnd: 5 } }]
  });
  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.equal(matrix.arbitrationVerdict, 'freeze');
  assert.ok(matrix.conflicts.some((conflict) => conflict.kind === 'shared-surface' && conflict.detail.includes('projection')));
  console.log('ok: shared projection surface maps to freeze');
}

testAllow();
testWatchForSharedSurface();
testWatchForFileRangeOverlap();
testWatchForDisjointFileRange();
testReadSetConflict();
testActiveReadSetConflict();
testTakeoverForMalformedIntent();
testTakeoverForStaleLease();
testTakeoverForStaleLeaseEpoch();
testFreezeForSameAtomCidWriteWrite();
testFreezeForSharedArtifactDrift();
testFreezeForSharedRegistry();
testFreezeForSharedValidator();
testFreezeForSharedProjection();

console.log('all conflict-matrix tests passed');
