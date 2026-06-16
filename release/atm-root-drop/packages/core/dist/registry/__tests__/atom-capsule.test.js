import assert from 'node:assert/strict';
import { computeAtomCid, createAtomBundle, exportAtomCapsule, serializeAtomBundle, verifyPayloadHash } from '../atom-capsule.js';
function testBundleConstructionAndSerialization() {
    const bundle = createAtomBundle('console.log("hello");');
    assert.deepEqual(bundle, {
        canonicalSourceCode: 'console.log("hello");',
        inputSchema: null,
        outputSchema: null,
        policeConfig: null
    });
    assert.equal(serializeAtomBundle(bundle), JSON.stringify({
        canonicalSourceCode: 'console.log("hello");',
        inputSchema: null,
        outputSchema: null,
        policeConfig: null
    }));
    const overridden = createAtomBundle('console.log("hello");', {
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        policeConfig: { mode: 'strict' }
    });
    assert.deepEqual(overridden.inputSchema, { type: 'object' });
    assert.deepEqual(overridden.outputSchema, { type: 'object' });
    assert.deepEqual(overridden.policeConfig, { mode: 'strict' });
    console.log('ok: atom bundle construction and serialization are fixed-field');
}
function testDeterministicCapsuleCid() {
    const baseBundle = createAtomBundle('console.log("hello");');
    const sameBundle = createAtomBundle('console.log("hello");');
    const changedCodeBundle = createAtomBundle('console.log("hello world");');
    const changedPolicyBundle = createAtomBundle('console.log("hello");', {
        policeConfig: { mode: 'strict' }
    });
    const cid = computeAtomCid(baseBundle);
    assert.equal(cid, computeAtomCid(sameBundle), 'same bundle must produce the same capsule CID');
    assert.notEqual(cid, computeAtomCid(changedCodeBundle));
    assert.notEqual(cid, computeAtomCid(changedPolicyBundle));
    console.log('ok: capsule CID is stable and content-sensitive');
}
function testPayloadHashVerification() {
    const capsule = exportAtomCapsule(createAtomBundle('console.log("hello");'));
    assert.ok(verifyPayloadHash(capsule.cid, capsule.compressedPayload));
    const tamperedPayload = capsule.compressedPayload.replace(/[A-Za-z0-9]/, (char) => (char === 'A' ? 'B' : 'A'));
    assert.equal(verifyPayloadHash(capsule.cid, tamperedPayload), false);
    console.log('ok: tampered capsule payload fails hash verification');
}
testBundleConstructionAndSerialization();
testDeterministicCapsuleCid();
testPayloadHashVerification();
console.log('all atom-capsule tests passed');
