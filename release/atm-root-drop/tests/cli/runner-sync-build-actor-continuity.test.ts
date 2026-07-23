import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectRunnerSyncAdmission } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import { resolveSharedWriteActorAuthority } from '../../packages/cli/src/commands/shared/identity-normalization.ts';

const laneOwner = 'queue-head.actor';
const staleLegacy = 'editor-handoff.stale';
const laneSessionId = 'lane-fixture-shared-write';
const fixtureTaskId = 'TASK-CONTINUITY-FIXTURE';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-0257-continuity-'));
try {
  mkdirSync(path.join(repo, '.atm/history/tasks'), { recursive: true });
  writeFileSync(path.join(repo, `.atm/history/tasks/${fixtureTaskId}.json`), `${JSON.stringify({
    schemaId: 'atm.taskDocument.v1',
    workItemId: fixtureTaskId,
    status: 'running',
    claim: {
      state: 'active',
      actorId: laneOwner,
      leaseId: 'lease-continuity-fixture'
    }
  }, null, 2)}\n`, 'utf8');

  const report = inspectRunnerSyncAdmission({
    cwd: repo,
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
      waitingTasks: [fixtureTaskId],
      requests: [{
        taskId: fixtureTaskId,
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
    cwd: repo,
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
      waitingTasks: [fixtureTaskId],
      requests: [{
        taskId: fixtureTaskId,
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
} finally {
  rmSync(repo, { recursive: true, force: true });
}

const handoffAuthority = resolveSharedWriteActorAuthority({
  explicitActorId: null,
  envActorId: null,
  legacyEnvActorId: 'editor-b.ambient',
  queueHeadOwnerActorIds: ['editor-a.captain'],
  activeClaimOwnerActorId: 'editor-a.captain',
  laneSessionId: 'lane-editor-a',
  buildCommand: 'npm run build'
});
// Queue-head / active-claim ownership is sufficient continuity; stale
// AGENT_IDENTITY stays diagnostic-only and must not fail-closed the lane.
assert.equal(handoffAuthority.ok, true);
assert.equal(handoffAuthority.actorId, 'editor-a.captain');
assert.equal(handoffAuthority.resolutionSource, 'queue-head');
assert.equal(handoffAuthority.legacyEnvDisagrees, true);
assert.equal(handoffAuthority.recoveryCommand, null);
assert.match(String(handoffAuthority.reason ?? ''), /diagnostic-only/);

console.log('[runner-sync-build-actor-continuity.test] ok');
