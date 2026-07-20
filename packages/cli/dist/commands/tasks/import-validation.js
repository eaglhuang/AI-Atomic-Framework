import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readTaskLedgerPolicy } from '../task-ledger.js';
export function classifyForceImportAdmission(input) {
    if (!input.force) {
        return {
            emergencyRequired: false,
            blockingFlags: [],
            admissionClass: 'tier1-ledger-ingestion',
            reason: 'No force import flag was requested.',
            taskIds: []
        };
    }
    const taskLedger = readTaskLedgerPolicy(input.cwd);
    const taskStoreDirectory = path.join(input.cwd, taskLedger.taskRoot);
    const conflicts = [];
    const closed = [];
    for (const task of input.tasks) {
        const filePath = path.join(taskStoreDirectory, `${task.workItemId}.json`);
        if (!existsSync(filePath))
            continue;
        try {
            const current = JSON.parse(readFileSync(filePath, 'utf8'));
            if (normalizeStatus(current.status) === 'done') {
                closed.push(task.workItemId);
            }
            if (hasActiveClaim(current)) {
                conflicts.push(task.workItemId);
            }
        }
        catch {
            conflicts.push(task.workItemId);
        }
    }
    if (conflicts.length > 0) {
        return {
            emergencyRequired: true,
            blockingFlags: ['--force'],
            admissionClass: 'task-local-conflict',
            reason: 'Force import would overwrite a task with an active or unreadable claim state.',
            taskIds: conflicts
        };
    }
    if (closed.length > 0) {
        return {
            emergencyRequired: true,
            blockingFlags: ['--force'],
            admissionClass: 'closed-history-overwrite',
            reason: 'Force import would overwrite closed target-authority task history.',
            taskIds: closed
        };
    }
    return {
        emergencyRequired: false,
        blockingFlags: [],
        admissionClass: 'tier1-ledger-ingestion',
        reason: 'Force import only refreshes open task ledger records under .atm/history.',
        taskIds: input.tasks.map((task) => task.workItemId)
    };
}
function hasActiveClaim(taskDocument) {
    const claim = taskDocument.claim;
    if (!claim || typeof claim !== 'object' || Array.isArray(claim))
        return false;
    const state = String(claim.state ?? '').trim().toLowerCase();
    return state !== '' && state !== 'released';
}
function normalizeStatus(value) {
    return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}
