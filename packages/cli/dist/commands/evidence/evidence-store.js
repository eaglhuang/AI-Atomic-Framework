import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalizeValidatorIdentity, detectAutoLinkedValidator } from './validator-classification.js';
import { quoteForShell, isRecord } from './shared-utils.js';
export function evidencePathForTask(cwd, taskId) {
    return path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`);
}
export function taskPathForEvidence(cwd, taskId) {
    return path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
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
