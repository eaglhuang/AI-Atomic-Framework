import assert from 'node:assert/strict';
import { compilePerformanceResilienceRatchet, replayPerformanceResilienceRatchet, validatePerformanceResilienceRatchet } from '../../packages/core/src/evidence/performance-resilience-ratchet.ts';
const authority = { authorityId: 'bench-1', digest: 'sha256:authority', sealed: true as const };
const benchmark = { benchmarkId: 'admission', latencyMs: 10, memoryBytes: 100, successRate: 0.99, resilienceRate: 0.98, digest: 'sha256:benchmark' };
const result = compilePerformanceResilienceRatchet({ ratchetId: 'ratchet-1', generatedAt: '2026-08-09T00:00:00Z', authority, observedAuthorityDigest: authority.digest, baselines: [benchmark], observations: [{ ...benchmark, latencyMs: 11, memoryBytes: 105 }], limits: { maxLatencyRegressionMs: 2, maxMemoryRegressionBytes: 10, minSuccessRate: 0.95, minResilienceRate: 0.95 } });
assert.equal(result.status, 'proven'); assert.equal(validatePerformanceResilienceRatchet(result).ok, true); assert.deepEqual(replayPerformanceResilienceRatchet(result), result); assert.equal(result.projection.benchmarkCount, 1);
console.log('plan4 performance resilience ratchet: ok');
