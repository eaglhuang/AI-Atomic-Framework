import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBroker } from '../../../../cli/src/commands/broker.ts';
import { planMutationBatch, buildDeterministicPlanId } from '../adapters/batch-planner.ts';
import { computeCasResult, hashContent } from '../adapters/cas.ts';
import { defaultAdapterRegistry } from '../adapters/registry.ts';
import { brokerAdapterMigration, type MutationRequest } from '../types.ts';

function makeRequest(overrides: Partial<MutationRequest> & Pick<MutationRequest, 'requestId' | 'filePath' | 'op' | 'target'>): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    actorId: 'actor-a',
    value: undefined,
    ...overrides
  };
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function testDeterministicPlan() {
  const registry = defaultAdapterRegistry();
  const requests = [
    makeRequest({ requestId: 'r2', filePath: 'data.json', op: 'upsert', target: '/b', value: 2 }),
    makeRequest({ requestId: 'r1', filePath: 'data.json', op: 'upsert', target: '/a', value: 1 })
  ];
  const contents = { 'data.json': '{"a":0,"b":0}' };
  const plan1 = planMutationBatch({ registry, requests, fileContents: contents });
  const plan2 = planMutationBatch({ registry, requests: [...requests].reverse(), fileContents: contents });
  assert.equal(plan1.planId, plan2.planId);
  assert.equal(plan1.batches.length, 1);
  assert.equal(plan1.batches[0].verdict, 'mergeable');
  assert.deepEqual([...plan1.batches[0].requestIds].sort(), ['r1', 'r2']);
  assert.equal(plan1.planId, buildDeterministicPlanId(['r1', 'r2']));
  console.log('ok: deterministic plan id, different JSON rows => one mergeable batch');
}

function testSameRowQueued() {
  const registry = defaultAdapterRegistry();
  const requests = [
    makeRequest({ requestId: 'r1', filePath: 'data.json', op: 'upsert', target: '/a', value: 1 }),
    makeRequest({ requestId: 'r2', filePath: 'data.json', op: 'upsert', target: '/a', value: 2 })
  ];
  const plan = planMutationBatch({ registry, requests, fileContents: { 'data.json': '{"a":0}' } });
  assert.equal(plan.batches.length, 1);
  assert.equal(plan.batches[0].requestIds.length, 1);
  assert.equal(plan.queued.length, 1);
  console.log('ok: same pointer => one applied, the other queued');
}

function testRequestConflictKeysPreserved() {
  const registry = defaultAdapterRegistry();
  const requests = [
    makeRequest({ requestId: 'r1', filePath: 'data.json', op: 'upsert', target: '/a', value: 1 }),
    makeRequest({ requestId: 'r2', filePath: 'data.json', op: 'upsert', target: '/b', value: 2 })
  ];
  const fileContents = { 'data.json': '{"a":0,"b":0}' };
  const plan = planMutationBatch({ registry, requests, fileContents });
  assert.equal(Array.isArray(plan.requestConflictKeys), true);
  assert.equal(plan.requestConflictKeys?.length, 2);
  const requestConflictKeys = plan.requestConflictKeys ?? [];
  const requestConflictKeyMap = new Map(requestConflictKeys.map((entry) => [entry.requestId, entry.conflictKeys]));
  assert.equal(requestConflictKeyMap.get('r1')?.length, 1);
  assert.equal(requestConflictKeyMap.get('r2')?.length, 1);
  const r1Key = requestConflictKeyMap.get('r1')?.[0]?.key;
  const r2Key = requestConflictKeyMap.get('r2')?.[0]?.key;
  assert.notEqual(r1Key, r2Key);
  assert.ok((plan.batches[0]?.conflictKeys ?? []).length >= 2);
  console.log('ok: request-level conflict keys are preserved for each request');
}

function testCasPreventsLostUpdate() {
  const baseContents = '{"a":0}';
  const baseHash = hashContent(baseContents);
  // File changed under the planner.
  const cas = computeCasResult({ filePath: 'data.json', expectedBaseHash: baseHash, currentFileContents: '{"a":99}' });
  assert.equal(cas.ok, false);
  assert.equal(cas.mismatch, true);
  assert.notEqual(cas.actualBaseHash, baseHash);
  // Unchanged file passes CAS.
  const ok = computeCasResult({ filePath: 'data.json', expectedBaseHash: baseHash, currentFileContents: baseContents });
  assert.equal(ok.ok, true);
  console.log('ok: CAS mismatch blocks a stale write (lost-update prevented)');
}

function testUnknownFormatFailsClosed() {
  const registry = defaultAdapterRegistry();
  const requests = [
    makeRequest({ requestId: 'r1', filePath: 'notes.bin', op: 'write', target: 'whole', value: 'x' }),
    makeRequest({ requestId: 'r2', filePath: 'notes.bin', op: 'write', target: 'whole', value: 'y' })
  ];
  const plan = planMutationBatch({ registry, requests, fileContents: { 'notes.bin': 'opaque' } });
  // Fallback adapter: at most one request can be in a batch; the rest queued.
  assert.equal(plan.batches[0].adapterId, 'fallback-file-lock');
  assert.equal(plan.batches[0].requestIds.length, 1);
  assert.equal(plan.queued.length, 1);
  console.log('ok: unknown format => fallback fail-closed (only one batched, rest queued)');
}

async function testBrokerPlanBatchReturnsMissingInputs() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-intent-'));
  try {
    const validRequestPath = path.join(tempDir, 'valid-request.json');
    writeJson(validRequestPath, makeRequest({
      requestId: 'req-valid',
      filePath: 'data.json',
      op: 'upsert',
      target: '/owner/name',
      value: 'atm'
    }));

    const validResult = await runBroker([
      'plan-batch',
      '--cwd', tempDir,
      '--request-file', validRequestPath
    ]);
    const validEvidence = validResult.evidence as {
      explicitInputs?: Array<{ kind?: string }>;
      missingInputs?: unknown[];
    };
    assert.equal(validResult.ok, true);
    assert.deepEqual(validEvidence.missingInputs, []);
    assert.equal(validEvidence.explicitInputs?.[0]?.kind, 'json-pointer');

    const missingTargetPath = path.join(tempDir, 'missing-target.json');
    writeJson(missingTargetPath, {
      ...makeRequest({
        requestId: 'req-missing-target',
        filePath: 'notes.md',
        op: 'replaceRange',
        target: '',
        value: 'replacement'
      }),
      target: ''
    });

    const missingTargetResult = await runBroker([
      'plan-batch',
      '--cwd', tempDir,
      '--request-file', missingTargetPath
    ]);
    const missingTargetEvidence = missingTargetResult.evidence as {
      explicitInputs?: unknown[];
      missingInputs?: Array<{ field?: string }>;
    };
    assert.equal(missingTargetResult.ok, false);
    assert.equal(missingTargetResult.messages[0]?.code, 'ATM_BROKER_MUTATION_INTENT_MISSING_INPUTS');
    assert.equal(missingTargetEvidence.missingInputs?.length, 1);
    assert.equal(missingTargetEvidence.missingInputs?.[0]?.field, 'target');
    assert.deepEqual(missingTargetEvidence.explicitInputs, []);
    console.log('ok: incomplete structured mutation intent returns missingInputs without guessing');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

testDeterministicPlan();
testSameRowQueued();
testRequestConflictKeysPreserved();
testCasPreventsLostUpdate();
testUnknownFormatFailsClosed();
await testBrokerPlanBatchReturnsMissingInputs();

console.log('all batch-planner tests passed');
