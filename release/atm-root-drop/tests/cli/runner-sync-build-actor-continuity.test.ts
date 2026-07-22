import assert from 'node:assert/strict';
import { inspectRunnerSyncAdmission } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const actor = 'queue-head.actor';
const report = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: actor,
  sealedSourceSha: '3'.repeat(40),
  runnerSyncSteward: {
    stewardWorkId: 'runner-sync-fixture',
    queuePosition: 1,
    suggestedNextAction: 'build',
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    waitingTasks: ['ATM-FRAMEWORK-TEMP-queue-head-actor'],
    requests: [{
      taskId: 'ATM-FRAMEWORK-TEMP-queue-head-actor',
      actorId: actor,
      requestedSurfaces: ['release/atm-onefile/atm.mjs']
    }]
  },
  dirtyFiles: []
});

const build = report.orderedCommandManifests?.find((entry) => entry.id === 'runner-sync-build');
assert.ok(build);
assert.equal(build.manifest.env?.ATM_ACTOR_ID, actor);
assert.equal(build.manifest.env?.ATM_RETAIN_RELEASE_ARTIFACTS, '1');
assert.deepEqual(build.manifest.argv, ['run', 'build']);
assert.match(build.display, /ATM_ACTOR_ID=queue-head\.actor/);
assert.doesNotMatch(build.display, /AGENT_IDENTITY/);

console.log('[runner-sync-build-actor-continuity.test] ok');
