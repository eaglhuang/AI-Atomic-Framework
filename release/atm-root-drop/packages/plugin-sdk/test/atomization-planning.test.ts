import assert from 'node:assert/strict';
import type {
  AtomCandidate,
  AtomCandidateDiscoveryRequest,
  AtomizationPlan,
  AtomizationPlanRequest,
  AtomizationPlanStep,
  AtomizationPlanningAdapter,
  EnclosingUnit,
  VirtualAtom
} from '../src/atomization-planning.ts';
import { isAtomCandidate, isAtomizationPlan, isEnclosingUnit, isVirtualAtom } from '../src/atomization-planning.ts';

const candidate: AtomCandidate = {
  candidateId: 'demo:function:loadRows:deadbeef',
  kind: 'function',
  symbol: 'loadRows',
  filePath: 'src/load-rows.ts',
  lineStart: 3,
  lineEnd: 9,
  confidence: 'high',
  detectionMethod: 'scanner',
  suggestedAtomId: 'ATM-DEMO-deadbeef',
  suggestedSourcePaths: ['src/load-rows.ts'],
  notes: ['top-level function']
};

const planStep: AtomizationPlanStep = {
  stepKind: 'extract-unit',
  description: 'Extract loadRows into an atom unit.',
  patchHint: 'src/load-rows.ts'
};

const plan: AtomizationPlan = {
  atomId: 'ATM-DEMO-deadbeef',
  dryRun: true,
  target: candidate,
  patchFiles: ['src/load-rows.ts', 'atomic_workbench/atoms/ATM-DEMO-deadbeef'],
  steps: [planStep],
  evidenceRequired: ['test-report'],
  rollbackNotes: 'Dry-run produced no mutations; discard the plan to roll back.',
  messages: [{ level: 'info', code: 'DEMO_OK', text: 'plan built' }]
};

const enclosingUnit: EnclosingUnit = {
  kind: 'function',
  symbol: 'loadRows',
  fileRange: {
    file: 'src/load-rows.ts',
    lineStart: 3,
    lineEnd: 9
  },
  confidenceClass: 'high'
};

const virtualAtom: VirtualAtom = {
  kind: 'function',
  symbol: 'loadRows',
  sourcePaths: ['src/load-rows.ts'],
  detectionMethod: 'agr-layer1',
  layer: 1,
  confidenceClass: 'high',
  atomCid: 'atom:cid:demo-load-rows'
};

function testCandidateSchemaGuard() {
  assert.equal(isAtomCandidate(candidate), true, 'well-formed candidate must pass the schema guard');

  assert.equal(isAtomCandidate(null), false);
  assert.equal(isAtomCandidate({}), false);
  assert.equal(isAtomCandidate({ ...candidate, kind: 'service' }), false, 'unknown kind must fail');
  assert.equal(isAtomCandidate({ ...candidate, confidence: 'certain' }), false, 'unknown confidence must fail');
  assert.equal(isAtomCandidate({ ...candidate, detectionMethod: 'guess' }), false, 'unknown detection method must fail');
  assert.equal(isAtomCandidate({ ...candidate, candidateId: '' }), false, 'empty candidateId must fail');
  assert.equal(isAtomCandidate({ ...candidate, lineStart: '3' }), false, 'non-numeric lineStart must fail');
  assert.equal(isAtomCandidate({ ...candidate, lineStart: null, lineEnd: null }), true, 'null line range is allowed');
  assert.equal(isAtomCandidate({ ...candidate, notes: ['ok', 42] }), false, 'non-string note must fail');

  const { suggestedAtomId, suggestedSourcePaths, notes, ...minimal } = candidate;
  assert.equal(isAtomCandidate(minimal), true, 'optional fields may be omitted');
  console.log('ok: AtomCandidate schema guard');
}

function testPlanSchemaGuard() {
  assert.equal(isAtomizationPlan(plan), true, 'well-formed plan must pass the schema guard');

  assert.equal(isAtomizationPlan({ ...plan, dryRun: false }), false, 'plans must be dry-run');
  assert.equal(isAtomizationPlan({ ...plan, target: {} }), false, 'plan target must be a valid candidate');
  assert.equal(isAtomizationPlan({ ...plan, steps: [{ description: 'missing stepKind' }] }), false);
  assert.equal(isAtomizationPlan({ ...plan, patchFiles: [1] }), false, 'patchFiles must be strings');
  assert.equal(isAtomizationPlan({ ...plan, rollbackNotes: undefined }), false, 'rollbackNotes is required');
  console.log('ok: AtomizationPlan schema guard');
}

function testLayer1SchemaGuards() {
  assert.equal(isEnclosingUnit(enclosingUnit), true, 'well-formed enclosing unit must pass the schema guard');
  assert.equal(isEnclosingUnit({ ...enclosingUnit, kind: 'route' }), false, 'unknown enclosing kind must fail');
  assert.equal(isEnclosingUnit({ ...enclosingUnit, fileRange: { ...enclosingUnit.fileRange, lineEnd: 2 } }), false);
  assert.equal(isEnclosingUnit({ ...enclosingUnit, confidenceClass: 'certain' }), false, 'confidence class must stay bounded');

  assert.equal(isVirtualAtom(virtualAtom), true, 'well-formed virtual atom must pass the schema guard');
  assert.equal(isVirtualAtom({ ...virtualAtom, detectionMethod: 'guess' }), false, 'unknown virtual-atom detection method must fail');
  assert.equal(isVirtualAtom({ ...virtualAtom, layer: 3 }), false, 'layer must be 1 or 2');
  assert.equal(isVirtualAtom({ ...virtualAtom, sourcePaths: [] }), false, 'virtual atom must keep at least one source path');
  assert.equal(isVirtualAtom({ ...virtualAtom, atomCid: '' }), false, 'virtual atom CID handoff must be present');
  console.log('ok: EnclosingUnit and VirtualAtom schema guards');
}

async function testOptionalAdapterShape() {
  const adapter: AtomizationPlanningAdapter = {
    discoverAtomCandidates(request: AtomCandidateDiscoveryRequest) {
      assert.ok(Array.isArray(request.sourceFiles));
      return [candidate];
    },
    planAtomize(request: AtomizationPlanRequest) {
      assert.equal(request.dryRun, true);
      return { ...plan, atomId: request.atomId };
    },
    enclose(file: string, line: number) {
      assert.equal(file, 'src/load-rows.ts');
      assert.equal(line, 3);
      return enclosingUnit;
    }
  };

  const backwardCompatibleAdapter: AtomizationPlanningAdapter = {
    discoverAtomCandidates(request: AtomCandidateDiscoveryRequest) {
      assert.ok(Array.isArray(request.sourceFiles));
      return [candidate];
    },
    planAtomize(request: AtomizationPlanRequest) {
      assert.equal(request.dryRun, true);
      return { ...plan, atomId: request.atomId };
    }
  };

  assert.equal(typeof backwardCompatibleAdapter.enclose, 'undefined', 'enclose remains optional for older adapters');

  const discovered = await adapter.discoverAtomCandidates({
    sourceFiles: [{ filePath: 'src/load-rows.ts', sourceText: 'export function loadRows() {}', languageId: 'ts' }]
  });
  assert.equal(discovered.length, 1);
  assert.ok(discovered.every((entry) => isAtomCandidate(entry)));

  const planned = await adapter.planAtomize({
    atomId: 'ATM-DEMO-0001',
    target: candidate,
    sourceFiles: [],
    dryRun: true
  });
  assert.equal(planned.atomId, 'ATM-DEMO-0001');
  assert.ok(isAtomizationPlan(planned));

  const enclosing = adapter.enclose?.('src/load-rows.ts', 3);
  assert.ok(enclosing);
  assert.ok(isEnclosingUnit(enclosing));
  console.log('ok: AtomizationPlanningAdapter optional interface shape');
}

testCandidateSchemaGuard();
testPlanSchemaGuard();
testLayer1SchemaGuards();
await testOptionalAdapterShape();
console.log('all plugin-sdk atomization-planning tests passed');
