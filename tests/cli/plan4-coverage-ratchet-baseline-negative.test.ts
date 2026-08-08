import assert from 'node:assert/strict';
import { compileCoverageRatchetBaseline, validateCoverageRatchetBaseline } from '../../packages/core/src/evidence/coverage-ratchet-baseline.ts';
const authority = { authorityId: 'coverage-universe-1', digest: 'sha256:authority', sealed: true as const };
const result = compileCoverageRatchetBaseline({ ratchetId: 'ratchet-negative', generatedAt: '2026-08-09T00:00:00Z', authority, observedAuthorityDigest: 'sha256:stale', minimumRatio: 0.9, baselines: [
  { scope: 'repository', ratio: 0.5, covered: 1, total: 2, digest: 'sha256:repo' },
  { scope: 'changed', ratio: 0.5, covered: 1, total: 2, digest: 'sha256:changed' }
] });
assert.equal(result.status, 'stale');
assert.equal(result.diagnostics.includes('coverage-below-ratchet'), true);
assert.equal(validateCoverageRatchetBaseline(result).ok, false);
console.log('plan4 coverage ratchet baseline negative: ok');
