import assert from 'node:assert/strict';
import { executeTaskCloseSaga } from '../../packages/cli/src/commands/taskflow/cross-authority-closeback.ts';

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
  recoveryCommand: plan.recoveryCommand
});

assert.equal(digestOf(dryRun), digestOf(write));
assert.equal(digestOf(write), digestOf(backend));
assert.equal(digestOf(backend), digestOf(reconcile));
assert.deepEqual(dryRun.expectedFiles.target, ['a.ts', 'b.ts'], 'the saga normalizes file manifests once for every adapter');

console.log(JSON.stringify({
  marker: '[taskflow-close-saga-plan-parity.test] ok',
  phase: dryRun.phase,
  stepCount: dryRun.steps.length
}));
