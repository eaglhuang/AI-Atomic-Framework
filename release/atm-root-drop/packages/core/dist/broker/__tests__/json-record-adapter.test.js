import assert from 'node:assert/strict';
import { jsonRecordAdapter } from '../adapters/json-record.js';
import { brokerAdapterMigration } from '../types.js';
function makeFile(content, filePath = 'data.json') {
    return { filePath, content };
}
function makeRequest(overrides) {
    return {
        schemaId: 'atm.mutationRequest.v1',
        specVersion: '0.1.0',
        migration: brokerAdapterMigration(),
        requestId: 'req-1',
        actorId: 'actor-a',
        filePath: 'data.json',
        value: undefined,
        ...overrides
    };
}
function testDifferentPointersMergeable() {
    const file = makeFile('{"a": 1, "b": 2}');
    const parsed = jsonRecordAdapter.parse(file);
    const m1 = jsonRecordAdapter.normalize(makeRequest({ requestId: 'r1', op: 'upsert', target: '/a', value: 10 }));
    const m2 = jsonRecordAdapter.normalize(makeRequest({ requestId: 'r2', op: 'upsert', target: '/b', value: 20 }));
    const decision = jsonRecordAdapter.canMerge([m1, m2], parsed);
    assert.equal(decision.verdict, 'mergeable');
    const merged = jsonRecordAdapter.merge([m1, m2], parsed);
    assert.deepEqual(merged.value, { a: 10, b: 20 });
    console.log('ok: different pointers => mergeable batch');
}
function testSamePointerConflict() {
    const file = makeFile('{"a": 1}');
    const parsed = jsonRecordAdapter.parse(file);
    const m1 = jsonRecordAdapter.normalize(makeRequest({ requestId: 'r1', op: 'upsert', target: '/a', value: 10 }));
    const m2 = jsonRecordAdapter.normalize(makeRequest({ requestId: 'r2', op: 'upsert', target: '/a', value: 20 }));
    const decision = jsonRecordAdapter.canMerge([m1, m2], parsed);
    assert.equal(decision.verdict, 'conflict');
    assert.ok(decision.conflictKeys.length > 0);
    assert.throws(() => jsonRecordAdapter.merge([m1, m2], parsed));
    console.log('ok: same pointer => conflict and merge throws');
}
function testInvalidJsonValidationFails() {
    const valid = jsonRecordAdapter.validate(makeFile('{"a": 1}'));
    assert.equal(valid.ok, true);
    const invalid = jsonRecordAdapter.validate(makeFile('{not json'));
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.length > 0);
    console.log('ok: invalid JSON => validate fails / write blocked');
}
function testOpsRoundTrip() {
    const file = makeFile('{"keep": 1, "replaceMe": "old"}');
    const parsed = jsonRecordAdapter.parse(file);
    const upsert = jsonRecordAdapter.normalize(makeRequest({ requestId: 'r1', op: 'upsert', target: '/added', value: 'new' }));
    const addIfAbsentNew = jsonRecordAdapter.normalize(makeRequest({ requestId: 'r2', op: 'add-if-absent', target: '/fresh', value: 5 }));
    const replace = jsonRecordAdapter.normalize(makeRequest({ requestId: 'r3', op: 'replace', target: '/replaceMe', value: 'updated' }));
    const merged = jsonRecordAdapter.merge([upsert, addIfAbsentNew, replace], parsed);
    assert.deepEqual(merged.value, { keep: 1, replaceMe: 'updated', added: 'new', fresh: 5 });
    // add-if-absent on an existing key is a no-op.
    const addExisting = jsonRecordAdapter.normalize(makeRequest({ requestId: 'r4', op: 'add-if-absent', target: '/keep', value: 999 }));
    const merged2 = jsonRecordAdapter.merge([addExisting], parsed);
    assert.deepEqual(merged2.value.keep, 1);
    // Round-trip via serialize -> parse.
    const reparsed = jsonRecordAdapter.parse(makeFile(jsonRecordAdapter.serialize(merged)));
    assert.deepEqual(reparsed.value, merged.value);
    console.log('ok: upsert/add-if-absent/replace round-trip via parse->merge->serialize');
}
testDifferentPointersMergeable();
testSamePointerConflict();
testInvalidJsonValidationFails();
testOpsRoundTrip();
console.log('all json-record-adapter tests passed');
