import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRunnerBuildOutputInventory,
} from '../../../../../core/src/broker/runner-build-output-inventory.ts';
import { resolvePublicationDeliverySlice } from '../../../../../core/src/git/publication-delivery-slice.ts';
import { pathMatchesTaskScope } from '../commit-scope-policy.ts';
import { resolveTaskScopedCommitBundle } from './commit-bundle-resolution.ts';

const SHA = '194c7670d0f046de5ee707be9be14afb2eabda7a';
const TASK_ID = 'TASK-SLICE-0001';

function pathInScope(filePath: string, scope: string): boolean {
  return pathMatchesTaskScope(filePath, scope);
}

function buildPublishedReceipt(input: {
  readonly outputPaths: readonly string[];
  readonly publicationDisposition?: string;
  readonly sealedSourceSha?: string;
}): Record<string, unknown> {
  const inventory = buildRunnerBuildOutputInventory({
    sealedSourceSha: input.sealedSourceSha ?? SHA,
    outputPaths: input.outputPaths,
    currentTaskId: TASK_ID,
    ownership: input.outputPaths.map((outputPath) => ({
      path: outputPath,
      ownerTaskId: TASK_ID,
      leaseFresh: true,
    })),
  });
  return {
    schemaId: 'atm.runnerSyncReceipt.v1',
    taskId: TASK_ID,
    publicationDisposition: input.publicationDisposition ?? 'published',
    sealedSourceSha: inventory.sealedSourceSha,
    outputInventory: inventory,
  };
}

const inventoryPaths = [
  'packages/cli/dist/atm.d.ts',
  'packages/cli/dist/gone.d.ts',
  'release/atm-onefile/atm.mjs',
];
const published = buildPublishedReceipt({ outputPaths: inventoryPaths });
const inventory = published.outputInventory as { digest: string };
const manifest = {
  schemaId: 'atm.publicationDeliverySliceManifest.v1',
  receiptPath: `.atm/history/evidence/${TASK_ID}.runner-sync-receipt.json`,
  expectedSealedSourceSha: SHA,
  expectedInventoryDigest: inventory.digest,
  expectedPublicationDisposition: 'published',
};

const happy = resolvePublicationDeliverySlice({
  manifest,
  receipt: published,
  dirtyPaths: [
    'packages/cli/dist/atm.d.ts',
    'packages/cli/dist/gone.d.ts',
    'release/atm-onefile/atm.mjs',
    'docs/reports/plan-closeback.json',
    `.atm/history/evidence/${TASK_ID}.runner-sync-receipt.json`,
    `.atm/history/tasks/${TASK_ID}.json`,
  ],
  allowedScope: [
    ...inventoryPaths,
    'docs/reports/plan-closeback.json',
    `.atm/history/evidence/${TASK_ID}.*`,
    `.atm/history/tasks/${TASK_ID}.json`,
  ],
  pathMatchesScope: pathInScope,
});
assert.equal(happy.ok, true);
assert.deepEqual(happy.inventoryMembers, inventoryPaths);
assert.ok(happy.stageFiles.includes('packages/cli/dist/gone.d.ts'));
assert.ok(happy.stageFiles.includes(`.atm/history/evidence/${TASK_ID}.runner-sync-receipt.json`));
assert.ok(!happy.stageFiles.includes('docs/reports/plan-closeback.json'));

const unpublished = resolvePublicationDeliverySlice({
  manifest,
  receipt: buildPublishedReceipt({ outputPaths: inventoryPaths, publicationDisposition: 'publication-pending' }),
  dirtyPaths: inventoryPaths,
  allowedScope: inventoryPaths,
  pathMatchesScope: pathInScope,
});
assert.equal(unpublished.ok, false);
assert.equal(unpublished.code, 'ATM_GIT_COMMIT_DELIVERY_SLICE_NOT_PUBLISHED');

const recoveryRetained = {
  ...buildPublishedReceipt({ outputPaths: inventoryPaths, publicationDisposition: 'recovery-retained' }),
  recoveryRetainedPaths: ['packages/cli/dist/gone.d.ts'],
};
const recoveryManifest = {
  ...manifest,
  expectedPublicationDisposition: 'recovery-retained',
};
const recoverySlice = resolvePublicationDeliverySlice({
  manifest: recoveryManifest,
  receipt: recoveryRetained,
  dirtyPaths: [...inventoryPaths, 'docs/reports/plan-closeback.json'],
  allowedScope: [...inventoryPaths, 'docs/reports/plan-closeback.json'],
  pathMatchesScope: pathInScope,
});
assert.equal(recoverySlice.ok, true);
assert.deepEqual(recoverySlice.inventoryMembers, ['packages/cli/dist/gone.d.ts']);
assert.ok(!recoverySlice.stageFiles.includes('packages/cli/dist/atm.d.ts'));
assert.ok(!recoverySlice.stageFiles.includes('docs/reports/plan-closeback.json'));

const recoveryWithoutPaths = resolvePublicationDeliverySlice({
  manifest: recoveryManifest,
  receipt: buildPublishedReceipt({ outputPaths: inventoryPaths, publicationDisposition: 'recovery-retained' }),
  dirtyPaths: inventoryPaths,
  allowedScope: inventoryPaths,
  pathMatchesScope: pathInScope,
});
assert.equal(recoveryWithoutPaths.ok, false);
assert.equal(recoveryWithoutPaths.code, 'ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID');

const shaMismatch = resolvePublicationDeliverySlice({
  manifest: { ...manifest, expectedSealedSourceSha: 'deadbeef' },
  receipt: published,
  dirtyPaths: inventoryPaths,
  allowedScope: inventoryPaths,
  pathMatchesScope: pathInScope,
});
assert.equal(shaMismatch.ok, false);
assert.equal(shaMismatch.code, 'ATM_GIT_COMMIT_DELIVERY_SLICE_MANIFEST_MISMATCH');

const outOfScope = resolvePublicationDeliverySlice({
  manifest,
  receipt: published,
  dirtyPaths: inventoryPaths,
  allowedScope: ['release/atm-onefile/atm.mjs'],
  pathMatchesScope: pathInScope,
});
assert.equal(outOfScope.ok, false);
assert.equal(outOfScope.code, 'ATM_GIT_COMMIT_DELIVERY_SLICE_OUT_OF_SCOPE');

const foreignDirty = resolvePublicationDeliverySlice({
  manifest,
  receipt: published,
  dirtyPaths: [...inventoryPaths, 'packages/cli/dist/foreign.js'],
  allowedScope: [...inventoryPaths, 'packages/cli/dist/foreign.js'],
  pathMatchesScope: pathInScope,
});
assert.equal(foreignDirty.ok, false);
assert.equal(foreignDirty.code, 'ATM_GIT_COMMIT_DELIVERY_SLICE_FOREIGN_DIRTY');

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-delivery-slice-'));
execFileSync('git', ['init', '-q'], { cwd });
execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd });
execFileSync('git', ['config', 'user.name', 'ATM Test'], { cwd });
for (const relative of [
  'packages/cli/dist',
  'release/atm-onefile',
  'docs/reports',
  '.atm/history/evidence',
  '.atm/history/tasks',
  '.atm/catalog/registry',
]) {
  mkdirSync(path.join(cwd, relative), { recursive: true });
}
writeFileSync(path.join(cwd, 'packages/cli/dist/atm.d.ts'), 'export {}\n');
writeFileSync(path.join(cwd, 'packages/cli/dist/gone.d.ts'), 'export {}\n');
writeFileSync(path.join(cwd, 'release/atm-onefile/atm.mjs'), 'export {}\n');
writeFileSync(path.join(cwd, 'docs/reports/plan-closeback.json'), '{"closeback":true}\n');
writeFileSync(path.join(cwd, '.atm/catalog/registry/actors.json'), '{"actors":[]}\n');
writeFileSync(path.join(cwd, `.atm/history/evidence/${TASK_ID}.runner-sync-receipt.json`), `${JSON.stringify(published)}\n`);
writeFileSync(
  path.join(cwd, `.atm/history/tasks/${TASK_ID}.json`),
  `${JSON.stringify({
    workItemId: TASK_ID,
    status: 'running',
    scopePaths: [
      ...inventoryPaths,
      'docs/reports/plan-closeback.json',
      `.atm/history/evidence/${TASK_ID}.*`,
      `.atm/history/tasks/${TASK_ID}.json`,
    ],
    claim: {
      actorId: 'test-actor',
      leaseId: 'lease-slice',
      claimedAt: '2026-08-18T00:00:00.000Z',
      heartbeatAt: new Date().toISOString(),
      ttlSeconds: 3600,
      files: [
        ...inventoryPaths,
        'docs/reports/plan-closeback.json',
        `.atm/history/evidence/${TASK_ID}.*`,
        `.atm/history/tasks/${TASK_ID}.json`,
      ],
      state: 'active',
    },
  })}\n`,
);
execFileSync('git', ['add', '.'], { cwd });
execFileSync('git', ['commit', '-qm', 'fixture'], { cwd });
writeFileSync(path.join(cwd, 'packages/cli/dist/atm.d.ts'), 'export { atm: true }\n');
rmSync(path.join(cwd, 'packages/cli/dist/gone.d.ts'));
writeFileSync(path.join(cwd, 'release/atm-onefile/atm.mjs'), 'export { built: true }\n');
writeFileSync(path.join(cwd, 'docs/reports/plan-closeback.json'), '{"closeback":"dirty"}\n');
writeFileSync(path.join(cwd, '.atm/catalog/registry/actors.json'), '{"actors":["other-task"]}\n');
writeFileSync(path.join(cwd, `.atm/history/evidence/${TASK_ID}.runner-sync-receipt.json`), `${JSON.stringify(published)}\n`);
const manifestPath = path.join(cwd, '.atm', 'history', 'evidence', `${TASK_ID}.delivery-slice.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

const bundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: TASK_ID,
  actorId: 'test-actor',
  taskDocument: JSON.parse(readFileSync(path.join(cwd, `.atm/history/tasks/${TASK_ID}.json`), 'utf8')),
  message: 'fixture',
  trailers: [],
  apply: false,
  autoStage: true,
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
  deliverySliceManifestPath: `.atm/history/evidence/${TASK_ID}.delivery-slice.json`,
});
assert.equal(bundle.ok, true, `${bundle.blockedCode} ${bundle.blockedSummary}`);
assert.ok(bundle.stageFiles.includes('packages/cli/dist/atm.d.ts'));
assert.ok(bundle.stageFiles.includes('packages/cli/dist/gone.d.ts'));
assert.ok(bundle.stageFiles.includes('release/atm-onefile/atm.mjs'));
assert.ok(!bundle.stageFiles.includes('docs/reports/plan-closeback.json'));
assert.ok(!bundle.stageFiles.includes('.atm/catalog/registry/actors.json'));

const receiptDerivedBundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: TASK_ID,
  actorId: 'test-actor',
  taskDocument: JSON.parse(readFileSync(path.join(cwd, `.atm/history/tasks/${TASK_ID}.json`), 'utf8')),
  message: 'fixture',
  trailers: [],
  apply: false,
  autoStage: true,
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
  deliverySliceReceiptPath: `.atm/history/evidence/${TASK_ID}.runner-sync-receipt.json`,
});
assert.equal(receiptDerivedBundle.ok, true, `${receiptDerivedBundle.blockedCode} ${receiptDerivedBundle.blockedSummary}`);
assert.deepEqual(receiptDerivedBundle.stageFiles, bundle.stageFiles);
assert.ok(!receiptDerivedBundle.stageFiles.includes('.atm/catalog/registry/actors.json'));

const foreignReceiptBundle = resolveTaskScopedCommitBundle({
  cwd,
  taskId: TASK_ID,
  actorId: 'test-actor',
  taskDocument: JSON.parse(readFileSync(path.join(cwd, `.atm/history/tasks/${TASK_ID}.json`), 'utf8')),
  message: 'fixture',
  trailers: [],
  apply: false,
  autoStage: true,
  deferForeignStaged: false,
  stageOverrideLease: null,
  brokerConflictResolutionPath: null,
  deliverySliceReceiptPath: '.atm/history/evidence/FOREIGN.runner-sync-receipt.json',
});
assert.equal(foreignReceiptBundle.ok, false);
assert.equal(foreignReceiptBundle.blockedCode, 'ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID');

rmSync(cwd, { recursive: true, force: true });
