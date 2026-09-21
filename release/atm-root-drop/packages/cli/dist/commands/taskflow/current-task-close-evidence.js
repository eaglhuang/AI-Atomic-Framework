import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
function normalizeTaskId(taskId) {
    return taskId.trim();
}
function normalizeRelativePath(filePath) {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}
/**
 * The supported evidence types are a closed contract.  Callers must not infer
 * ownership from a broad task-id glob because unknown evidence needs to remain
 * visible to fail-closed closeout diagnostics.
 */
export function buildCurrentTaskCloseEvidence(taskId) {
    const normalizedTaskId = normalizeTaskId(taskId);
    const evidenceRoot = `.atm/history/evidence/${normalizedTaskId}`;
    return {
        schemaId: 'atm.taskflowCurrentCloseEvidence.v1',
        taskId: normalizedTaskId,
        supportedPaths: [
            `${evidenceRoot}.json`,
            `${evidenceRoot}.bundle-manifest.json`,
            `${evidenceRoot}.closure-packet.json`,
            `${evidenceRoot}.live-index-reconciliation.json`,
            `${evidenceRoot}.runner-publication-takeover.json`,
            `${evidenceRoot}.runner-sync-receipt.json`,
            `${evidenceRoot}.seal-and-commit.json`
        ]
    };
}
export function isCurrentTaskCloseEvidenceFile(taskId, filePath) {
    const evidence = buildCurrentTaskCloseEvidence(taskId);
    const normalizedFile = normalizeRelativePath(filePath);
    return evidence.supportedPaths.some((supportedPath) => normalizeRelativePath(supportedPath) === normalizedFile);
}
export function listCurrentTaskCloseEvidenceFiles(root, taskId) {
    return buildCurrentTaskCloseEvidence(taskId).supportedPaths
        .filter((relativePath) => existsSync(path.join(root, relativePath)))
        .filter((relativePath) => hasSemanticTaskIdentity(root, relativePath, taskId));
}
function hasSemanticTaskIdentity(root, relativePath, taskId) {
    if (!relativePath.endsWith('.runner-publication-takeover.json'))
        return true;
    try {
        const document = JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
        return String(document.taskId ?? '').trim() === taskId.trim();
    }
    catch {
        return false;
    }
}
