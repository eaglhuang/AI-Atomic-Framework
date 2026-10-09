import assert from 'node:assert/strict';
import type { ActiveWriteIntent, LineRange, WriteBrokerRegistryDocument, WriteIntent } from '../types.ts';
import { calculateBrokerDecision } from '../decision.ts';
import { shouldTriggerLayer2, type Layer2TriggerDecision } from '../policy.ts';
import type { Layer2Conflict } from '../agr.ts';

type Layer2OverlapConflict = Layer2Conflict;

function makeWriteIntent(overrides: Partial<WriteIntent> = {}): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'test' },
    taskId: 'TASK-B',
    actorId: 'agent-b',
    baseCommit: 'abc123',
    targetFiles: ['src/overlap.ts'],
    atomRefs: [
      {
        atomId: 'atom-b',
        atomCid: 'cid-b',
        operation: 'modify',
        sourceRange: {
          filePath: 'src/overlap.ts',
          lineStart: 1,
          lineEnd: 3
        }
      }
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

function registryWithActive(conflictRange: LineRange): WriteBrokerRegistryDocument {
  const activeIntent: ActiveWriteIntent = {
    intentId: 'intent-a',
    taskId: 'TASK-A',
    teamRunId: null,
    actorId: 'agent-a',
    baseCommit: 'abc123',
    resourceKeys: {
      files: [conflictRange.filePath],
      atomIds: ['atom-a'],
      atomCids: ['cid-a'],
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: [],
      atomRanges: [
        {
          filePath: conflictRange.filePath,
          lineStart: conflictRange.lineStart,
          lineEnd: conflictRange.lineEnd,
          atomCid: 'cid-a'
        }
      ]
    },
    leaseEpoch: 1234,
    leaseSeconds: 1800,
    leaseMaxSeconds: 1800,
    heartbeatAt: '2026-01-01T00:00:00.000Z',
    lane: 'direct-brokered'
  };

  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'test-repo',
    workspaceId: 'test-workspace',
    activeIntents: [activeIntent]
  };
}

function makeLayer2ConflictRegion(overlap: LineRange): Layer2OverlapConflict {
  return {
    leftAtom: {
      atomId: 'left',
      atomCid: 'left-cid',
      symbol: 'left',
      sourceRange: { ...overlap, lineStart: 1, lineEnd: 10 }
    },
    rightAtom: {
      atomId: 'right',
      atomCid: 'right-cid',
      symbol: 'right',
      sourceRange: overlap
    },
    conflictRegion: overlap
  };
}

function testShouldTriggerLayer2() {
  const conflicts = [
    makeLayer2ConflictRegion({ filePath: 'src/overlap.ts', lineStart: 1, lineEnd: 1 }),
    makeLayer2ConflictRegion({ filePath: 'src/overlap.ts', lineStart: 4, lineEnd: 4 })
  ];

  const result = shouldTriggerLayer2(conflicts, { maxConflictCount: 4, maxConflictDensity: 0.5 });
  assert.equal((result as Layer2TriggerDecision).trigger, true);
  assert.equal((result as Layer2TriggerDecision).targetFunction.atomId, 'left');
  console.log('ok: shouldTriggerLayer2 true with bounded single-file conflicts');
}

function testNoTriggerDensityTooHigh() {
  const conflicts: Layer2OverlapConflict[] = [
    makeLayer2ConflictRegion({ filePath: 'src/overlap.ts', lineStart: 1, lineEnd: 50 }),
    makeLayer2ConflictRegion({ filePath: 'src/overlap.ts', lineStart: 10, lineEnd: 60 })
  ];

  const result = shouldTriggerLayer2(conflicts, { maxConflictCount: 4, maxConflictDensity: 0.2 });
  assert.equal(result.trigger, false);
  assert.match(result.reason, /density/i);
  console.log('ok: shouldTriggerLayer2 false when density exceeds threshold');
}

function testNoTriggerMultiFile() {
  const conflicts: Layer2OverlapConflict[] = [
    {
      leftAtom: {
        atomId: 'left-a',
        atomCid: 'left-a-cid',
        symbol: 'left-a',
        sourceRange: { filePath: 'src/a.ts', lineStart: 1, lineEnd: 3 }
      },
      rightAtom: {
        atomId: 'right-a',
        atomCid: 'right-a-cid',
        symbol: 'right-a',
        sourceRange: { filePath: 'src/a.ts', lineStart: 2, lineEnd: 4 }
      },
      conflictRegion: { filePath: 'src/a.ts', lineStart: 2, lineEnd: 3 }
    },
    {
      leftAtom: {
        atomId: 'left-b',
        atomCid: 'left-b-cid',
        symbol: 'left-b',
        sourceRange: { filePath: 'src/b.ts', lineStart: 1, lineEnd: 3 }
      },
      rightAtom: {
        atomId: 'right-b',
        atomCid: 'right-b-cid',
        symbol: 'right-b',
        sourceRange: { filePath: 'src/b.ts', lineStart: 2, lineEnd: 4 }
      },
      conflictRegion: { filePath: 'src/b.ts', lineStart: 2, lineEnd: 3 }
    }
  ];

  const result = shouldTriggerLayer2(conflicts, { maxConflictCount: 4, maxConflictDensity: 0.5 });
  assert.equal(result.trigger, false);
  assert.match(result.reason, /one file body/);
  console.log('ok: shouldTriggerLayer2 false when conflicts are not single-file bounded');
}

function testDecisionEmitsDecompositionRequest() {
  const intent = makeWriteIntent({
    atomRefs: [{
      atomId: 'atom-b',
      atomCid: 'cid-b',
      operation: 'modify',
      sourceRange: {
        filePath: 'src/overlap.ts',
        lineStart: 6,
        lineEnd: 10
      }
    }]
  });

  const decision = calculateBrokerDecision(intent, registryWithActive({ filePath: 'src/overlap.ts', lineStart: 8, lineEnd: 9 }));
  assert.equal(decision.verdict, 'serial');
  assert.equal(decision.decompositionRequest, undefined, 'A 100% dense overlap exceeds the 50% Layer2 threshold');
  console.log('ok: dense cold overlap queues without inventing a Layer2 split suggestion');
}

function testDecisionKeepsSyntacticSeparation() {
  const intent = makeWriteIntent({
    atomRefs: [{
      atomId: 'atom-b',
      atomCid: 'cid-b',
      operation: 'modify',
      sourceRange: {
        filePath: 'src/overlap.ts',
        lineStart: 1,
        lineEnd: 3
      }
    }]
  });
  const decision = calculateBrokerDecision(intent, registryWithActive({ filePath: 'src/overlap.ts', lineStart: 20, lineEnd: 30 }));
  assert.equal(decision.verdict, 'parallel-safe');
  console.log('ok: decision stays parallel-safe when overlap is syntactically disjoint');
}

testShouldTriggerLayer2();
testNoTriggerDensityTooHigh();
testNoTriggerMultiFile();
testDecisionEmitsDecompositionRequest();
testDecisionKeepsSyntacticSeparation();
console.log('all agr-layer2 tests passed');
