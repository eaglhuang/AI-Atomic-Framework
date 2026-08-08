import assert from 'node:assert/strict';
import { compileStructuralCoverage, validateStructuralCoverage } from '../../packages/core/src/evidence/structural-coverage.ts';

const base = {
  coverageId: 'plan4-denominator', generatedAt: '2026-08-09T00:00:00.000Z',
  model: { modelId: 'atm.plan4.model', modelDigest: 'sha256:model' },
  denominator: { sourceId: 'catalog:plan4', total: 1, digest: 'sha256:catalog' },
  obligations: [{ obligationId: 'only', semanticFamily: 'core', sourceRef: 'only.ts', coverage: 'covered' as const, observedDigest: 'sha256:only' }]
};
const ok = compileStructuralCoverage(base);
assert.equal(ok.status, 'proven');
assert.equal(validateStructuralCoverage(ok).ok, true);
const mismatch = compileStructuralCoverage({ ...base, denominator: { ...base.denominator, total: 2 } });
assert.equal(mismatch.status, 'contradictory');
assert.equal(validateStructuralCoverage(mismatch).ok, false);
assert.ok(mismatch.diagnostics.some((entry) => entry.startsWith('denominator-mismatch')));
console.log(JSON.stringify({ marker: '[plan4-denominator-reconciliation:test] ok', failClosed: true }));
