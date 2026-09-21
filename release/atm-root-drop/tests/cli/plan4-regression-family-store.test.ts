import assert from 'node:assert/strict';
import { observeRegressionFamily, validateRegressionFamilyRevision } from '../../packages/core/src/evidence/regression-family.ts';
const input = { incidentRef: 'incident-1', fingerprint: 'fp-a', rootMechanism: 'missing-authority', causalNeighborhood: ['seam-a'], factorConstraints: ['factor-x'], generatedCaseIds: ['case-a', 'case-b'], requiredCaseIds: ['case-a'], confidence: 0.9, impactSignals: ['packages/core/src/evidence/index.ts'] };
const first = observeRegressionFamily(input); assert.equal(first.status, 'proven'); assert.equal(first.revisions.length, 1); assert.equal(validateRegressionFamilyRevision(first).ok, true);
const second = observeRegressionFamily({ ...input, incidentRef: 'incident-2', existingRevisions: first.revisions }); assert.equal(second.status, 'proven'); assert.equal(second.revision?.recurrence, true); assert.equal(second.revisions.length, 2); assert.equal(second.revision?.parentRevision, first.revision?.revisionId); assert.deepEqual(second.revision?.family.generatedCaseIds, ['case-a', 'case-b']);
console.log('plan4 regression family store: ok');
