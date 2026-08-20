import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { canonicalizeValidatorIdentity, detectAutoLinkedValidator } from './validator-classification.js';
import { quoteForShell, isRecord } from './shared-utils.js';
export function evidencePathForTask(cwd, taskId) {
    return path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`);
}
export function taskPathForEvidence(cwd, taskId) {
    return path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
}
export function runnerSyncReceiptPathForTask(cwd, taskId) {
    return path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.runner-sync-receipt.json`);
}
export function readTaskRunnerSyncReceipt(cwd, taskId) {
    const directPath = runnerSyncReceiptPathForTask(cwd, taskId);
    if (existsSync(directPath)) {
        try {
            const parsed = JSON.parse(readFileSync(directPath, 'utf8'));
            if (isRecord(parsed) && parsed.schemaId === 'atm.runnerSyncReceipt.v1')
                return parsed;
        }
        catch {
            // ignore
        }
    }
    const evidenceDir = path.join(cwd, '.atm', 'history', 'evidence');
    if (!existsSync(evidenceDir))
        return null;
    try {
        const files = readdirSync(evidenceDir).filter((f) => f.endsWith('.runner-sync-receipt.json'));
        for (const f of files) {
            const filePath = path.join(evidenceDir, f);
            try {
                const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
                if (isRecord(parsed) && parsed.schemaId === 'atm.runnerSyncReceipt.v1') {
                    const linkedTaskIds = Array.isArray(parsed.linkedTaskIds)
                        ? parsed.linkedTaskIds.filter((id) => typeof id === 'string')
                        : [];
                    const memberTaskIds = Array.isArray(parsed.memberTaskIds)
                        ? parsed.memberTaskIds.filter((id) => typeof id === 'string')
                        : [];
                    if (linkedTaskIds.includes(taskId) || memberTaskIds.includes(taskId) || parsed.taskId === taskId) {
                        return parsed;
                    }
                }
            }
            catch {
                // ignore
            }
        }
    }
    catch {
        // ignore
    }
    return null;
}
export function readTaskDocument(cwd, taskId) {
    const taskPath = taskPathForEvidence(cwd, taskId);
    if (!existsSync(taskPath))
        return null;
    const parsed = JSON.parse(readFileSync(taskPath, 'utf8'));
    return isRecord(parsed) ? parsed : null;
}
export function readEvidenceBundle(cwd, taskId) {
    const evidencePath = evidencePathForTask(cwd, taskId);
    if (!existsSync(evidencePath))
        return { evidence: [] };
    const parsed = JSON.parse(readFileSync(evidencePath, 'utf8'));
    if (!isRecord(parsed))
        return { evidence: [] };
    return { evidence: Array.isArray(parsed.evidence) ? parsed.evidence.filter(isRecord) : [] };
}
export function buildAutoEvidenceRequiredCommand(taskId, actorId, command, gate, runnerKind) {
    const escapedCommand = quoteForShell(command);
    const escapedGate = quoteForShell(gate);
    const linked = detectAutoLinkedValidator(command);
    if (linked && linked === canonicalizeValidatorIdentity(gate)) {
        return `node atm.mjs evidence run --task ${taskId} --actor ${actorId} --command ${escapedCommand} --runner-kind ${runnerKind} --json`;
    }
    return `node atm.mjs evidence run --task ${taskId} --actor ${actorId} --command ${escapedCommand} --validators ${escapedGate} --runner-kind ${runnerKind} --json`;
}
