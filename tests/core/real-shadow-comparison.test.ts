import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareShadow, validateShadowComparison } from '../../packages/core/src/evidence/shadow-comparison.ts';

const report = JSON.parse(readFileSync(join(process.cwd(), 'docs', 'reports', 'plan4-real-shadow-comparison.json'), 'utf8'));
const candidate = report.candidate;
const selectedCommand = report.commands.selected;
const fullCommand = report.commands.full;

const clean = compareShadow({
  authorityDigest: report.authorityDigest,
  policyEpoch: report.policyEpoch,
  selectedCandidate: candidate,
  fullCandidate: candidate,
  selectedCommand,
  fullCommand,
  cases: report.cases,
  legacyLatencyMs: report.legacyLatencyMs
});
assert.equal(clean.status, 'proven');
assert.equal(clean.candidate.sameCandidate, true);
assert.equal(clean.escapedDefects.length, 0);
assert.equal(clean.unknown.length, 0);
assert.equal(validateShadowComparison(clean).ok, true);
assert.deepEqual(clean.selected, report.expected.selected);
assert.deepEqual(clean.skipped, report.expected.skipped);
assert.deepEqual(clean.falseBlocks, report.expected.falseBlocks);

const mismatch = compareShadow({
  authorityDigest: report.authorityDigest,
  policyEpoch: report.policyEpoch,
  selectedCandidate: candidate,
  fullCandidate: { ...candidate, candidateDigest: digest('different-candidate') },
  selectedCommand,
  fullCommand,
  cases: report.cases
});
assert.equal(mismatch.status, 'blocked');
assert.ok(mismatch.diagnostics.includes('candidate-digest-mismatch'));
assert.equal(validateShadowComparison(mismatch).ok, true);

const missingFull = compareShadow({
  authorityDigest: report.authorityDigest,
  policyEpoch: report.policyEpoch,
  selectedCandidate: candidate,
  fullCandidate: candidate,
  selectedCommand,
  fullCommand: null,
  cases: report.cases
});
assert.equal(missingFull.status, 'blocked');
assert.ok(missingFull.diagnostics.includes('full-source-missing'));

const stale = compareShadow({
  authorityDigest: report.authorityDigest,
  policyEpoch: report.policyEpoch,
  selectedCandidate: candidate,
  fullCandidate: candidate,
  selectedCommand,
  fullCommand: { ...fullCommand, stale: true },
  cases: report.cases
});
assert.equal(stale.status, 'blocked');
assert.ok(stale.diagnostics.includes('full-receipt-stale'));

const escaped = compareShadow({
  authorityDigest: report.authorityDigest,
  policyEpoch: report.policyEpoch,
  selectedCandidate: candidate,
  fullCandidate: candidate,
  selectedCommand,
  fullCommand,
  cases: [{ caseId: 'escaped-defect', selected: false, legacy: 'fail', selectedResult: 'pass', latencyMs: 7 }]
});
assert.equal(escaped.status, 'blocked');
assert.ok(escaped.diagnostics.includes('escaped-defect-invalidates-policy-epoch'));
assert.equal(escaped.policyEpochValid, false);

console.log('real shadow comparison: ok');

function digest(seed: string): string {
  return `sha256:${createHash('sha256').update(seed).digest('hex')}`;
}
