import assert from 'node:assert/strict';
import { observeRegressionFamily, projectRegressionFamilyCatalog } from '../../packages/core/src/evidence/regression-family.ts';
const input = { incidentRef: 'incident-1', fingerprint: 'fp-a', rootMechanism: 'mechanism-a', causalNeighborhood: ['factor-a'], factorConstraints: ['factor-b'], generatedCaseIds: ['case-a'], requiredCaseIds: ['case-a'], confidence: 0.8, impactSignals: ['validator-a'] };
const first = observeRegressionFamily(input); const second = observeRegressionFamily({ ...input, incidentRef: 'incident-2', causalNeighborhood: ['factor-c'], generatedCaseIds: ['case-b'], existingRevisions: first.revisions });
assert.equal(second.revision?.family.causalNeighborhood.includes('factor-c'), true); assert.equal(second.revision?.family.causalNeighborhood.includes('factor-b'), true);
const catalog = projectRegressionFamilyCatalog({ revisions: second.revisions, selection: { impactCone: { publicSeams: [], causalImpactEdges: [], changedFiles: [], validatorReferences: ['validator-a'], testCaseIds: [] } } }); assert.equal(catalog.status, 'proven'); assert.equal(catalog.revisions.length, 2); assert.match(catalog.selectionDigest, /^sha256:/); assert.match(catalog.familyRevisionDigest, /^sha256:/);
console.log('plan4 regression family recurrence: ok');
