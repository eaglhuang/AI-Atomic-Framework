import assert from 'node:assert/strict';
import { POLICE_ROLE_IDS, POLICE_ROLE_REGISTRY, runDedupPolice, runPolymorphPolice, runQualityPolice } from '../family.js';
assert.equal(POLICE_ROLE_IDS.length, 13, 'registry must contain exactly 13 roles');
assert.deepEqual([...POLICE_ROLE_IDS], [
    'dedup',
    'demand',
    'quality',
    'map-integration',
    'atomization',
    'decomposition',
    'evolution',
    'polymorph',
    'rollback',
    'evidence-integrity',
    'reversibility',
    'noise-control',
    'adopter-neutrality'
], 'registry order must be deterministic');
assert.equal(POLICE_ROLE_REGISTRY.length, 13);
const emptyDedup = runDedupPolice({});
assert.equal(emptyDedup.findings.length, 0, 'empty dedup fixture must emit no findings');
const emptyQuality = runQualityPolice({});
assert.ok(emptyQuality.status === 'skipped' || emptyQuality.findings.length === 0);
const emptyPolymorph = runPolymorphPolice({});
assert.equal(emptyPolymorph.findings.length, 0, 'empty polymorph fixture must emit no findings');
console.log('role-registry.spec.ts: ok');
