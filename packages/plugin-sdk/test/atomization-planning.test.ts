import assert from 'node:assert/strict';
import type {
  AtomCandidate,
  AtomCandidateDiscoveryRequest,
  AtomizationPlan,
  AtomizationPlanRequest,
  AtomizationPlanStep,
  AtomizationPlanningAdapter
} from '../src/atomization-planning.ts';
import { isAtomCandidate, isAtomizationPlan } from '../src/atomization-planning.ts';

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

async function testOptionalAdapterShape() {
  const adapter: AtomizationPlanningAdapter = {
    discoverAtomCandidates(request: AtomCandidateDiscoveryRequest) {
      assert.ok(Array.isArray(request.sourceFiles));
      return [candidate];
    },
    planAtomize(request: AtomizationPlanRequest) {
      assert.equal(request.dryRun, true);
      return { ...plan, atomId: request.atomId };
    }
  };

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
  console.log('ok: AtomizationPlanningAdapter optional interface shape');
}

testCandidateSchemaGuard();
testPlanSchemaGuard();
await testOptionalAdapterShape();
console.log('all plugin-sdk atomization-planning tests passed');
