import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compareShadow, validateShadowComparison } from '../../packages/core/src/evidence/shadow-comparison.ts';

const candidate = {
  sourceDigest: digest('source'),
  runnerDigest: digest('runner'),
  catalogDigest: digest('catalog'),
  candidateDigest: digest('candidate')
};
const command = { command: 'node --strip-types tests/core/real-shadow-comparison.test.ts', runId: 'run-1', artifactPath: 'docs/reports/plan4-real-shadow-comparison.json' };
const cases = [
  { caseId: 'clean', selected: true, legacy: 'pass' as const, selectedResult: 'pass' as const, latencyMs: 4, cached: true },
  { caseId: 'skipped', selected: false, legacy: 'pass' as const, selectedResult: 'pass' as const, latencyMs: 3 },
  { caseId: 'false-block', selected: false, legacy: 'pass' as const, selectedResult: 'fail' as const, latencyMs: 2 }
];

const clean = compareShadow({
  authorityDigest: digest('authority'),
  policyEpoch: 'epoch-1',
  selectedCandidate: candidate,
  fullCandidate: candidate,
  selectedCommand: command,
  fullCommand: { ...command, runId: 'run-full' },
  cases,
  legacyLatencyMs: 9
});
assert.equal(clean.status, 'proven');
assert.equal(clean.candidate.sameCandidate, true);
assert.deepEqual(clean.selected, ['clean']);
assert.deepEqual(clean.skipped, ['false-block', 'skipped']);
assert.deepEqual(clean.falseBlocks, ['false-block']);
assert.equal(clean.cache.hits, 1);
assert.equal(validateShadowComparison(clean).ok, true);

const escaped = compareShadow({
  authorityDigest: digest('authority'),
  policyEpoch: 'epoch-1',
  selectedCandidate: candidate,
  fullCandidate: candidate,
  selectedCommand: command,
  fullCommand: { ...command, runId: 'run-full' },
  cases: [{ caseId: 'escaped', selected: false, legacy: 'fail', selectedResult: 'pass', latencyMs: 1, cached: true }]
});
assert.equal(escaped.status, 'blocked');
assert.deepEqual(escaped.escapedDefects, ['escaped']);
assert.equal(escaped.policyEpochValid, false);
assert.equal(escaped.cache.invalidated, true);
assert.equal(validateShadowComparison(escaped).ok, true);

const unknown = compareShadow({
  authorityDigest: digest('authority'),
  policyEpoch: 'epoch-1',
  selectedCandidate: candidate,
  fullCandidate: candidate,
  selectedCommand: command,
  fullCommand: { ...command, runId: 'run-full' },
  cases: [{ caseId: 'unknown', selected: true, legacy: 'unknown', selectedResult: 'pass', latencyMs: 1 }]
});
assert.equal(unknown.status, 'blocked');
assert.deepEqual(unknown.unknown, ['unknown']);
console.log('plan4 shadow comparison: ok');

function digest(seed: string): string {
  return `sha256:${createHash('sha256').update(seed).digest('hex')}`;
}
