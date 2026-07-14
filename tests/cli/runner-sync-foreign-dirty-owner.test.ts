import assert from 'node:assert/strict';
import {
  inspectRunnerSyncAdmission,
  ordinaryTaskCanAutoStageRelease
} from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const blocked = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: 'release-steward',
  sealedSourceSha: 'abc123',
  dirtyFiles: [
    'packages/cli/src/commands/internal-release.ts',
    'release/atm-onefile/atm.mjs'
  ]
});
assert.equal(blocked.ok, false);
assert.deepEqual(blocked.foreignNonReleaseWip, ['packages/cli/src/commands/internal-release.ts']);
assert.deepEqual(blocked.releaseWip, ['release/atm-onefile/atm.mjs']);
assert.equal(blocked.stewardActorId, 'release-steward');
assert.equal(blocked.sealedSourceSha, 'abc123');
assert.equal(blocked.ordinaryTaskReleaseAutoStageAllowed, false);

const releaseOnly = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: 'release-steward',
  sealedSourceSha: 'def456',
  dirtyFiles: ['release/atm-root-drop/release-manifest.json']
});
assert.equal(releaseOnly.ok, true);
assert.equal(ordinaryTaskCanAutoStageRelease({ taskId: 'ATM-GOV-0127', files: ['release/atm-onefile/atm.mjs'] }), false);

console.log('[runner-sync-foreign-dirty-owner.test] ok');
