import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseBenchmarkV2, assertSealedBytes, assessIndependence, assessGates, type BenchmarkV2 } from '../../scripts/lib/external-benchmark/protocol-v2.ts';

const ref = { uri: 'evidence://fixture', digest: `sha256:${'a'.repeat(64)}` };
function fixture(): BenchmarkV2 {
  return {
    schemaId: 'atm.externalBenchmarkRun.v2', protocolVersion: '2.0.0',
    runId: 'run-1', pairId: 'pair-1', clusterId: 'task-1', arm: 'atm', sequence: 'AB',
    completion: 'unknown',
    operations: [{ operationId: 'op-1', truth: 'unknown', decision: 'unknown', denominator: 'unavailable' }],
    cost: { inputTokens: null, outputTokens: null, billedCost: null, currency: 'USD', humanMinutes: null, computeCost: null, billingEvidence: null, humanEvidence: null },
    independence: {
      sponsorController: 'sponsor',
      operator: { actorId: 'worker', controllerId: 'sponsor', keyId: 'key-1' },
      custodian: { actorId: 'custodian', controllerId: 'sponsor', keyId: 'key-2' },
      adjudicator: { actorId: 'judge', controllerId: 'sponsor', keyId: 'key-3' },
      isolationEvidence: null, controllerEvidence: null
    },
    gates: { preRun: { package: ref, corpusSeal: ref }, postRun: { adjudication: null, telemetry: null } }
  };
}

test('test_prf_benchmark_v2_contract_1', () => {
  const bytes = readFileSync(new URL('../../scripts/fixtures/atm-external-benchmark/manifest.json', import.meta.url));
  const digest = 'sha256:a27ad8676c3a051933aae7e365ce32b569123a37299bd74d19fb447808b71da9';
  assert.equal(assertSealedBytes(bytes, digest), digest);
  assert.throws(() => assertSealedBytes(Buffer.concat([bytes, Buffer.from('\n')]), digest), /seal/i);
  assert.deepEqual(parseBenchmarkV2(fixture()), fixture());
  for (const value of ['1.0.0', '2.1.0', '3.0.0']) assert.throws(() => parseBenchmarkV2({ ...fixture(), protocolVersion: value }));
  for (const field of Object.keys(fixture())) {
    const incomplete: Record<string, unknown> = fixture() as unknown as Record<string, unknown>;
    delete incomplete[field]; assert.throws(() => parseBenchmarkV2(incomplete), field);
  }
  assert.throws(() => parseBenchmarkV2(JSON.parse(bytes.toString('utf8'))));
});

test('test_prf_benchmark_v2_contract_2', () => {
  const run = fixture();
  assert.equal(parseBenchmarkV2(run).cost.billedCost, null);
  const wrong = fixture(); wrong.operations[0].denominator = 'false-block';
  assert.throws(() => parseBenchmarkV2(wrong), /denominator/i);
  for (const truth of ['benign', 'conflict', 'unknown'] as const) {
    for (const decision of ['allowed', 'blocked', 'unknown'] as const) {
      run.operations[0] = { operationId: 'op-1', truth, decision, denominator: truth === 'unknown' || decision === 'unknown' ? 'unavailable' : truth === 'benign' ? 'false-block' : 'missed-conflict' };
      assert.equal(parseBenchmarkV2(run).operations[0].truth, truth);
    }
  }
  run.operations.push({ ...run.operations[0] });
  assert.throws(() => parseBenchmarkV2(run), /duplicate/i);
  for (const value of [-1, Infinity, '0']) assert.throws(() => parseBenchmarkV2({ ...fixture(), cost: { ...fixture().cost, billedCost: value } }));
  const zero = fixture(); zero.cost.billedCost = 0;
  assert.throws(() => parseBenchmarkV2(zero), /billing/i);
  zero.cost.billingEvidence = ref; assert.equal(parseBenchmarkV2(zero).cost.billedCost, 0);
});

test('test_prf_benchmark_v2_contract_3', () => {
  const run = fixture();
  // Fixture verifier is not external evidence; production callers must resolve refs.
  const verified = () => true;
  assert.equal(assessIndependence(run, verified), 'internal-cross-check');
  run.independence.isolationEvidence = ref;
  assert.equal(assessIndependence(run), 'internal-cross-check');
  assert.equal(assessIndependence(run, verified), 'isolated-internal');
  run.independence.controllerEvidence = ref;
  assert.equal(assessIndependence(run, verified), 'isolated-internal');
  run.independence.operator.controllerId = 'outside-operator';
  assert.equal(assessIndependence(run, verified), 'external-operator');
  run.independence.custodian.controllerId = 'outside-custodian';
  run.independence.adjudicator.controllerId = 'outside-judge';
  assert.equal(assessIndependence(run, verified), 'external-custody-adjudication');
  run.independence.adjudicator.controllerId = 'outside-custodian';
  assert.equal(assessIndependence(run, verified), 'external-operator');
  assert.deepEqual(assessGates(run), { preRunReady: false, postRunReady: false });
  assert.deepEqual(assessGates(run, verified), { preRunReady: true, postRunReady: false });
  run.gates.postRun = { adjudication: ref, telemetry: ref };
  assert.deepEqual(assessGates(run, verified), { preRunReady: true, postRunReady: true });
  run.gates.preRun.corpusSeal = null;
  assert.deepEqual(assessGates(run, verified), { preRunReady: false, postRunReady: false });
});
