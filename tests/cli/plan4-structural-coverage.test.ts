import assert from 'node:assert/strict';
import { compileStructuralCoverage, replayStructuralCoverage, STRUCTURAL_COVERAGE_SCHEMA_ID, validateStructuralCoverage } from '../../packages/core/src/evidence/structural-coverage.ts';

const input = {
  coverageId: 'plan4-structural', generatedAt: '2026-08-09T00:00:00.000Z',
  model: { modelId: 'atm.plan4.model', modelDigest: 'sha256:model' },
  denominator: { sourceId: 'catalog:plan4', total: 3, digest: 'sha256:catalog' },
  obligations: [
    { obligationId: 'b', semanticFamily: 'cli', sourceRef: 'b.ts', coverage: 'covered' as const, observedDigest: 'sha256:b' },
    { obligationId: 'a', semanticFamily: 'core', sourceRef: 'a.ts', coverage: 'covered' as const, observedDigest: 'sha256:a' },
    { obligationId: 'c', semanticFamily: 'core', sourceRef: 'c.ts', coverage: 'uncovered' as const, observedDigest: 'sha256:c' }
  ]
};
const result = compileStructuralCoverage(input);
assert.equal(result.schemaId, STRUCTURAL_COVERAGE_SCHEMA_ID);
assert.equal(result.status, 'stale');
assert.deepEqual(result.projection, { total: 3, covered: 2, uncovered: 1, unsupported: 0, excluded: 0, ratio: 2 / 3 });
assert.equal(validateStructuralCoverage(result).ok, true);
assert.equal(replayStructuralCoverage(result).resultDigest, result.resultDigest);
assert.deepEqual(compileStructuralCoverage({ ...input, obligations: [...input.obligations].reverse() }).entries, result.entries);
console.log(JSON.stringify({ marker: '[plan4-structural-coverage:test] ok', resultDigest: result.resultDigest }));
