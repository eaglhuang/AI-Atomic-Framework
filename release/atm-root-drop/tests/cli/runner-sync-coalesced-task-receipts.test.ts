import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeRunnerSyncReceipt } from '../../scripts/runner-sync-incremental-build.ts';
import type { RunnerSyncAdmissionReport } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-coalesced-task-receipts-'));
const seal = 'b'.repeat(40);
const members = [
  { taskId: 'TASK-CLOSE-A', actorId: 'captain-a', requestedSurfaces: ['release/atm-onefile/atm.mjs'] },
  { taskId: 'TASK-CLOSE-B', actorId: 'captain-b', requestedSurfaces: ['release/atm-root-drop'] }
];

for (const member of members) {
  const ledgerPath = path.join(cwd, '.atm', 'history', 'tasks', `${member.taskId}.json`);
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify({ workItemId: member.taskId, status: 'running' })}\n`, 'utf8');
}

const admission: RunnerSyncAdmissionReport = {
  schemaId: 'atm.runnerSyncAdmission.v1', ok: true, stewardActorId: 'captain-a', sealedSourceSha: seal,
  actorAuthority: { ok: true } as RunnerSyncAdmissionReport['actorAuthority'],
  runnerSyncSteward: {
    stewardWorkId: 'runner-sync-shared-close', queuePosition: 1, suggestedNextAction: 'build once',
    requestedSurfaces: ['packages/cli/dist', 'release/atm-onefile/atm.mjs', 'release/atm-root-drop'],
    waitingTasks: members.map((entry) => entry.taskId), requests: members
  },
  queueHeadOwnership: {
    ok: true, stewardWorkId: 'runner-sync-shared-close', queuePosition: 1, queueHeadHealth: 'task-active',
    waitingTasks: members.map((entry) => entry.taskId), ownerActorIds: members.map((entry) => entry.actorId),
    reason: null, cleanupCommand: null
  },
  foreignNonReleaseWip: [], foreignBuildInputConflicts: [], releaseWip: [],
  ordinaryTaskReleaseAutoStageAllowed: false, brokerTicket: null, requiredCommand: null
};

const timings = {
  startedAt: 0, inputHashCalculationMs: 1, skipDecisionMs: 1, worktreeSetupMs: 1,
  typescriptBuildMs: 1, rootDropAssemblyMs: 1, onefileAssemblyMs: 1,
  artifactSyncMs: 1, cleanupMs: 1, totalElapsedMs: 8
};

try {
  const primary = writeRunnerSyncReceipt({
    cwd, admission, actorId: 'captain-a', sealedSourceSha: seal,
    buildTarget: 'full', buildInputsTreeHash: 'sha256:inputs', buildDecision: 'built', timings
  });
  assert.equal(primary, '.atm/history/evidence/TASK-CLOSE-A.runner-sync-receipt.json');
  for (const member of members) {
    const receiptPath = path.join(cwd, '.atm', 'history', 'evidence', `${member.taskId}.runner-sync-receipt.json`);
    assert.equal(existsSync(receiptPath), true, `missing task-specific receipt for ${member.taskId}`);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(receipt.taskId, member.taskId);
    assert.equal(receipt.actorId, member.actorId);
    assert.equal(receipt.stewardWorkId, 'runner-sync-shared-close');
    assert.deepEqual(receipt.memberTaskIds, ['TASK-CLOSE-A', 'TASK-CLOSE-B']);
    assert.equal(receipt.childAttribution.complete, true);
  }
  console.log('[runner-sync-coalesced-task-receipts] ok');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
