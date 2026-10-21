import assert from 'node:assert/strict';
import {
  isRunnerBuildOutputPath, isRunnerPublicationArtifactPath,
  planRunnerPublicationTakeover
} from '../../packages/core/src/broker/runner-build-output-inventory.ts';
import { isLockBackedRunnerPublicationEvidence } from '../../packages/cli/src/commands/framework-development/runner-publication-evidence-context.ts';

const member = 'packages/create-atm/dist/build-identity.json';
const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
assert.equal(isRunnerBuildOutputPath(member), true);
assert.equal(isRunnerPublicationArtifactPath(member), true);
for (const file of ['packages/core/src/index.ts', 'packages/core/dist/../src/index.ts',
  'packages/../dist/x', 'packages/core/dist', 'other/dist/x', 'docs/file.md']) {
  assert.equal(isRunnerPublicationArtifactPath(file), false, file);
}
const snapshot = {
  schemaId: 'atm.runnerBuildOutputSnapshot.v1' as const,
  buildTarget: 'full' as const,
  members: { [member]: digest }, preexistingDirtyPaths: [member]
};
const plan = planRunnerPublicationTakeover({ sealedSourceSha: sha, snapshot });
assert.deepEqual(plan.entries, [{path: member, observedDigest: digest}]);
assert.equal(isLockBackedRunnerPublicationEvidence(
  '.atm/history/evidence/TASK-PACKAGE.runner-publication-takeover.json',
  {...plan, taskId: 'TASK-PACKAGE'}, 'TASK-PACKAGE'
), true);
assert.equal(isLockBackedRunnerPublicationEvidence(
  '.atm/history/evidence/TASK-PACKAGE.runner-publication-takeover.json',
  {...plan, entries: [{path:'packages/core/src/index.ts', observedDigest:digest}]}, 'TASK-PACKAGE'
), false);
console.log('[package-publication-membership] ok');
