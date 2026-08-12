import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  captureRunnerBuildOutputSnapshot,
  deriveRunnerBuildOutputInventory,
  evaluateRunnerPublicationDisposition,
  planRunnerPublicationTakeover,
  scanSealedRunnerBuildOutputInventory,
  validateRunnerPublicationTakeoverPlan,
  verifyRunnerBuildOutputParity
} from '../../packages/core/src/broker/runner-build-output-inventory.ts';
import { buildRunnerSyncReceipt } from '../../scripts/runner-sync-incremental-build.ts';
import { syncGeneratedArtifacts } from '../../scripts/run-sealed-runner-build.ts';

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

const pending = evaluateRunnerPublicationDisposition({
  inventory,
  dirtyPaths: [
    'packages/cli/dist/atm.js',
    '.atm/history/evidence/TASK-TMP-0005.residue-reconciliation.json'
  ]
});
assert.equal(pending.disposition, 'publication-pending');
assert.deepEqual(pending.dirtyInventoryPaths, ['packages/cli/dist/atm.js']);
assert.deepEqual(pending.extraOutputPaths, []);

const published = evaluateRunnerPublicationDisposition({
  inventory,
  dirtyPaths: ['packages/cli/dist/atm.js'],
  terminalDisposition: 'published'
});
assert.equal(published.disposition, 'published');
assert.equal(published.ok, true);

const foreignWip = evaluateRunnerPublicationDisposition({
  inventory,
  dirtyPaths: ['release/atm-onefile/release-manifest.json']
});
assert.equal(foreignWip.ok, false);
assert.equal(foreignWip.disposition, 'inventory-incomplete');
assert.deepEqual(foreignWip.extraOutputPaths, ['release/atm-onefile/release-manifest.json']);

const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'atm-runner-inventory-'));
const git = (...args: string[]) => {
  const result = spawnSync('git', args, { cwd: fixtureRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};
mkdirSync(path.join(fixtureRoot, 'release', 'atm-onefile'), { recursive: true });
writeFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'atm.mjs'), 'base\n');
writeFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'release-manifest.json'), 'base\n');
git('init');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'ATM test');
git('add', '.');
git('commit', '-m', 'fixture');
writeFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'release-manifest.json'), 'foreign-wip\n');
writeFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'atm.mjs'), 'stale-generated\n');
const snapshot = captureRunnerBuildOutputSnapshot({
  cwd: fixtureRoot,
  buildTarget: 'onefile',
  currentTaskId: 'TASK-FIXTURE-0011',
  currentTaskAllowedFiles: ['release/atm-onefile/atm.mjs']
});
assert.deepEqual(snapshot.preexistingDirtyPaths, ['release/atm-onefile/release-manifest.json']);
const takeoverPlan = planRunnerPublicationTakeover({
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  snapshot
});
assert.equal(validateRunnerPublicationTakeoverPlan({
  plan: takeoverPlan,
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  snapshot
}).ok, true);
assert.equal(validateRunnerPublicationTakeoverPlan({
  plan: { ...takeoverPlan, sealedSourceSha: 'fedcba9876543210fedcba9876543210fedcba98' },
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  snapshot
}).ok, false);
writeFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'atm.mjs'), 'generated-by-build\n');
const deltaInventory = scanSealedRunnerBuildOutputInventory({
  cwd: fixtureRoot,
  buildTarget: 'onefile',
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  taskId: 'TASK-ERR-0011',
  beforeBuildSnapshot: snapshot
});
assert.deepEqual(deltaInventory.entries.map((entry) => entry.path), [
  '.atm/history/evidence/TASK-ERR-0011.runner-sync-receipt.json',
  'release/atm-onefile/atm.mjs'
]);
const sealedInventory = scanSealedRunnerBuildOutputInventory({
  cwd: fixtureRoot,
  buildTarget: 'onefile',
  sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
  taskId: 'TASK-ERR-0011',
  beforeBuildSnapshot: snapshot,
  includeDirtyPublicationMembers: true
});
assert.deepEqual(sealedInventory.entries.map((entry) => entry.path), [
  '.atm/history/evidence/TASK-ERR-0011.runner-sync-receipt.json',
  'release/atm-onefile/atm.mjs',
  'release/atm-onefile/release-manifest.json'
]);
const sourceRoot = path.join(fixtureRoot, 'build-output');
mkdirSync(path.join(sourceRoot, 'release', 'atm-onefile'), { recursive: true });
writeFileSync(path.join(sourceRoot, 'release', 'atm-onefile', 'atm.mjs'), 'rebuilt\n');
writeFileSync(path.join(sourceRoot, 'release', 'atm-onefile', 'release-manifest.json'), 'would-overwrite\n');
const syncResult = syncGeneratedArtifacts(sourceRoot, fixtureRoot, 'onefile', snapshot.preexistingDirtyPaths);
assert.equal(readFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'atm.mjs'), 'utf8'), 'rebuilt\n');
assert.equal(readFileSync(path.join(fixtureRoot, 'release', 'atm-onefile', 'release-manifest.json'), 'utf8'), 'foreign-wip\n');
assert.deepEqual(syncResult.preservedPaths, ['release/atm-onefile/release-manifest.json']);
console.log('[runner-publication-inventory-parity.test] ok');
