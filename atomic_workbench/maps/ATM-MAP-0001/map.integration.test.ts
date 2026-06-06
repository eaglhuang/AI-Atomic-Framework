import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('./map.spec.json', import.meta.url), 'utf8'));
assert.equal(spec.schemaId, "atm.atomicMap");
assert.equal(spec.mapId, "ATM-MAP-0001");
assert.equal(spec.mapHash, "sha256:914340fd5c8f3aa0686adbbc67093de0c49fa3b8a1383a77e11da11cc1665fe9");
assert.equal(spec.semanticFingerprint, "sha256:2f43cb71826404ba26df831b8ea5f30c46735fbdd24fd12285151bc9f8718529");
assert.deepEqual(spec.entrypoints, ["ATM-CORE-0004"]);
assert.deepEqual(spec.members, [{"atomId":"ATM-CORE-0004","version":"0.1.0"},{"atomId":"ATM-FIXTURE-0001","version":"0.1.0"}]);
assert.deepEqual(spec.edges, [{"from":"ATM-CORE-0004","to":"ATM-FIXTURE-0001","binding":"generates"}]);
assert.deepEqual(spec.qualityTargets, {"promoteGateRequired":true,"requiredChecks":2});
console.log("ATM-MAP-0001 map integration self-check ok");
