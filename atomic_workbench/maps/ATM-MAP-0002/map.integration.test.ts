import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('./map.spec.json', import.meta.url), 'utf8'));
assert.equal(spec.schemaId, "atm.atomicMap");
assert.equal(spec.mapId, "ATM-MAP-0002");
assert.equal(spec.mapHash, "sha256:30d9c1ecf755089c2cf821250d59aafd6e11160c4ba3a39854bb6372a861b032");
assert.equal(spec.semanticFingerprint, "sf:sha256:cb246a3585cb9bcf9fb2369fa223784fd8b944e9ad1590d40bd7e1d30a08451d");
assert.deepEqual(spec.entrypoints, ["ATM-CORE-0003"]);
assert.deepEqual(spec.members, [{"atomId":"ATM-CORE-0003","version":"0.1.0"}]);
assert.deepEqual(spec.edges, []);
assert.deepEqual(spec.qualityTargets, {"legacyCaseCount":4,"legacyFailedCaseCount":3,"legacyMemberCount":5,"migrationBackfilled":true});
console.log("ATM-MAP-0002 map integration self-check ok");
