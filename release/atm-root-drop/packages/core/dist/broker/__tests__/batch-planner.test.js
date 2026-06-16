import assert from 'node:assert/strict';
import { planMutationBatch, buildDeterministicPlanId } from '../adapters/batch-planner.js';
import { computeCasResult, hashContent } from '../adapters/cas.js';
import { defaultAdapterRegistry } from '../adapters/registry.js';
import { brokerAdapterMigration } from '../types.js';
function makeRequest(overrides) {
    return {
        schemaId: 'atm.mutationRequest.v1',
        specVersion: '0.1.0',
        migration: brokerAdapterMigration(),
        actorId: 'actor-a',
        value: undefined,
        ...overrides
    };
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
testDeterministicPlan();
testSameRowQueued();
testCasPreventsLostUpdate();
testUnknownFormatFailsClosed();
console.log('all batch-planner tests passed');
