import assert from 'node:assert/strict';
import { inspectRunnerSyncAdmission } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import { resolveSharedWriteActorAuthority } from '../../packages/cli/src/commands/shared/identity-normalization.ts';

const laneOwner = 'queue-head.actor';
const staleLegacy = 'editor-handoff.stale';
const laneSessionId = 'lane-fixture-shared-write';

const report = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: laneOwner,
  sealedSourceSha: '3'.repeat(40),
  laneSessionId,
  envActorId: laneOwner,
  legacyEnvActorId: staleLegacy,
  runnerSyncSteward: {
    stewardWorkId: 'runner-sync-fixture',
    queuePosition: 1,
    suggestedNextAction: 'build',
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    waitingTasks: ['ATM-FRAMEWORK-TEMP-queue-head-actor'],
    requests: [{
      taskId: 'ATM-FRAMEWORK-TEMP-queue-head-actor',
      actorId: laneOwner,
      requestedSurfaces: ['release/atm-onefile/atm.mjs']
    }]
  },
  dirtyFiles: []
});

const build = report.orderedCommandManifests?.find((entry) => entry.id === 'runner-sync-build');
assert.ok(build);
assert.equal(build.manifest.env?.ATM_ACTOR_ID, laneOwner);
assert.equal(build.manifest.env?.ATM_RETAIN_RELEASE_ARTIFACTS, '1');
assert.deepEqual(build.manifest.argv, ['run', 'build']);
assert.match(build.display, /ATM_ACTOR_ID=queue-head\.actor/);
assert.doesNotMatch(build.display, /AGENT_IDENTITY/);
assert.equal(build.actorAuthority?.actorId, laneOwner);
assert.equal(build.actorAuthority?.laneSessionId, laneSessionId);
assert.equal(build.actorAuthority?.copyableCommand, build.display);
assert.equal(report.actorAuthority.legacyEnvDisagrees, true);
assert.equal(report.actorAuthority.ok, true);
assert.equal(report.ok, true);

const mismatched = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: staleLegacy,
  sealedSourceSha: '4'.repeat(40),
  laneSessionId,
  envActorId: null,
  legacyEnvActorId: staleLegacy,
  runnerSyncSteward: {
    stewardWorkId: 'runner-sync-fixture-mismatch',
    queuePosition: 1,
    suggestedNextAction: 'build',
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    waitingTasks: ['ATM-FRAMEWORK-TEMP-queue-head-actor'],
    requests: [{
      taskId: 'ATM-FRAMEWORK-TEMP-queue-head-actor',
      actorId: laneOwner,
      requestedSurfaces: ['release/atm-onefile/atm.mjs']
    }]
  },
  dirtyFiles: []
});

assert.equal(mismatched.ok, false);
assert.match(String(mismatched.requiredCommand ?? ''), /ATM_ACTOR_ID=queue-head\.actor/);
assert.doesNotMatch(String(mismatched.requiredCommand ?? ''), /AGENT_IDENTITY/);
const recoveryBuild = mismatched.orderedCommandManifests?.find((entry) => entry.id === 'runner-sync-build');
assert.equal(recoveryBuild?.manifest.env?.ATM_ACTOR_ID, laneOwner);
assert.equal(recoveryBuild?.actorAuthority?.actorId, laneOwner);
assert.equal(recoveryBuild?.actorAuthority?.laneSessionId, laneSessionId);

const handoffAuthority = resolveSharedWriteActorAuthority({
  explicitActorId: null,
  envActorId: null,
  legacyEnvActorId: 'editor-b.ambient',
  queueHeadOwnerActorIds: ['editor-a.captain'],
  activeClaimOwnerActorId: 'editor-a.captain',
  laneSessionId: 'lane-editor-a',
  buildCommand: 'npm run build'
});
assert.equal(handoffAuthority.ok, false);
assert.equal(handoffAuthority.legacyEnvDisagrees, true);
assert.match(String(handoffAuthority.recoveryCommand ?? ''), /ATM_ACTOR_ID=editor-a\.captain/);

console.log('[runner-sync-build-actor-continuity.test] ok');
