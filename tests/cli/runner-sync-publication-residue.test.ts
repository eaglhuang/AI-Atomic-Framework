import assert from 'node:assert/strict';
import { inspectRunnerSyncAdmission } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const report = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: 'g9-test',
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  dirtyFiles: [
    'packages/cli/dist/atm.js',
    'release/atm-onefile/atm.mjs',
    'docs/governance/notes.md'
  ],
  foreignClaims: []
});

assert.deepEqual(report.releaseWip, ['packages/cli/dist/atm.js', 'release/atm-onefile/atm.mjs']);
assert.equal(report.releaseWip.includes('docs/governance/notes.md'), false);
console.log('[runner-sync-publication-residue.test] ok');
