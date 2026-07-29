import assert from 'node:assert/strict';
import { executeTaskCloseSaga } from '../../packages/cli/src/commands/taskflow/cross-authority-closeback.ts';

const sideEffects = [
  { id: 'target-commit', authority: 'target' as const, kind: 'commit' as const, idempotencyKey: 'target-key', status: 'completed' as const, commitSha: 'target-sha' },
  { id: 'planning-commit', authority: 'planning' as const, kind: 'commit' as const, idempotencyKey: 'planning-key', status: 'completed' as const, commitSha: 'planning-sha' }
];

const baseRequest = {
  taskId: 'TASK-REMOTE-0001',
  actorId: 'validator',
  sourceIdentity: 'card:sha256:remote',
  targetFiles: ['target.json'],
  planningFiles: ['planning.md'],
  targetBundleDigest: 'sha256:target',
  planningPatchDigest: 'sha256:planning',
  planStatusTransition: 'active->done',
  acceptanceEvidenceDigest: 'sha256:evidence'
};

const localOnly = executeTaskCloseSaga(baseRequest, {
  target: {
    name: 'target',
    repoRoot: '/target',
    head: 'target-head',
    writeable: true,
    remoteVisibilityRequired: true,
    canonicalRemote: 'origin',
    canonicalRef: 'refs/heads/main'
  },
  planning: {
    name: 'planning',
    repoRoot: '/planning',
    head: 'planning-head',
    writeable: true,
    remoteVisibilityRequired: true,
    canonicalRemote: 'origin',
    canonicalRef: 'refs/heads/master',
    remoteReachableCommit: 'planning-sha'
  },
  completedSideEffects: sideEffects
});

assert.equal(localOnly.globalCompletion, 'closeback-pending');
assert(localOnly.blockers.some((blocker) => blocker.summary.includes('Target authority commit is local-durable')));
assert(localOnly.steps.some((step) => step.id === 'target:remote-visibility'));

const dataDrivenNoRemoteRequirement = executeTaskCloseSaga(baseRequest, {
  target: {
    name: 'target',
    repoRoot: '/target',
    head: 'target-head',
    writeable: true,
    remoteVisibilityRequired: false
  },
  planning: {
    name: 'planning',
    repoRoot: '/planning',
    head: 'planning-head',
    writeable: true,
    remoteVisibilityRequired: false
  },
  completedSideEffects: sideEffects
});

assert.equal(dataDrivenNoRemoteRequirement.globalCompletion, 'complete');
assert(!dataDrivenNoRemoteRequirement.steps.some((step) => step.kind === 'remote-visibility'), 'remote checks must come from manifest data, not hardcoded repo assumptions');

console.log(JSON.stringify({
  marker: '[taskflow-cross-authority-remote-durability.test] ok',
  localOnly: localOnly.globalCompletion,
  dataDrivenNoRemoteRequirement: dataDrivenNoRemoteRequirement.globalCompletion
}));
