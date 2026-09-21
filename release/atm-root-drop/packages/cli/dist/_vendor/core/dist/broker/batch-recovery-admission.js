import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
function normalizeRelativePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
/** Admit only the exact, actor-bound transition emitted by batch skip/resume. */
export function isAuthorizedBatchRecoveryEvent(cwd, currentTaskId, filePath) {
    if (!currentTaskId)
        return false;
    const normalized = normalizeRelativePath(filePath);
    const match = normalized.match(/^\.atm\/history\/task-events\/([^/]+)\/[^/]+\.json$/i);
    if (!match)
        return false;
    let event = null;
    try {
        const staged = execFileSync(process.env.ATM_GIT_EXECUTABLE || 'git', ['-C', cwd, 'show', `:${normalized}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        event = JSON.parse(staged);
    }
    catch {
        try {
            event = JSON.parse(readFileSync(path.join(cwd, normalized), 'utf8'));
        }
        catch {
            return false;
        }
    }
    const ownerTaskId = match[1].toUpperCase();
    const action = event.action;
    const eventTaskId = typeof event.taskId === 'string' ? event.taskId.trim().toUpperCase() : '';
    const batchId = typeof event.batchId === 'string' ? event.batchId.trim() : '';
    const actorId = typeof event.actorId === 'string' ? event.actorId.trim() : '';
    if (event.schemaId !== 'atm.taskTransition.v1' || !['batch-skip', 'batch-resume'].includes(String(action))
        || eventTaskId !== ownerTaskId || !batchId || !actorId)
        return false;
    let current = null;
    try {
        current = JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${currentTaskId}.json`), 'utf8'));
    }
    catch {
        return false;
    }
    const claim = current.claim && typeof current.claim === 'object' && !Array.isArray(current.claim) ? current.claim : null;
    if (claim?.state !== 'active' || claim.actorId !== actorId)
        return false;
    let batch = null;
    try {
        batch = JSON.parse(readFileSync(path.join(cwd, '.atm', 'runtime', 'batch-runs', `${batchId}.json`), 'utf8'));
    }
    catch {
        return false;
    }
    const taskIds = Array.isArray(batch.taskIds) ? batch.taskIds.map((value) => String(value).trim().toUpperCase()) : [];
    return batch.batchId === batchId
        && ['active', 'completed'].includes(String(batch.status).toLowerCase())
        && taskIds.includes(currentTaskId.trim().toUpperCase())
        && taskIds.includes(ownerTaskId);
}
