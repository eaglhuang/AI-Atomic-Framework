import assert from 'node:assert/strict';
import {
  applyCloseOwnedNonRunnerDeliveryDirtyAdmission,
  extractCloseOwnedDeliveryFiles
} from '../close-owned-delivery-dirty-admission.ts';
import { buildCloseOwnedDirtyPendingBlocker } from '../implementation.ts';
import type { HistoricalClosePreflightSummary } from '../historical-close-preflight.ts';
import type { FrameworkCloseDirtyGuardReport } from '../../tasks/scope-lock-diagnostics.ts';

function dirtyGuard(overrides: Partial<FrameworkCloseDirtyGuardReport>): FrameworkCloseDirtyGuardReport {
  return {
    schemaId: 'atm.frameworkCloseDirtyGuard.v1',
    taskId: 'TASK-DIRTY-0001',
    ok: false,
    reason: 'blocking-dirty-files-present',
    blockingTrackedDirtyFiles: ['src/deliver.txt'],
    scopeTrackedDirtyFiles: ['src/deliver.txt'],
    governanceTrackedDirtyFiles: [],
    regenerableArtifactFiles: [],
    correctPlanningMirrorPreEditFiles: [],
    incorrectPlanningMirrorPreEditFiles: [],
    advisoryTrackedDirtyFiles: [],
    foreignActiveDirtyFiles: [],
    generatedArtifactFiles: [],
    remediation: {
      requiredCommand: 'node atm.mjs git commit --json',
      safeToAutoStage: false,
      operatorSummary: 'blocked'
    },
    ...overrides
  };
}

function preflight(overrides: Partial<HistoricalClosePreflightSummary> = {}): HistoricalClosePreflightSummary {
  const guard = overrides.dirtyGuard ?? dirtyGuard({});
  return {
    schemaId: 'atm.historicalClosePreflight.v1',
    taskId: 'TASK-DIRTY-0001',
    ok: false,
    blockers: [{
      id: 'scopeTrackedDirtyFiles',
      code: 'ATM_TASKFLOW_PRECLOSE_SCOPE_TRACKED_DIRTY',
      summary: 'In-scope delivery files are modified but not committed.',
      files: guard.scopeTrackedDirtyFiles,
      remediationChoices: [],
      requiredCommand: 'node atm.mjs git commit --json'
    }],
    operationalBlockers: [{
      id: 'scopeTrackedDirtyFiles',
      code: 'ATM_TASKFLOW_PRECLOSE_SCOPE_TRACKED_DIRTY',
      summary: 'In-scope delivery files are modified but not committed.',
      files: guard.scopeTrackedDirtyFiles,
      remediationChoices: [],
      requiredCommand: 'node atm.mjs git commit --json'
    }],
    scopeTrackedDirtyFiles: guard.scopeTrackedDirtyFiles,
    unexpectedStagedTasks: [],
    unexpectedNonBundleStaged: [],
    mixedDeliveryCommit: null,
    staleEvidence: [],
    missingApprovalLease: false,
    dirtyGuard: guard,
    writeRollbackSummary: {
      schemaId: 'atm.historicalCloseWriteRollbackSummary.v1',
      summary: 'fixture',
      operatorWarnings: [],
      verificationCommands: []
    },
    ...overrides
  };
}

assert.deepEqual(
  extractCloseOwnedDeliveryFiles({ targetDeliveryFiles: ['src/deliver.txt', '.atm/history/tasks/TASK-DIRTY-0001.json'] }),
  ['.atm/history/tasks/TASK-DIRTY-0001.json', 'src/deliver.txt']
);

const admitted = applyCloseOwnedNonRunnerDeliveryDirtyAdmission({
  preflight: preflight(),
  closeOwnedDeliveryFiles: ['src/deliver.txt']
});
assert.equal(admitted.ok, true, 'close-owned non-runner tracked delivery dirty must not block preclose');
assert.equal(admitted.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_PRECLOSE_SCOPE_TRACKED_DIRTY'), false);
assert.deepEqual(admitted.scopeTrackedDirtyFiles, []);
assert.equal(admitted.dirtyGuard.ok, true);
assert.ok(admitted.dirtyGuard.advisoryTrackedDirtyFiles.includes('src/deliver.txt'));

assert.equal(
  buildCloseOwnedDirtyPendingBlocker({
    taskId: 'TASK-DIRTY-0001',
    actorId: 'captain',
    previewCommitBundle: {
      targetRepo: { stageFiles: ['src/deliver.txt'] },
      targetGovernanceFiles: [],
      planningRepo: { stageFiles: [] },
      planningFiles: []
    } as never,
    dirtyGuard: admitted.dirtyGuard
  }),
  null,
  'close-owned advisory dirty must stay advisory when another readiness blocker exists'
);

const blockingPending = buildCloseOwnedDirtyPendingBlocker({
  taskId: 'TASK-DIRTY-0001',
  actorId: 'captain',
  previewCommitBundle: {
    targetRepo: { stageFiles: ['src/deliver.txt'] },
    targetGovernanceFiles: [],
    planningRepo: { stageFiles: [] },
    planningFiles: []
  } as never,
  dirtyGuard: { blockingTrackedDirtyFiles: ['src/deliver.txt'] },
  fallbackCommand: 'node atm.mjs tasks renew --task unrelated --json'
});
assert.equal(blockingPending?.code, 'ATM_TASKFLOW_CLOSE_OWNED_DIRTY_PENDING');
assert.equal(
  blockingPending?.requiredCommand,
  'node atm.mjs taskflow pre-close --task TASK-DIRTY-0001 --actor "captain" --json',
  'owned-dirty recovery must be derived from the owned-dirty contract, never copied from another blocker'
);

const runnerAffecting = applyCloseOwnedNonRunnerDeliveryDirtyAdmission({
  preflight: preflight({
    dirtyGuard: dirtyGuard({
      blockingTrackedDirtyFiles: ['packages/cli/src/commands/taskflow/implementation.ts'],
      scopeTrackedDirtyFiles: ['packages/cli/src/commands/taskflow/implementation.ts']
    }),
    scopeTrackedDirtyFiles: ['packages/cli/src/commands/taskflow/implementation.ts'],
    blockers: [{
      id: 'scopeTrackedDirtyFiles',
      code: 'ATM_TASKFLOW_PRECLOSE_SCOPE_TRACKED_DIRTY',
      summary: 'runner-affecting dirty',
      files: ['packages/cli/src/commands/taskflow/implementation.ts'],
      remediationChoices: [],
      requiredCommand: null
    }],
    operationalBlockers: [{
      id: 'scopeTrackedDirtyFiles',
      code: 'ATM_TASKFLOW_PRECLOSE_SCOPE_TRACKED_DIRTY',
      summary: 'runner-affecting dirty',
      files: ['packages/cli/src/commands/taskflow/implementation.ts'],
      remediationChoices: [],
      requiredCommand: null
    }]
  }),
  closeOwnedDeliveryFiles: ['packages/cli/src/commands/taskflow/implementation.ts']
});
assert.equal(runnerAffecting.ok, false, 'runner-affecting tracked dirty must remain a preclose blocker');
assert.equal(runnerAffecting.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_PRECLOSE_SCOPE_TRACKED_DIRTY'), true);
assert.ok(runnerAffecting.scopeTrackedDirtyFiles.includes('packages/cli/src/commands/taskflow/implementation.ts'));

const unowned = applyCloseOwnedNonRunnerDeliveryDirtyAdmission({
  preflight: preflight(),
  closeOwnedDeliveryFiles: ['src/other.txt']
});
assert.equal(unowned.ok, false, 'dirty files the close bundle does not own must remain blockers');
assert.equal(unowned.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_PRECLOSE_SCOPE_TRACKED_DIRTY'), true);

console.log('[close-owned-delivery-dirty-admission] ok');
