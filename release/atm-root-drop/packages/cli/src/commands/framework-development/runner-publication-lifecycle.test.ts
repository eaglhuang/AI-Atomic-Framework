import assert from 'node:assert/strict';
import { evaluateRunnerPublicationContinuation } from './runner-publication-lifecycle.ts';
import { authorizesRunnerPublicationCloseCommit, resolveRunnerPublicationCloseHandoff } from './runner-publication-close-handoff.ts';
import { deriveRunnerBuildOutputInventory } from '../../../../core/src/broker/runner-build-output-inventory.ts';

const valid = evaluateRunnerPublicationContinuation({
  taskId: 'ATM-GOV-0344',
  queueMemberTaskIds: ['ATM-GOV-0344', 'ATM-GOV-0346'],
  stewardWorkId: 'runner-sync-fixture',
  queueHeadStewardWorkId: 'runner-sync-fixture',
  sealedSourceSha: 'a'.repeat(40),
  receiptSealedSourceSha: 'a'.repeat(40),
  receiptDigest: `sha256:${'b'.repeat(64)}`,
  inventoryDigest: `sha256:${'c'.repeat(64)}`,
  receiptInventoryDigest: `sha256:${'c'.repeat(64)}`,
});
assert.equal(valid.allowed, true, valid.reason);

const wrongQueue = evaluateRunnerPublicationContinuation({
  taskId: 'ATM-GOV-0344',
  queueMemberTaskIds: ['ATM-GOV-0344'],
  stewardWorkId: 'runner-sync-fixture',
  queueHeadStewardWorkId: 'runner-sync-other',
  sealedSourceSha: 'a'.repeat(40),
  receiptSealedSourceSha: 'a'.repeat(40),
  receiptDigest: `sha256:${'b'.repeat(64)}`,
  inventoryDigest: `sha256:${'c'.repeat(64)}`,
  receiptInventoryDigest: `sha256:${'c'.repeat(64)}`,
});
assert.equal(wrongQueue.allowed, false);
assert.equal(wrongQueue.code, 'ATM_RUNNER_PUBLICATION_CONTINUATION_MISMATCH');

const alteredInventory = evaluateRunnerPublicationContinuation({
  taskId: 'ATM-GOV-0344',
  queueMemberTaskIds: ['ATM-GOV-0344'],
  stewardWorkId: 'runner-sync-fixture',
  queueHeadStewardWorkId: 'runner-sync-fixture',
  sealedSourceSha: 'a'.repeat(40),
  receiptSealedSourceSha: 'a'.repeat(40),
  receiptDigest: `sha256:${'b'.repeat(64)}`,
  inventoryDigest: `sha256:${'c'.repeat(64)}`,
  receiptInventoryDigest: `sha256:${'d'.repeat(64)}`,
});
assert.equal(alteredInventory.allowed, false);
assert.equal(alteredInventory.code, 'ATM_RUNNER_PUBLICATION_CONTINUATION_MISMATCH');

const outputInventory = deriveRunnerBuildOutputInventory({
  sealedSourceSha: 'a'.repeat(40),
  observedPaths: ['packages/cli/dist/atm.js', 'release/atm-onefile/atm.mjs'],
  currentTaskId: 'ATM-GOV-0344',
  ownership: [
    { path: 'packages/cli/dist/atm.js', ownerTaskId: 'ATM-GOV-0344' },
    { path: 'release/atm-onefile/atm.mjs', ownerTaskId: 'ATM-GOV-0344' }
  ]
});
const receipt = {
  schemaId: 'atm.runnerSyncReceipt.v1',
  taskId: 'ATM-GOV-0344',
  outputInventory
};
assert.equal(authorizesRunnerPublicationCloseCommit({
  taskId: 'ATM-GOV-0344',
  receipt,
  criticalChangedFiles: ['packages/cli/dist/atm.js', 'release/atm-onefile/atm.mjs']
}), true);
assert.equal(authorizesRunnerPublicationCloseCommit({
  taskId: 'ATM-GOV-0344',
  receipt,
  criticalChangedFiles: ['packages/cli/dist/atm.js', 'release/foreign.mjs']
}), false);
assert.equal(authorizesRunnerPublicationCloseCommit({
  taskId: 'ATM-GOV-OTHER',
  receipt,
  criticalChangedFiles: ['packages/cli/dist/atm.js']
}), false);

console.log('[runner-publication-lifecycle] continuation contract assertions passed.');
