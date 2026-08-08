import assert from 'node:assert/strict';
import { observeRegressionFamily, selectRegressionFamilies } from '../../packages/core/src/evidence/regression-family.ts';
const base = { incidentRef: 'incident-1', fingerprint: 'fp-a', rootMechanism: 'mechanism-a', causalNeighborhood: ['seam-a'], factorConstraints: ['factor-x'], generatedCaseIds: ['case-a'], requiredCaseIds: ['case-a'], confidence: 0.9, impactSignals: ['seam-a'] };
const related = observeRegressionFamily(base).revision!.family; const unrelated = observeRegressionFamily({ ...base, incidentRef: 'incident-2', fingerprint: 'fp-b', rootMechanism: 'mechanism-b', impactSignals: ['seam-b'] }).revision!.family;
const result = selectRegressionFamilies({ families: [related, unrelated], knownFamilyIds: [related.familyId, unrelated.familyId], impactCone: { publicSeams: ['seam-a'], causalImpactEdges: [], changedFiles: [], validatorReferences: [], testCaseIds: [] } });
assert.equal(result.status, 'proven'); assert.deepEqual(result.selectedFamilyIds, [related.familyId]); assert.deepEqual(result.omitted, [{ familyId: unrelated.familyId, reasonCode: 'outside-impact-cone' }]);
const blocked = selectRegressionFamilies({ families: [related], knownFamilyIds: [], mappingConflicts: ['unknown-fingerprint'], impactCone: { publicSeams: [], causalImpactEdges: [], changedFiles: [], validatorReferences: [], testCaseIds: [] } }); assert.equal(blocked.status, 'blocked'); assert.equal(blocked.repairCommand !== null, true); assert.equal(blocked.selectedFamilyIds.length, 0);
console.log('plan4 regression family selector: ok');
