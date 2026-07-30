import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildValidatorGovernanceVerdict } from '../../scripts/validate-validator-governance-verdict.ts';

const fixture = JSON.parse(readFileSync('tests/fixtures/validator-governance-replay/historical-ab-candidates.json', 'utf8'));
const artifact = JSON.parse(readFileSync('artifacts/generated/atm-validator-governance-verdict.json', 'utf8'));
const computed = buildValidatorGovernanceVerdict(fixture);

assert.deepEqual(artifact, computed);
assert.equal(artifact.verdict.status, 'pass');
assert(artifact.deltas.latencyP50ImprovementRatio > 0.5, 'causal selector must materially improve median latency');
assert(artifact.deltas.latencyP95ImprovementRatio > 0.5, 'causal selector must materially improve p95 latency');
assert(artifact.deltas.escapedDefectDelta <= 0, 'runtime improvement cannot pass if defect detection regresses');
assert(artifact.deltas.selectedRatioDelta < 0, 'causal selector should execute a smaller sound set than legacy all-run');
assert(artifact.deltas.cacheReuseRatioDelta > 0, 'causal selector should increase cache reuse');
assert(artifact.deltas.phaseDetectionRatioDelta > 0, 'phase-suite ownership should improve phase detection');
assert(artifact.counterexamples.some((entry: any) => entry.id === 'zero-test-false-green' && entry.acceptedByVerdict === false));
assert(artifact.counterexamples.some((entry: any) => entry.id === 'stale-receipt-reuse' && entry.acceptedByVerdict === false));
assert.deepEqual(artifact.adapterConformance.map((entry: any) => entry.adapter).sort(), [
  'antigravity',
  'claude-code',
  'codex',
  'copilot',
  'cursor',
  'gemini'
]);

console.log(JSON.stringify({
  marker: '[validator-governance-verdict.test] ok',
  status: artifact.verdict.status,
  recommendation: artifact.verdict.migrationRecommendation
}));
