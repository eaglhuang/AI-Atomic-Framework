import assert from 'node:assert/strict';
import { compilePerformanceResilienceRatchet, validatePerformanceResilienceRatchet } from '../../packages/core/src/evidence/performance-resilience-ratchet.ts';
const authority = { authorityId: 'bench-1', digest: 'sha256:authority', sealed: true as const };
const result = compilePerformanceResilienceRatchet({ ratchetId: 'ratchet-negative', generatedAt: '2026-08-09T00:00:00Z', authority, observedAuthorityDigest: 'sha256:stale', baselines: [{ benchmarkId: 'admission', latencyMs: 10, memoryBytes: 100, successRate: 0.99, resilienceRate: 0.99, digest: 'sha256:b' }], observations: [{ benchmarkId: 'admission', latencyMs: 30, memoryBytes: 200, successRate: 0.5, resilienceRate: 0.5, digest: 'sha256:o' }], limits: { maxLatencyRegressionMs: 2, maxMemoryRegressionBytes: 10, minSuccessRate: 0.95, minResilienceRate: 0.95 } });
assert.equal(result.status, 'stale'); assert.equal(result.repairCommand !== null, true); assert.equal(validatePerformanceResilienceRatchet(result).ok, false); assert.ok(result.diagnostics.includes('ratchet-regression'));
console.log('plan4 performance resilience ratchet negative: ok');
