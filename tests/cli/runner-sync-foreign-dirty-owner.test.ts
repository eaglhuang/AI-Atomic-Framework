import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  inspectRunnerSyncAdmission,
  ordinaryTaskCanAutoStageRelease
} from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const blocked = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: 'release-steward',
  sealedSourceSha: 'abc123',
  runnerSyncSteward: {
    stewardWorkId: 'runner-sync-abc123',
    queuePosition: 1,
    suggestedNextAction: 'run runner sync'
  },
  dirtyFiles: [
    'packages/cli/src/commands/internal-release.ts',
    'release/atm-onefile/atm.mjs'
  ],
  foreignClaims: [{
    taskId: 'ATM-GOV-BLOCKED',
    actorId: 'other-agent',
    laneSessionId: 'lane-other',
    heartbeatAt: '2026-07-18T00:00:00.000Z',
    claimedAt: '2026-07-18T00:00:00.000Z',
    files: ['packages/cli/src/commands/internal-release.ts']
  }],
  landedFiles: [
    'packages/cli/src/commands/internal-release.ts'
  ]
});
assert.equal(blocked.ok, false);
assert.deepEqual(blocked.foreignNonReleaseWip, ['packages/cli/src/commands/internal-release.ts']);
assert.equal(blocked.foreignBuildInputConflicts[0]?.blockingTaskId, 'ATM-GOV-BLOCKED');
assert.equal(blocked.foreignBuildInputConflicts[0]?.blockingActorId, 'other-agent');
assert.deepEqual(blocked.foreignBuildInputConflicts[0]?.intersectingFiles, ['packages/cli/src/commands/internal-release.ts']);
assert.deepEqual(blocked.foreignBuildInputConflicts[0]?.dirtyIntersectingFiles, ['packages/cli/src/commands/internal-release.ts']);
assert.deepEqual(blocked.foreignBuildInputConflicts[0]?.landedIntersectingFiles, ['packages/cli/src/commands/internal-release.ts']);
assert.deepEqual(blocked.releaseWip, ['release/atm-onefile/atm.mjs']);
assert.equal(blocked.stewardActorId, 'release-steward');
assert.equal(blocked.sealedSourceSha, 'abc123');
assert.equal(blocked.ordinaryTaskReleaseAutoStageAllowed, false);

const dirtyButUnlanded = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: 'release-steward',
  sealedSourceSha: 'dirty-unlanded',
  runnerSyncSteward: {
    stewardWorkId: 'runner-sync-dirty-unlanded',
    queuePosition: 1,
    suggestedNextAction: 'run runner sync'
  },
  dirtyFiles: ['packages/cli/src/commands/internal-release.ts'],
  foreignClaims: [{
    taskId: 'ATM-GOV-DIRTY',
    actorId: 'other-agent',
    heartbeatAt: '2026-07-18T00:00:00.000Z',
    files: ['packages/cli/src/commands/internal-release.ts']
  }],
  landedFiles: []
});
assert.equal(dirtyButUnlanded.ok, true);
assert.deepEqual(dirtyButUnlanded.foreignNonReleaseWip, []);
assert.deepEqual(dirtyButUnlanded.foreignBuildInputConflicts, []);

const nonBuildDirty = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: 'release-steward',
  sealedSourceSha: 'non-build-dirty',
  runnerSyncSteward: {
    stewardWorkId: 'runner-sync-non-build-dirty',
    queuePosition: 1,
    suggestedNextAction: 'run runner sync'
  },
  dirtyFiles: [
    '.atm/history/evidence/TASK-LANE-0019.json',
    '.claude/skills/atm-memory-consolidate/SKILL.md',
    'templates/skills/atm-task-card-authoring.skill.md',
    'docs/governance/parallel-governance-charter.md'
  ],
  foreignClaims: [{
    taskId: 'ATM-GOV-DOCS',
    actorId: 'docs-agent',
    heartbeatAt: '2026-07-18T00:00:00.000Z',
    files: [
      '.atm/history/evidence/TASK-LANE-0019.json',
      'docs/governance/parallel-governance-charter.md'
    ]
  }],
  landedFiles: ['docs/governance/parallel-governance-charter.md']
});
assert.equal(nonBuildDirty.ok, true);
assert.deepEqual(nonBuildDirty.foreignNonReleaseWip, []);
assert.deepEqual(nonBuildDirty.foreignBuildInputConflicts, []);

const releaseOnly = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: 'release-steward',
  sealedSourceSha: 'def456',
  runnerSyncSteward: {
    stewardWorkId: 'runner-sync-def456',
    queuePosition: 1,
    suggestedNextAction: 'run runner sync'
  },
  dirtyFiles: ['release/atm-root-drop/release-manifest.json']
});
assert.equal(releaseOnly.ok, true);
assert.equal(releaseOnly.queueHeadOwnership.ok, true);
assert.equal(ordinaryTaskCanAutoStageRelease({ taskId: 'ATM-GOV-0127', files: ['release/atm-onefile/atm.mjs'] }), false);

const missingReservation = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: 'release-steward',
  sealedSourceSha: 'missing-reservation',
  dirtyFiles: []
});
assert.equal(missingReservation.ok, false);
assert.equal(missingReservation.queueHeadOwnership.ok, false);
assert.match(missingReservation.requiredCommand ?? '', /queue-head reservation/);

const waiting = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: 'release-steward',
  sealedSourceSha: 'queued-behind',
  runnerSyncSteward: {
    stewardWorkId: 'runner-sync-queued',
    queuePosition: 2,
    suggestedNextAction: 'wait'
  },
  dirtyFiles: []
});
assert.equal(waiting.ok, false);
assert.match(waiting.requiredCommand ?? '', /queued at position 2/);

const ownedByAnother = inspectRunnerSyncAdmission({
  cwd: process.cwd(),
  stewardActorId: 'release-steward',
  sealedSourceSha: 'owned-by-another',
  runnerSyncSteward: {
    stewardWorkId: 'runner-sync-other',
    queuePosition: 1,
    suggestedNextAction: 'run runner sync',
    requests: [{ actorId: 'other-steward' }]
  } as any,
  dirtyFiles: []
});
assert.equal(ownedByAnother.ok, false);
assert.match(ownedByAnother.requiredCommand ?? '', /other-steward/);

const tempRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-admission-'));
try {
  const queuePath = path.join(tempRepo, '.atm', 'runtime', 'runner-sync-steward-queue.json');
  const taskPath = path.join(tempRepo, '.atm', 'history', 'tasks', 'TASK-A.json');
  mkdirSync(path.dirname(queuePath), { recursive: true });
  mkdirSync(path.dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-A',
    title: 'Runner sync owner fixture',
    status: 'running'
  }, null, 2)}\n`, 'utf8');
  writeFileSync(queuePath, `${JSON.stringify({
    schemaId: 'atm.runnerSyncStewardQueue.v1',
    specVersion: '0.1.0',
    stewardKey: 'atm.runner-sync.coalescing-steward',
    updatedAt: '2026-07-16T00:00:00.000Z',
    groups: [{
      stewardWorkId: 'runner-sync-file-backed',
      sealedSourceSha: 'sha-from-queue',
      queuePosition: 1,
      status: 'queue-head',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
      requestedSurfaces: ['release/atm-onefile/atm.mjs'],
      waitingTasks: ['TASK-A'],
      suggestedNextAction: 'run runner sync',
      requests: [{
        taskId: 'TASK-A',
        actorId: 'release-steward',
        sealedSourceSha: 'sha-from-queue',
        requestedSurfaces: ['release/atm-onefile/atm.mjs'],
        createdAt: '2026-07-16T00:00:00.000Z',
        heartbeatAt: '2026-07-16T00:00:00.000Z',
        expiresAt: '2026-07-16T00:07:00.000Z',
        ttlSeconds: 420,
        queuePosition: 1,
        suggestedNextAction: 'run runner sync'
      }]
    }]
  }, null, 2)}\n`, 'utf8');
  const fileBacked = inspectRunnerSyncAdmission({
    cwd: tempRepo,
    stewardActorId: 'release-steward',
    sealedSourceSha: 'sha-from-queue',
    dirtyFiles: []
  });
  assert.equal(fileBacked.ok, true);
  assert.equal(fileBacked.queueHeadOwnership.stewardWorkId, 'runner-sync-file-backed');
  assert.deepEqual(fileBacked.queueHeadOwnership.ownerActorIds, ['release-steward']);
} finally {
  rmSync(tempRepo, { recursive: true, force: true });
}

console.log('[runner-sync-foreign-dirty-owner.test] ok');
