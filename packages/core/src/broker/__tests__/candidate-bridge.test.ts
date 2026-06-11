import assert from 'node:assert/strict';
import type { AtomCandidate } from '../../../../plugin-sdk/src/atomization-planning.ts';
import {
  candidatesToWriteIntent,
  computeCandidateAtomCid,
  type BridgeAtomCandidate
} from '../candidate-bridge.ts';
import { calculateBrokerDecision } from '../decision.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from '../types.ts';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function makeCandidate(overrides: Partial<BridgeAtomCandidate> = {}): BridgeAtomCandidate {
  return deepFreeze({
    candidateId: 'js:function:loadRows:deadbeef',
    kind: 'function',
    symbol: 'loadRows',
    filePath: 'src/load-rows.ts',
    lineStart: 1,
    lineEnd: 7,
    confidence: 'high' as const,
    detectionMethod: 'scanner',
    suggestedAtomId: 'ATM-JS-deadbeef',
    suggestedSourcePaths: ['src/load-rows.ts'],
    ...overrides
  });
}

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
      generators: intent.sharedSurfaces.generators,
      projections: intent.sharedSurfaces.projections,
      registries: intent.sharedSurfaces.registries,
      validators: intent.sharedSurfaces.validators,
      artifacts: intent.sharedSurfaces.artifacts
    },
    leaseEpoch: 1,
    lane: 'direct-brokered'
  };
}

const baseContext = { taskId: 'TASK-A', actorId: 'agent-a', baseCommit: 'abc123' };

function testWellFormedWriteIntent() {
  const candidates = [
    makeCandidate(),
    makeCandidate({
      candidateId: 'js:class:RowStore:cafef00d',
      kind: 'class',
      symbol: 'RowStore',
      filePath: 'src/row-store.ts',
      suggestedAtomId: 'ATM-JS-cafef00d',
      suggestedSourcePaths: ['src/row-store.ts', 'src/row-store-types.ts']
    })
  ];

  const intent = candidatesToWriteIntent(candidates, baseContext);

  assert.equal(intent.schemaId, 'atm.writeIntent.v1');
  assert.equal(intent.specVersion, '0.1.0');
  assert.equal(intent.taskId, 'TASK-A');
  assert.equal(intent.actorId, 'agent-a');
  assert.equal(intent.baseCommit, 'abc123');
  assert.equal(intent.requestedLane, 'auto');
  assert.deepEqual(intent.targetFiles, ['src/load-rows.ts', 'src/row-store-types.ts', 'src/row-store.ts']);
  assert.equal(intent.atomRefs.length, 2);
  assert.ok(intent.atomRefs.every((ref) => ref.operation === 'create'));
  assert.ok(intent.atomRefs.every((ref) => /^[0-9a-f]{64}$/.test(ref.atomCid)));
  assert.deepEqual(intent.sharedSurfaces, {
    generators: [],
    projections: [],
    registries: [],
    validators: [],
    artifacts: []
  });

  const overridden = candidatesToWriteIntent(candidates, {
    ...baseContext,
    sharedSurfaces: { validators: ['typecheck'] },
    requestedLane: 'serial'
  });
  assert.deepEqual(overridden.sharedSurfaces.validators, ['typecheck']);
  assert.equal(overridden.requestedLane, 'serial');

  assert.throws(() => candidatesToWriteIntent([], baseContext), TypeError);
  console.log('ok: well-formed WriteIntent (multiple candidates -> single intent)');
}

function testDeterministicAtomCid() {
  const first = computeCandidateAtomCid(makeCandidate());
  const second = computeCandidateAtomCid(makeCandidate());
  assert.equal(first, second, 'same candidate must produce the same atomCid across runs');

  const differentSymbol = computeCandidateAtomCid(makeCandidate({ symbol: 'otherSymbol' }));
  assert.notEqual(first, differentSymbol);

  const differentMethod = computeCandidateAtomCid(makeCandidate({ detectionMethod: 'ast' }));
  assert.notEqual(first, differentMethod);

  const reorderedPaths = computeCandidateAtomCid(makeCandidate({
    suggestedSourcePaths: ['src/z.ts', 'src/a.ts']
  }));
  const sortedPaths = computeCandidateAtomCid(makeCandidate({
    suggestedSourcePaths: ['src/a.ts', 'src/z.ts']
  }));
  assert.equal(reorderedPaths, sortedPaths, 'source path order must not change the canonical contract');

  const missingAtomId = candidatesToWriteIntent([makeCandidate({ suggestedAtomId: undefined })], baseContext);
  assert.match(missingAtomId.atomRefs[0].atomId, /^ATM-AUTO-[0-9a-f]{8}$/);
  console.log('ok: deterministic atomCid (canonical contract, ATM-AUTO fallback)');
}

function testLineBoundedAtomCid() {
  const first = computeCandidateAtomCid(makeCandidate());
  const diffStartLine = computeCandidateAtomCid(makeCandidate({ lineStart: 10 }));
  const diffEndLine = computeCandidateAtomCid(makeCandidate({ lineEnd: 20 }));
  const bothLines = computeCandidateAtomCid(makeCandidate({ lineStart: 3, lineEnd: 7 }));

  assert.notEqual(first, diffStartLine);
  assert.notEqual(first, diffEndLine);
  assert.notEqual(diffStartLine, bothLines);
  assert.notEqual(diffEndLine, bothLines);
  assert.ok(first.length === 64);
  console.log('ok: line-bounded candidates generate distinct deterministic CIDs');
}

function testParallelSafeScenario() {
  const intentA = candidatesToWriteIntent([makeCandidate()], baseContext);
  const intentB = candidatesToWriteIntent(
    [makeCandidate({ symbol: 'RowStore', kind: 'class', filePath: 'src/row-store.ts', suggestedAtomId: 'ATM-JS-cafef00d', suggestedSourcePaths: undefined })],
    { taskId: 'TASK-B', actorId: 'agent-b', baseCommit: 'abc123' }
  );

  const decision = calculateBrokerDecision(intentB, registryWith([toActiveIntent(intentA, 'intent-a')]));
  assert.equal(decision.verdict, 'parallel-safe');
  assert.equal(decision.lane, 'direct-brokered');
  assert.equal(decision.conflicts.length, 0);
  console.log('ok: parallel-safe scenario (disjoint files and CIDs)');
}

function testCidConflictScenario() {
  const intentA = candidatesToWriteIntent([makeCandidate()], baseContext);
  const intentB = candidatesToWriteIntent([makeCandidate()], { taskId: 'TASK-B', actorId: 'agent-b', baseCommit: 'abc123' });

  const decision = calculateBrokerDecision(intentB, registryWith([toActiveIntent(intentA, 'intent-a')]));
  assert.equal(decision.verdict, 'blocked-cid-conflict');
  assert.equal(decision.lane, 'blocked');
  assert.ok(decision.conflicts.some((conflict) => conflict.kind === 'cid'));
  console.log('ok: CID conflict scenario (same candidate in two tasks is blocked)');
}

function testFileOverlapScenario() {
  const sharedFile = 'src/shared-module.ts';
  const intentA = candidatesToWriteIntent(
    [makeCandidate({ symbol: 'readSection', filePath: sharedFile, suggestedAtomId: 'ATM-JS-aaaa0001', suggestedSourcePaths: undefined })],
    baseContext
  );
  const intentB = candidatesToWriteIntent(
    [makeCandidate({ symbol: 'writeSection', filePath: sharedFile, suggestedAtomId: 'ATM-JS-bbbb0002', suggestedSourcePaths: undefined })],
    { taskId: 'TASK-B', actorId: 'agent-b', baseCommit: 'abc123' }
  );

  const decision = calculateBrokerDecision(intentB, registryWith([toActiveIntent(intentA, 'intent-a')]));
  assert.equal(decision.verdict, 'needs-physical-split');
  assert.equal(decision.lane, 'deterministic-composer');
  assert.ok(decision.conflicts.some((conflict) => conflict.kind === 'file-range' && conflict.detail.includes(sharedFile)));
  console.log('ok: file overlap scenario (same file, disjoint CIDs -> needs-physical-split)');
}

function testInputIsNotMutated() {
  const candidate = makeCandidate();
  const before = JSON.stringify(candidate);
  candidatesToWriteIntent([candidate], baseContext);
  computeCandidateAtomCid(candidate);
  assert.equal(JSON.stringify(candidate), before, 'bridge must treat candidates as read-only');
  console.log('ok: candidate input is not mutated (deep-frozen input accepted)');
}

function testSdkCandidateAssignability() {
  const sdkCandidate: AtomCandidate = {
    candidateId: 'py:function:load_rows:12345678',
    kind: 'function',
    symbol: 'load_rows',
    filePath: 'tools/load_rows.py',
    lineStart: 1,
    lineEnd: 9,
    confidence: 'high',
    detectionMethod: 'scanner',
    suggestedAtomId: 'ATM-PY-12345678',
    suggestedSourcePaths: ['tools/load_rows.py']
  };
  const bridged: BridgeAtomCandidate = sdkCandidate;
  const intent = candidatesToWriteIntent([bridged], baseContext);
  assert.equal(intent.atomRefs[0].atomId, 'ATM-PY-12345678');
  console.log('ok: plugin-sdk AtomCandidate is assignable to the bridge input');
}

testWellFormedWriteIntent();
testDeterministicAtomCid();
testLineBoundedAtomCid();
testParallelSafeScenario();
testCidConflictScenario();
testFileOverlapScenario();
testInputIsNotMutated();
testSdkCandidateAssignability();
console.log('all broker candidate-bridge tests passed');
