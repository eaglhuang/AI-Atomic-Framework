import assert from 'node:assert/strict';
import { evaluateRunnerPublicationContinuation } from './runner-publication-lifecycle.js';
import { authorizesRunnerPublicationCloseCommit, resolveRunnerPublicationCloseHandoff } from './runner-publication-close-handoff.js';
import { deriveRunnerBuildOutputInventory } from '../../../../core/dist/broker/runner-build-output-inventory.js';
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
    outputInventory,
    linkedTaskIds: ['ATM-GOV-0344'],
    memberTaskIds: ['ATM-GOV-0344'],
    groupManifest: { memberTaskIds: ['ATM-GOV-0344'] },
    childAttribution: { complete: true, members: [{ taskId: 'ATM-GOV-0344' }] }
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
const linkedProducerInventory = deriveRunnerBuildOutputInventory({
    sealedSourceSha: 'a'.repeat(40),
    observedPaths: ['packages/cli/dist/atm.js'],
    currentTaskId: 'ATM-FRAMEWORK-TEMP-producer',
    ownership: [{ path: 'packages/cli/dist/atm.js', ownerTaskId: 'ATM-FRAMEWORK-TEMP-producer' }]
});
const linkedProducerReceipt = {
    schemaId: 'atm.runnerSyncReceipt.v1',
    taskId: 'ATM-GOV-0344',
    linkedTaskIds: ['ATM-GOV-0344'],
    memberTaskIds: ['ATM-FRAMEWORK-TEMP-producer'],
    groupManifest: { memberTaskIds: ['ATM-FRAMEWORK-TEMP-producer'] },
    childAttribution: { complete: true, members: [{ taskId: 'ATM-FRAMEWORK-TEMP-producer' }] },
    outputInventory: linkedProducerInventory
};
assert.equal(resolveRunnerPublicationCloseHandoff({ taskId: 'ATM-GOV-0344', receipt: linkedProducerReceipt }).ok, true, 'durably linked, completely attributed producer output is closeable after its temporary lease is released');
assert.equal(resolveRunnerPublicationCloseHandoff({
    taskId: 'ATM-GOV-0344',
    receipt: { ...linkedProducerReceipt, childAttribution: { complete: false, members: [{ taskId: 'ATM-FRAMEWORK-TEMP-producer' }] } }
}).ok, false, 'incomplete producer attribution must remain fail-closed');
assert.equal(resolveRunnerPublicationCloseHandoff({
    taskId: 'ATM-GOV-0344',
    receipt: { ...linkedProducerReceipt, linkedTaskIds: ['ATM-GOV-OTHER'] }
}).ok, false, 'a producer group cannot be reused by an unrelated closing task');
assert.equal(authorizesRunnerPublicationCloseCommit({
    taskId: 'ATM-GOV-OTHER',
    receipt,
    criticalChangedFiles: ['packages/cli/dist/atm.js']
}), false);
console.log('[runner-publication-lifecycle] continuation contract assertions passed.');
