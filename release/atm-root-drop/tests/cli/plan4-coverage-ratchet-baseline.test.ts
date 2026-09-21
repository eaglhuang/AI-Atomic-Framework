import assert from 'node:assert/strict';
import { compileCoverageRatchetBaseline, replayCoverageRatchetBaseline, validateCoverageRatchetBaseline } from '../../packages/core/src/evidence/coverage-ratchet-baseline.ts';
const authority = { authorityId: 'coverage-universe-1', digest: 'sha256:authority', sealed: true as const };
const result = compileCoverageRatchetBaseline({ ratchetId: 'ratchet-1', generatedAt: '2026-08-09T00:00:00Z', authority, observedAuthorityDigest: authority.digest, minimumRatio: 0.8, baselines: [
  { scope: 'repository', ratio: 0.9, covered: 9, total: 10, digest: 'sha256:repo' },
  { scope: 'changed', ratio: 1, covered: 2, total: 2, digest: 'sha256:changed' },
  { scope: 'impacted', ratio: 0.8, covered: 4, total: 5, digest: 'sha256:impacted' }
] });
assert.equal(result.status, 'proven');
assert.equal(validateCoverageRatchetBaseline(result).ok, true);
assert.deepEqual(replayCoverageRatchetBaseline(result), result);
assert.equal(result.projection.minimumObservedRatio, 0.8);
console.log('plan4 coverage ratchet baseline: ok');
