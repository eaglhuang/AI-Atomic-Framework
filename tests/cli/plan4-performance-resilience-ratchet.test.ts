import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compilePerformanceResilienceRatchet, replayPerformanceResilienceRatchet, validatePerformanceResilienceRatchet } from '../../packages/core/src/evidence/performance-resilience-ratchet.ts';
const authority = { authorityId: 'bench-1', digest: 'sha256:authority', sealed: true as const }, benchmark = { benchmarkId: 'admission', latencyMs: 10, memoryBytes: 100, successRate: 0.99, resilienceRate: 0.98, digest: 'sha256:benchmark' };
const result = compilePerformanceResilienceRatchet({ ratchetId: 'ratchet-1', generatedAt: '2026-08-09T00:00:00Z', authority, observedAuthorityDigest: authority.digest, baselines: [benchmark], observations: [{ ...benchmark, latencyMs: 11, memoryBytes: 105 }], limits: { maxLatencyRegressionMs: 2, maxMemoryRegressionBytes: 10, minSuccessRate: 0.95, minResilienceRate: 0.95 }, provenance: { producer: 'focused-test' } });
const schema = JSON.parse(readFileSync(new URL('../../schemas/evidence/performance-resilience-ratchet.schema.json', import.meta.url), 'utf8')), validateSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
assert.equal(result.status, 'proven'); assert.equal(validateSchema(result), true, JSON.stringify(validateSchema.errors)); assert.deepEqual(replayPerformanceResilienceRatchet(result), result); assert.deepEqual(validatePerformanceResilienceRatchet(result), { ok: true, diagnostics: [] }); assert.deepEqual(validatePerformanceResilienceRatchet({ ...result, projection: { ...result.projection, benchmarkCount: 99 } }), { ok: false, diagnostics: ['result-digest-mismatch'] });
console.log('plan4 performance resilience ratchet: ok');
