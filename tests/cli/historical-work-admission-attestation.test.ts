import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  classifyTerminalLifecycleOwnership,
  createForwardAttestation,
  createHistoricalWorkAdmissionAttestation,
  evaluateHistoricalWorkAdmission
} from '../../packages/core/src/broker/historical-work-admission-attestation.ts';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';

const commit = {
  commitSha: 'a'.repeat(40),
  parentCommitSha: 'b'.repeat(40),
  treeSha: 'c'.repeat(40),
  isAncestorOfHead: true
};
const record = createHistoricalWorkAdmissionAttestation({
  ...commit,
  provenance: { kind: 'emergency', digest: `sha256:${'d'.repeat(64)}`, ref: '.atm/history/protected-override-audit/fixture.json' },
  taskId: 'TASK-GIT-0022',
  laneSessionId: 'lane-fixture',
  attestedBy: 'reviewer-fixture',
  attestedAt: '2026-07-29T00:00:00.000Z'
});

assert.equal(evaluateHistoricalWorkAdmission({ ...{ commit, attestations: [] }, hasNormalWorkAdmissionTrailer: true }).decision, 'covered');
assert.equal(evaluateHistoricalWorkAdmission({ commit, attestations: [], hasNormalWorkAdmissionTrailer: false }).decision, 'missing');
assert.equal(evaluateHistoricalWorkAdmission({ commit, attestations: [record], hasNormalWorkAdmissionTrailer: false }).decision, 'covered');
assert.equal(evaluateHistoricalWorkAdmission({ commit: { ...commit, treeSha: 'e'.repeat(40) }, attestations: [record], hasNormalWorkAdmissionTrailer: false }).decision, 'invalid');
assert.equal(evaluateHistoricalWorkAdmission({ commit, attestations: [record, record], hasNormalWorkAdmissionTrailer: false }).decision, 'invalid');
assert.equal(evaluateHistoricalWorkAdmission({ commit: { ...commit, isAncestorOfHead: false }, attestations: [record], hasNormalWorkAdmissionTrailer: false }).decision, 'invalid');

assert.equal(classifyTerminalLifecycleOwnership({ status: 'done', claimState: 'released', lockReleased: true }).decision, 'terminal');
assert.equal(classifyTerminalLifecycleOwnership({ status: 'done', claimState: 'released', lockReleased: false }).decision, 'inconsistent');
assert.equal(classifyTerminalLifecycleOwnership({ status: 'running', claimState: 'active', lockReleased: false }).decision, 'active');

const forward = createForwardAttestation({
  taskId: 'TASK-GIT-0024',
  commit,
  provenance: { kind: 'emergency', digest: `sha256:${'d'.repeat(64)}`, ref: '.atm/history/protected-override-audit/fixture.json' },
  reason: 'fixture emergency bridge',
  evidenceRefs: ['git:fixture'],
  emergencyClass: 'protected-push-recovery',
  scope: ['packages/cli/src/commands/git-governance.ts'],
  laneSessionId: 'lane-fixture',
  attestedBy: 'reviewer-fixture',
  attestedAt: '2026-07-29T00:00:00.000Z'
});
assert.equal(forward.reason, 'fixture emergency bridge');
assert.deepEqual(forward.evidenceRefs, ['git:fixture']);
assert.deepEqual(forward.scope, ['packages/cli/src/commands/git-governance.ts']);

// The public command is forward-only: it records a new object and never tries
// to amend the target commit. This is a real temporary Git repository, not a
// mocked command parser.
{
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-historical-attestation-'));
  const git = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'ignore' });
  git(['init']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'user.name', 'fixture']);
  writeFileSync(path.join(cwd, 'baseline.txt'), 'baseline\n');
  git(['add', 'baseline.txt']);
  git(['commit', '-m', 'baseline fixture']);
  writeFileSync(path.join(cwd, 'critical.ts'), 'export const critical = 1;\n');
  git(['add', 'critical.ts']);
  git(['commit', '-m', 'critical fixture']);
  const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const provenanceRef = '.atm/history/protected-override-audit/fixture.json';
  const provenancePath = path.join(cwd, provenanceRef);
  const provenance = JSON.stringify({ outcome: 'authorized', commitSha });
  mkdirSync(path.dirname(provenancePath), { recursive: true });
  writeFileSync(provenancePath, provenance);
  const provenanceDigest = `sha256:${createHash('sha256').update(provenance).digest('hex')}`;
  const missingEmergencyMetadata = await runAtmGit([
    'attest', '--cwd', cwd, '--commit', commitSha, '--task', 'TASK-GIT-0024',
    '--actor', 'fixture-actor', '--lane', 'lane-fixture', '--provenance-kind', 'emergency',
    '--provenance-ref', provenanceRef, '--provenance-digest', provenanceDigest, '--json'
  ]);
  assert.equal(missingEmergencyMetadata.ok, false);
  const dryRun = await runAtmGit([
    'attest', '--cwd', cwd, '--commit', commitSha, '--task', 'TASK-GIT-0024',
    '--actor', 'fixture-actor', '--lane', 'lane-fixture', '--provenance-kind', 'emergency',
    '--provenance-ref', provenanceRef, '--provenance-digest', provenanceDigest,
    '--reason', 'fixture emergency bridge', '--emergency-class', 'protected-push-recovery',
    '--scope', 'critical.ts', '--evidence-ref', provenanceRef, '--dry-run', '--json'
  ]);
  assert.equal(dryRun.ok, true);
  assert.equal(existsSync(path.join(cwd, '.atm/history/evidence/TASK-GIT-0024.historical-work-admission-attestations.json')), false);
  const result = await runAtmGit([
    'attest', '--cwd', cwd, '--commit', commitSha, '--task', 'TASK-GIT-0024',
    '--actor', 'fixture-actor', '--lane', 'lane-fixture', '--provenance-kind', 'emergency',
    '--provenance-ref', provenanceRef, '--provenance-digest', provenanceDigest,
    '--reason', 'fixture emergency bridge', '--emergency-class', 'protected-push-recovery',
    '--scope', 'critical.ts', '--evidence-ref', provenanceRef, '--json'
  ]);
  assert.equal(result.ok, true);
  const ledger = JSON.parse(readFileSync(path.join(cwd, '.atm/history/evidence/TASK-GIT-0024.historical-work-admission-attestations.json'), 'utf8'));
  assert.equal(ledger.attestations.length, 1);
  assert.equal(ledger.attestations[0].commitSha, commitSha);
  assert.equal(ledger.attestations[0].reason, 'fixture emergency bridge');
  assert.deepEqual(ledger.attestations[0].scope, ['critical.ts']);
  const status = await runAtmGit(['attest', '--cwd', cwd, '--status', '--commit', commitSha, '--json']);
  assert.equal(status.ok, true);
  assert.equal(status.evidence?.attestationCount, 1);
  const validate = await runAtmGit(['attest', '--cwd', cwd, '--validate', '--json']);
  assert.equal(validate.ok, true);
  const duplicate = await runAtmGit([
    'attest', '--cwd', cwd, '--commit', commitSha, '--task', 'TASK-GIT-0024',
    '--actor', 'fixture-actor', '--lane', 'lane-fixture', '--provenance-kind', 'emergency',
    '--provenance-ref', provenanceRef, '--provenance-digest', provenanceDigest,
    '--reason', 'fixture emergency bridge', '--emergency-class', 'protected-push-recovery',
    '--scope', 'critical.ts', '--evidence-ref', provenanceRef, '--json'
  ]);
  assert.equal(duplicate.ok, false);
}

console.log('historical-work-admission-attestation: ok');
