import { createRunnerVersionRegistry, selectRunnerVersionWithReceipt } from '../../_vendor/core/dist/broker/runner-version-registry.js';
import { RUNNER_SYNC_ERROR_CODES } from '../../_vendor/core/dist/broker/runner-version-contract.js';
export function buildRunnerSelectionEvidence(input) {
    const registry = createRunnerVersionRegistry(input.registrySnapshot?.versions ?? input.publishedVersions);
    const receipt = selectRunnerVersionWithReceipt(registry, input.requirement, input.issuedAt, {
        policyVersion: input.registrySnapshot?.policyVersion,
        registrySnapshotDigest: input.registrySnapshot?.snapshotDigest,
        shadowFeedbackSink: input.shadowFeedbackSink
    });
    const selection = receipt.selection;
    const closeReady = selection.errorCode === null && (selection.outcome === 'exact-seal-match' || selection.outcome === 'aggregate-hash-match');
    const requiredCommand = closeReady
        ? null
        : `node atm.mjs broker runner-sync enqueue --task ${JSON.stringify(input.taskId)} --sealed-source-sha ${JSON.stringify(input.requirement.sealedSourceSha)} --json`;
    return {
        schemaId: 'atm.runnerSelectionEvidence.v1',
        taskId: input.taskId,
        receipt,
        closeReady,
        errorCode: selection.errorCode,
        requiredCommand,
        reason: closeReady
            ? `Runner version selected (${selection.outcome}); close-readiness satisfied.`
            : `${selection.errorCode ?? RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired}: ${selection.reason}`
    };
}
