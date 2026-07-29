import assert from 'node:assert/strict';
import {
  buildCloseSideEffectIdempotencyKey,
  reconcileCloseSideEffects
} from '../../packages/cli/src/commands/taskflow/close-side-effect-reconcile.ts';
import { executeTaskCloseSaga } from '../../packages/cli/src/commands/taskflow/cross-authority-closeback.ts';

const report = reconcileCloseSideEffects({
  taskId: 'TASK-RESIDUE-0001',
  actorId: 'validator',
  planningSourceIdentityDrift: true,
  sideEffects: [{
    name: 'target-commit',
    status: 'completed',
    idempotencyKey: buildCloseSideEffectIdempotencyKey({
      taskId: 'TASK-RESIDUE-0001',
      actorId: 'validator',
      sideEffect: 'target-commit',
      beforeDigest: 'sha256:target-before'
    }),
    beforeDigest: 'sha256:target-before',
    afterDigest: 'sha256:target-after',
    commitSha: 'target-sha'
  }]
});

assert.equal(report.ok, true);
assert.equal(report.disposition, 'reconciled');
assert.equal(report.replayAllowed, false);

const saga = executeTaskCloseSaga({
  taskId: 'TASK-RESIDUE-0001',
  actorId: 'validator',
  sourceIdentity: 'planning-card:sha256:old',
  targetFiles: ['target.json'],
  planningFiles: ['planning.md'],
  targetBundleDigest: 'sha256:target',
  planningPatchDigest: 'sha256:planning',
  acceptanceEvidenceDigest: 'sha256:evidence'
}, {
  target: { name: 'target', repoRoot: '/target', head: 'target-head', sourceDigest: 'sha256:target-source', writeable: true },
  planning: { name: 'planning', repoRoot: '/planning', head: 'planning-head-moved', sourceDigest: 'sha256:planning-source-moved', writeable: false },
  completedSideEffects: [{
    id: 'target-commit',
    authority: 'target',
    kind: 'commit',
    idempotencyKey: 'target-key',
    status: 'completed',
    commitSha: 'target-sha'
  }]
});

assert.equal(saga.globalCompletion, 'closeback-pending');
assert(saga.blockers.some((blocker) => blocker.summary.includes('Planning authority is not writeable')));
assert(!saga.steps.some((step) => step.id === 'target:commit'), 'residue recovery must not replay the completed target close side effect');

console.log(JSON.stringify({
  marker: '[taskflow-cross-task-residue-recovery.test] ok',
  disposition: report.disposition,
  sagaPhase: saga.phase
}));
