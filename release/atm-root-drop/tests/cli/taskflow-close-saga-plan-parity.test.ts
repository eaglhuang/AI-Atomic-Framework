import assert from 'node:assert/strict';
import { executeTaskCloseSaga } from '../../packages/cli/src/commands/taskflow/cross-authority-closeback.ts';
import { buildClosebackPlan } from '../../packages/cli/src/commands/taskflow/close-orchestration.ts';

const request = {
  taskId: 'TASK-PARITY-0001',
  actorId: 'validator',
  sourceIdentity: 'planning-card:sha256:parity',
  targetFiles: ['b.ts', 'a.ts', 'a.ts'],
  planningFiles: ['task.md'],
  targetBundleDigest: 'sha256:target',
  planningPatchDigest: 'sha256:planning',
  acceptanceEvidenceDigest: 'sha256:evidence'
};

const snapshot = {
  target: { name: 'target' as const, repoRoot: '/target', head: 'target-head', sourceDigest: 'sha256:target-source', writeable: true },
  planning: { name: 'planning' as const, repoRoot: '/planning', head: 'planning-head', sourceDigest: 'sha256:planning-source', writeable: true }
};

const dryRun = executeTaskCloseSaga(request, snapshot);
const write = executeTaskCloseSaga(request, snapshot);
const backend = executeTaskCloseSaga(request, snapshot);
const reconcile = executeTaskCloseSaga(request, snapshot);

const digestOf = (plan: typeof dryRun) => JSON.stringify({
  blockers: plan.blockers,
  steps: plan.steps,
  expectedFiles: plan.expectedFiles,
  authorityCas: plan.authorityCas,
  recoveryCommand: plan.recoveryCommand,
  legalRecoveryLanes: plan.legalRecoveryLanes,
  nextLegalRecoveryLane: plan.nextLegalRecoveryLane,
  forbiddenActions: plan.forbiddenActions,
  recoveryCycles: plan.recoveryCycles,
  emergencyLanes: plan.emergencyLanes
});

assert.equal(digestOf(dryRun), digestOf(write));
assert.equal(digestOf(write), digestOf(backend));
assert.equal(digestOf(backend), digestOf(reconcile));
assert.deepEqual(dryRun.expectedFiles.target, ['a.ts', 'b.ts'], 'the saga normalizes file manifests once for every adapter');
assert.equal(dryRun.nextLegalRecoveryLane.disposition, 'execute-now', 'ready close saga must expose an executable next legal recovery lane');
assert(dryRun.forbiddenActions.every((action) => !action.includes('TASK-PARITY-0001')), 'forbidden action policy must stay generic and not encode historical task ids');

const closeJsonPlan = buildClosebackPlan({
  taskId: 'TASK-CLOSE-JSON-0001',
  actorId: 'validator',
  historicalDeliveryRefs: [],
  delegationContract: {
    policy: {
      rosterSyncPolicy: 'none',
      rosterSync: { indexPath: null }
    }
  } as any,
  diagnosis: {
    bucket: 'complete-but-unfinalized',
    truth: 'ledger-running',
    residue: 'target-delivery-landed',
    reason: 'historical delivery evidence is required',
    nextCommand: 'node atm.mjs taskflow close --task TASK-CLOSE-JSON-0001 --json',
    triangulation: {
      liveLedger: { status: 'running' },
      planningFrontmatter: { status: 'done', source: null },
      divergence: []
    }
  },
  closebackPathResolution: {
    route: 'missing',
    planningMirrorPath: null,
    profileRepoRoot: null,
    planningStatus: null,
    diagnostics: {
      codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_MISSING'],
      messages: ['Planning closeback path is missing.']
    }
  }
});
assert.equal(closeJsonPlan.legalRecoveryLanes[0]?.owner, 'planning');
assert.equal(closeJsonPlan.legalRecoveryLanes[0]?.disposition, 'recover');
assert.equal(closeJsonPlan.nextLegalRecoveryLane, closeJsonPlan.legalRecoveryLanes[0]);
assert(closeJsonPlan.forbiddenActions.some((action) => action.includes('manual .atm edits')), 'taskflow close JSON must expose forbidden actions');

console.log(JSON.stringify({
  marker: '[taskflow-close-saga-plan-parity.test] ok',
  phase: dryRun.phase,
  stepCount: dryRun.steps.length
}));
