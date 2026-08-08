import assert from 'node:assert/strict';
import { compileEvidenceFreshnessCertificate, validateEvidenceFreshnessCertificate } from '../../packages/core/src/evidence/evidence-freshness-certificate.ts';
const input = { certificateId: 'cert-1', authorityDigest: 'sha256:authority', expectedWatermark: 'wm-1', expectedCacheDigest: 'sha256:cache', expectedResumeCursor: 'cursor-1', observedWatermark: 'wm-1', observedCacheDigest: 'sha256:cache', observedResumeCursor: 'cursor-1', observations: [{ observationId: 'o-1', digest: 'sha256:o1', sealed: true as const }, { observationId: 'o-1', digest: 'sha256:o1', sealed: true as const }], knownObservationIds: ['o-1'] };
const result = compileEvidenceFreshnessCertificate(input); assert.equal(result.status, 'proven'); assert.deepEqual(result.acceptedObservationIds, ['o-1']); assert.deepEqual(result.duplicateObservationIds, ['o-1']); assert.equal(validateEvidenceFreshnessCertificate(result).ok, true);
console.log('plan4 evidence freshness: ok');
