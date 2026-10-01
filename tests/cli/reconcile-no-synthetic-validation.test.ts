import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { classifyValidatorEvidenceState } from '../../packages/cli/src/commands/evidence/missing-report.ts';
import { buildHistoricalReconcileEvidenceEnvelope } from '../../packages/cli/src/commands/tasks/reconcile-orchestrator.ts';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const NOW = '2026-10-01T12:00:00.000Z';
const GATES = ['typecheck', 'validate:cli', 'validate:git-head-evidence'];

// The shape reconcile used to write when no evidence file existed: fresh passes for the
// required gates backed by a `git show` "run" whose output hash is just the commit string.
// The verdict reader accepts it as a real pass, which is the defect this test pins.
const synthesized = [{
  evidenceKind: 'validation',
  createdAt: NOW,
  evidenceFreshness: 'fresh',
  validationPasses: GATES,
  commandRuns: [{
    command: `git show ${COMMIT}`,
    exitCode: 0,
    stdoutSha256: `sha256:${createHash('sha256').update(COMMIT).digest('hex')}`,
    stderrSha256: `sha256:${createHash('sha256').update('reconcile').digest('hex')}`
  }]
}];
for (const gate of GATES) {
  assert.equal(classifyValidatorEvidenceState(synthesized, gate), 'pass', `the old synthesized record passes ${gate} without running it`);
}

// A scoped delivery commit with no validator receipt must not produce any pass.
const envelope = buildHistoricalReconcileEvidenceEnvelope({
  taskId: 'TASK-RECONCILE-0001',
  commitSha: COMMIT,
  actorId: 'reconcile-probe',
  artifactPaths: ['packages/example/src/index.ts'],
  now: NOW
});
const records = envelope.evidence as unknown as Record<string, unknown>[];
for (const gate of GATES) {
  assert.equal(classifyValidatorEvidenceState(records, gate), 'absent', `${gate} stays missing until a real run supplies it`);
}
assert.equal(records.length, 1);
const [record] = records;
assert.equal(record.evidenceFreshness, 'historical-reference');
assert.equal(record.validationPasses, undefined);
assert.equal((record.details as Record<string, unknown>).validationPasses, undefined);
assert.equal(record.commandRuns, undefined, 'no command run stands in for a validator');
assert.equal((record.details as Record<string, unknown>).commandRuns, undefined);
assert.equal((record.details as Record<string, unknown>).deliveryCommit, COMMIT, 'the delivery attestation is kept');

console.log('ok: historical reconcile attests delivery without synthesizing validation');
