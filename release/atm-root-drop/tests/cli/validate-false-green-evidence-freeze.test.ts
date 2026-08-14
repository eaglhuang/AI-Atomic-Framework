import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateFreezeArtifact } from '../../scripts/validate-false-green-evidence-freeze.ts';

const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const receipt = (id: string, stdout = `${id}\n`, stderr = '') => ({
  id,
  command: ['node', id],
  cwd: 'C:/repo',
  startedAt: '2026-08-14T00:00:00.000Z',
  finishedAt: '2026-08-14T00:00:01.000Z',
  elapsedMs: 1000,
  exitCode: id === 'validate-standard' ? 1 : 0,
  timedOut: id === 'validate-standard',
  signal: null,
  stdout,
  stderr,
  stdoutDigest: digest(stdout),
  stderrDigest: digest(stderr),
  combinedDigest: digest(`${stdout}\u0000${stderr}`)
});

const requiredIds = [
  'target-head', 'origin-main-head', 'planning-head', 'target-status-porcelain',
  'planning-status-porcelain', 'worktree-registry', 'task-ledger-census',
  'protected-override-census', 'validate-test-facade', 'validate-module-boundaries',
  'validate-quick', 'validate-standard'
];

const validArtifact = () => ({
  schemaId: 'atm.falseGreenEvidenceFreeze.v1',
  generatedAt: '2026-08-14T00:00:02.000Z',
  verdict: 'remain-open',
  receiptWindow: { startedAt: '2026-08-14T00:00:00.000Z', finishedAt: '2026-08-14T00:00:02.000Z' },
  scope: {
    targetHead: 'a'.repeat(40), originMainHead: 'b'.repeat(40), planningHead: 'c'.repeat(40),
    sourceDigestStatus: 'present', rescueWorktreeAvailability: 'unavailable'
  },
  commandReceipts: requiredIds.map((id) => receipt(id)),
  rescueWorktrees: [],
  nonClaims: ['This freeze does not certify Plan 3.0, 3.1, 3.2, or 4.0.']
});

assert.deepEqual(validateFreezeArtifact(validArtifact()), []);

const promoted = validArtifact();
promoted.verdict = 'complete';
assert.match(validateFreezeArtifact(promoted).join('\n'), /verdict/);

const digestMismatch = validArtifact();
digestMismatch.commandReceipts[0].stdoutDigest = digest('wrong');
assert.match(validateFreezeArtifact(digestMismatch).join('\n'), /stdoutDigest/);

const missing = validArtifact();
missing.commandReceipts = missing.commandReceipts.slice(1);
assert.match(validateFreezeArtifact(missing).join('\n'), /target-head/);

console.log('[validate-false-green-evidence-freeze.test] ok');
