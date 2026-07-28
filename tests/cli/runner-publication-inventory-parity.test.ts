import assert from 'node:assert/strict';
import {
  deriveRunnerBuildOutputInventory,
  verifyRunnerBuildOutputParity
} from '../../packages/core/src/broker/runner-build-output-inventory.ts';
import { buildRunnerSyncReceipt } from '../../scripts/runner-sync-incremental-build.ts';

const inventory = deriveRunnerBuildOutputInventory({
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  observedPaths: [
    'packages/cli/dist/atm.js',
    'release/atm-onefile/atm.mjs',
    'release/atm-root-drop/atm.mjs',
    'docs/ignored.md'
  ],
  currentTaskId: 'TASK-GIT-0017'
});

assert.deepEqual(inventory.entries.map((entry) => entry.path), [
  'packages/cli/dist/atm.js',
  'release/atm-onefile/atm.mjs',
  'release/atm-root-drop/atm.mjs'
]);
assert.equal(verifyRunnerBuildOutputParity(inventory, inventory.entries.map((entry) => entry.path)).ok, true);
assert.deepEqual(
  verifyRunnerBuildOutputParity(inventory, ['packages/cli/dist/atm.js', 'release/atm-onefile/release-manifest.json']).missing,
  ['release/atm-onefile/release-manifest.json']
);

const receipt = buildRunnerSyncReceipt({
  admission: {
    queueHeadOwnership: { waitingTasks: ['TASK-GIT-0017'], stewardWorkId: 'runner-sync-fixture' },
    runnerSyncSteward: {
      requestedSurfaces: [],
      requests: [{ taskId: 'TASK-GIT-0017', actorId: 'captain', requestedSurfaces: [] }]
    }
  } as never,
  actorId: 'captain',
  sealedSourceSha: inventory.sealedSourceSha,
  outputInventory: inventory,
  buildTarget: 'full',
  buildInputsTreeHash: 'sha256:input',
  buildDecision: 'fullRebuild',
  timings: {
    startedAt: 0, inputHashCalculationMs: 0, skipDecisionMs: 0, worktreeSetupMs: 0,
    typescriptBuildMs: 0, rootDropAssemblyMs: 0, onefileAssemblyMs: 0,
    artifactSyncMs: 0, cleanupMs: 0, totalElapsedMs: 0
  }
});
assert.equal(receipt.outputInventory.digest, inventory.digest);
assert.deepEqual(receipt.outputInventory.entries, inventory.entries);
console.log('[runner-publication-inventory-parity.test] ok');
