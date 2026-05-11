import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('./map.spec.json', import.meta.url), 'utf8'));
assert.equal(spec.schemaId, "atm.atomicMap");
assert.equal(spec.mapId, "ATM-MAP-0003");
assert.equal(spec.mapHash, "sha256:8ce344177a19451fc354776028dc49c1173b9ebb3a3a1181ddc27db81c95faa5");
assert.equal(spec.semanticFingerprint, "sf:sha256:a71b67b0d35a35d395c725f9424f3551715f998bf2421efd05ef1317ef9a3ff9");
assert.deepEqual(spec.entrypoints, ["ATM-CORE-0005"]);
assert.deepEqual(spec.members, [{"atomId":"ATM-CORE-0005","version":"0.1.0"},{"atomId":"ATM-CORE-0006","version":"0.1.0"},{"atomId":"ATM-CORE-0007","version":"0.1.0"}]);
assert.deepEqual(spec.edges, [{"from":"ATM-CORE-0005","to":"ATM-CORE-0006","binding":"normalizes-length"},{"from":"ATM-CORE-0006","to":"ATM-CORE-0007","binding":"feeds-fragments"}]);
assert.deepEqual(spec.qualityTargets, {"pilotName":"h2u-map-evolution","promoteGateRequired":true,"requiredChecks":3});
console.log("ATM-MAP-0003 map integration self-check ok");
