import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planMutationBatch } from '../adapters/batch-planner.js';
import { defaultAdapterRegistry } from '../adapters/registry.js';
import { brokerAdapterMigration } from '../types.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const brokerDir = path.resolve(here, '..');
const fixtureDir = path.join(here, 'fixtures');
const SHARD_PATH = 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-fixture.json';
function makeRequest(o) {
    return {
        schemaId: 'atm.mutationRequest.v1',
        specVersion: '0.1.0',
        migration: brokerAdapterMigration(),
        actorId: 'actor-a',
        value: undefined,
        ...o
    };
}
const registry = defaultAdapterRegistry();
const shardContents = readFileSync(path.join(fixtureDir, 'owner-shard-fixture.json'), 'utf8');
// Scenario 1: same-file different JSON rows -> one batch, mergeable.
function scenarioDifferentJsonRows() {
    const requests = [
        makeRequest({ requestId: 'r1', filePath: SHARD_PATH, op: 'replace', target: 'src/alpha.ts::ATOM-ALPHA', value: { path_pattern: 'src/alpha.ts', atom_id: 'ATOM-ALPHA', capability: 'cap-alpha2', coverage_status: 'covered' } }),
        makeRequest({ requestId: 'r2', filePath: SHARD_PATH, op: 'replace', target: 'src/beta.ts::ATOM-BETA', value: { path_pattern: 'src/beta.ts', atom_id: 'ATOM-BETA', capability: 'cap-beta2', coverage_status: 'covered' } })
    ];
    const plan = planMutationBatch({ registry, requests, fileContents: { [SHARD_PATH]: shardContents } });
    assert.equal(plan.batches.length, 1);
    assert.equal(plan.batches[0].adapterId, 'path-to-atom-map');
    assert.equal(plan.batches[0].verdict, 'mergeable');
    assert.equal(plan.queued.length, 0);
    return { name: 'same-file different JSON rows', expected: 'one mergeable batch', actual: `1 batch verdict=${plan.batches[0].verdict}`, pass: true };
}
// Scenario 2: same-row conflict -> queued/blocked.
function scenarioSameRowConflict() {
    const requests = [
        makeRequest({ requestId: 'r1', filePath: SHARD_PATH, op: 'replace', target: 'src/alpha.ts::ATOM-ALPHA', value: { path_pattern: 'src/alpha.ts', atom_id: 'ATOM-ALPHA', capability: 'x', coverage_status: 'covered' } }),
        makeRequest({ requestId: 'r2', filePath: SHARD_PATH, op: 'replace', target: 'src/alpha.ts::ATOM-ALPHA', value: { path_pattern: 'src/alpha.ts', atom_id: 'ATOM-ALPHA', capability: 'y', coverage_status: 'covered' } })
    ];
    const plan = planMutationBatch({ registry, requests, fileContents: { [SHARD_PATH]: shardContents } });
    assert.equal(plan.batches[0].requestIds.length, 1);
    assert.equal(plan.queued.length, 1);
    return { name: 'same-row conflict', expected: 'one applied, one queued', actual: `batched=1 queued=${plan.queued.length}`, pass: true };
}
// Scenario 3: text range overlap -> conflict.
function scenarioTextRangeOverlap() {
    const requests = [
        makeRequest({ requestId: 'r1', filePath: 'doc.md', op: 'replaceRange', target: '2:4', value: 'A' }),
        makeRequest({ requestId: 'r2', filePath: 'doc.md', op: 'replaceRange', target: '3:5', value: 'B' })
    ];
    const plan = planMutationBatch({ registry, requests, fileContents: { 'doc.md': 'l1\nl2\nl3\nl4\nl5\nl6' } });
    assert.equal(plan.batches[0].adapterId, 'text-range');
    assert.equal(plan.batches[0].requestIds.length, 1);
    assert.equal(plan.queued.length, 1);
    return { name: 'text range overlap', expected: 'overlap conflict => one queued', actual: `batched=1 queued=${plan.queued.length}`, pass: true };
}
// Scenario 4: numeric increment -> commutative-merge.
function scenarioNumericIncrement() {
    const requests = [
        makeRequest({ requestId: 'r1', filePath: 'counters.scalars.json', op: 'increment', target: 'hits', value: 3 }),
        makeRequest({ requestId: 'r2', filePath: 'counters.scalars.json', op: 'increment', target: 'hits', value: 4 })
    ];
    const plan = planMutationBatch({ registry, requests, fileContents: { 'counters.scalars.json': '{"hits":0}' } });
    assert.equal(plan.batches[0].adapterId, 'numeric-scalar');
    assert.equal(plan.batches[0].verdict, 'commutative-merge');
    assert.equal(plan.batches[0].requestIds.length, 2);
    return { name: 'numeric increment', expected: 'commutative-merge (summed)', actual: `verdict=${plan.batches[0].verdict}`, pass: true };
}
// Scenario 5: unknown format -> fallback adapter fail-closed.
function scenarioUnknownFormat() {
    const requests = [
        makeRequest({ requestId: 'r1', filePath: 'blob.bin', op: 'write', target: 'all', value: 'x' }),
        makeRequest({ requestId: 'r2', filePath: 'blob.bin', op: 'write', target: 'all', value: 'y' })
    ];
    const plan = planMutationBatch({ registry, requests, fileContents: { 'blob.bin': 'opaque' } });
    assert.equal(plan.batches[0].adapterId, 'fallback-file-lock');
    assert.equal(plan.batches[0].requestIds.length, 1);
    assert.equal(plan.queued.length, 1);
    return { name: 'unknown format', expected: 'fallback fail-closed', actual: `adapter=${plan.batches[0].adapterId} queued=${plan.queued.length}`, pass: true };
}
// Architecture invariant: broker core stays format-agnostic. compose.ts /
// decision.ts / conflict-matrix.ts must contain ZERO references to the format
// adapters introduced in Phase B/C.
function scenarioCoreStaysFormatAgnostic() {
    const bannedTokens = ['adapters/', 'pathToAtomMapAdapter', 'jsonRecordAdapter', 'textRangeAdapter', 'numericScalarAdapter', 'planMutationBatch', 'computeCasResult'];
    for (const file of ['compose.ts', 'decision.ts', 'conflict-matrix.ts']) {
        const contents = readFileSync(path.join(brokerDir, file), 'utf8');
        for (const token of bannedTokens) {
            assert.equal(contents.includes(token), false, `${file} must not reference format-adapter token '${token}'`);
        }
    }
    return { name: 'core stays format-agnostic', expected: 'no adapter refs in compose/decision/conflict-matrix', actual: 'verified clean', pass: true };
}
const rows = [
    scenarioDifferentJsonRows(),
    scenarioSameRowConflict(),
    scenarioTextRangeOverlap(),
    scenarioNumericIncrement(),
    scenarioUnknownFormat(),
    scenarioCoreStaysFormatAgnostic()
];
for (const row of rows) {
    console.log(`ok: ${row.name} -> ${row.actual}`);
}
assert.ok(rows.every((row) => row.pass));
console.log('all dogfood-adapter-benchmark scenarios passed');
