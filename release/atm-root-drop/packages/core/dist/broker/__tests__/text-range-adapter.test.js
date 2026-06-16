import assert from 'node:assert/strict';
import { textRangeAdapter } from '../adapters/text-range.js';
import { brokerAdapterMigration } from '../types.js';
function makeFile(content, filePath = 'notes.md') {
    return { filePath, content };
}
function makeRequest(overrides) {
    return {
        schemaId: 'atm.mutationRequest.v1',
        specVersion: '0.1.0',
        migration: brokerAdapterMigration(),
        requestId: 'req-1',
        actorId: 'actor-a',
        filePath: 'notes.md',
        value: undefined,
        ...overrides
    };
}
function lines(content) {
    return content.split('\n');
}
const DOC = ['# Title', 'alpha', 'beta', 'gamma', '## Section', 'delta'].join('\n');
function testNonOverlappingMergeable() {
    const parsed = textRangeAdapter.parse(makeFile(DOC));
    const m1 = textRangeAdapter.normalize(makeRequest({ requestId: 'r1', op: 'replaceRange', target: '2:2', value: 'ALPHA' }));
    const m2 = textRangeAdapter.normalize(makeRequest({ requestId: 'r2', op: 'replaceRange', target: '4:4', value: 'GAMMA' }));
    const decision = textRangeAdapter.canMerge([m1, m2], parsed);
    assert.equal(decision.verdict, 'mergeable');
    const merged = textRangeAdapter.merge([m1, m2], parsed);
    const out = lines(textRangeAdapter.serialize(merged));
    assert.equal(out[1], 'ALPHA');
    assert.equal(out[3], 'GAMMA');
    console.log('ok: non-overlapping ranges mergeable');
}
function testOverlappingConflict() {
    const parsed = textRangeAdapter.parse(makeFile(DOC));
    const m1 = textRangeAdapter.normalize(makeRequest({ requestId: 'r1', op: 'replaceRange', target: '2:4', value: 'X' }));
    const m2 = textRangeAdapter.normalize(makeRequest({ requestId: 'r2', op: 'replaceRange', target: '3:5', value: 'Y' }));
    const decision = textRangeAdapter.canMerge([m1, m2], parsed);
    assert.equal(decision.verdict, 'conflict');
    assert.ok(decision.conflictKeys.length > 0);
    assert.throws(() => textRangeAdapter.merge([m1, m2], parsed));
    console.log('ok: overlapping ranges conflict');
}
function testConcurrentAppendsConflict() {
    const parsed = textRangeAdapter.parse(makeFile(DOC));
    const a1 = textRangeAdapter.normalize(makeRequest({ requestId: 'r1', op: 'append', target: '', value: 'tail-1' }));
    const a2 = textRangeAdapter.normalize(makeRequest({ requestId: 'r2', op: 'append', target: '', value: 'tail-2' }));
    const decision = textRangeAdapter.canMerge([a1, a2], parsed);
    assert.equal(decision.verdict, 'conflict');
    console.log('ok: two concurrent appends to EOF conflict conservatively');
}
function testRoundTrip() {
    const parsed = textRangeAdapter.parse(makeFile(DOC));
    const append = textRangeAdapter.normalize(makeRequest({ requestId: 'r1', op: 'append', target: '', value: 'epsilon' }));
    const merged1 = textRangeAdapter.merge([append], parsed);
    assert.equal(lines(textRangeAdapter.serialize(merged1)).at(-1), 'epsilon');
    const insert = textRangeAdapter.normalize(makeRequest({ requestId: 'r2', op: 'insertAfterHeading', target: '## Section', value: 'inserted' }));
    const merged2 = textRangeAdapter.merge([insert], parsed);
    const out2 = lines(textRangeAdapter.serialize(merged2));
    const headingIndex = out2.indexOf('## Section');
    assert.equal(out2[headingIndex + 1], 'inserted');
    const replace = textRangeAdapter.normalize(makeRequest({ requestId: 'r3', op: 'replaceRange', target: '2:2', value: 'ALPHA' }));
    const merged3 = textRangeAdapter.merge([replace], parsed);
    assert.equal(lines(textRangeAdapter.serialize(merged3))[1], 'ALPHA');
    console.log('ok: append/insertAfterHeading/replaceRange round-trip');
}
testNonOverlappingMergeable();
testOverlappingConflict();
testConcurrentAppendsConflict();
testRoundTrip();
console.log('all text-range-adapter tests passed');
