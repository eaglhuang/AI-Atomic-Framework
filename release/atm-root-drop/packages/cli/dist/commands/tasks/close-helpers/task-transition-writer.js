// TASK-RFT-0013 — extracted verbatim from packages/cli/src/commands/tasks.ts.
// Task-transition writer cluster: persist a task document with a governed
// transition event. Re-exports the transition-command builder and the closure
// metadata builder from the existing task-transition-helpers module so all
// four close-transition symbols now live under close-helpers/.
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CliError, parseJsonText } from '../../shared.js';
import { appendTaskTransitionEvent, createTaskTransitionId } from '../../task-ledger.js';
import { normalizeTaskDocumentId } from '../normalize-task-document-id-helper.js';
import { taskIdsEqual } from '../task-import-validators.js';
function writeTaskDocument(taskPath, document) {
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(taskPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}
export { buildTaskTransitionCommand, createClosureTransitionMetadata } from '../task-transition-helpers.js';
function verifyPersistedTaskDocument(input) {
    let persisted;
    try {
        persisted = parseJsonText(readFileSync(input.taskPath, 'utf8'));
    }
    catch (error) {
        throw new CliError('ATM_TASK_LEDGER_WRITE_INVALID_JSON', `Task ${input.taskId} was written by ${input.action}, but the persisted JSON is unreadable.`, {
            details: {
                taskId: input.taskId,
                taskPath: input.taskPath,
                action: input.action,
                reason: error instanceof Error ? error.message : String(error)
            }
        });
    }
    const persistedTaskId = normalizeTaskDocumentId(persisted, path.basename(input.taskPath, '.json'));
    const persistedStatus = typeof persisted.status === 'string' ? persisted.status : null;
    if (!taskIdsEqual(persistedTaskId, input.taskId) || persistedStatus !== input.expectedStatus) {
        throw new CliError('ATM_TASK_LEDGER_WRITE_MISMATCH', `Task ${input.taskId} persisted an unexpected state after ${input.action}.`, {
            details: {
                taskId: input.taskId,
                taskPath: input.taskPath,
                action: input.action,
                expectedStatus: input.expectedStatus,
                persistedTaskId,
                persistedStatus
            }
        });
    }
}
export function writeTaskDocumentWithTransition(input) {
    const nextStatus = typeof input.taskDocument.status === 'string' ? input.taskDocument.status : null;
    const createdAt = new Date().toISOString();
    const transitionId = createTaskTransitionId({
        createdAt,
        taskId: input.taskId,
        action: input.action,
        taskDocument: input.taskDocument
    });
    input.taskDocument.lastTransitionId = transitionId;
    input.taskDocument.lastTransitionAt = createdAt;
    input.taskDocument.ledgerContractVersion = 'task-ledger/v1';
    const transition = appendTaskTransitionEvent({
        cwd: input.cwd,
        taskId: input.taskId,
        action: input.action,
        actorId: input.actorId,
        sessionId: input.sessionId ?? null,
        fromStatus: input.previousStatus,
        toStatus: nextStatus,
        taskPath: input.taskPath,
        taskDocument: input.taskDocument,
        command: input.command ?? `node atm.mjs tasks ${input.action}`,
        closureMetadata: input.closureMetadata ?? null,
        createdAt,
        transitionId
    });
    writeTaskDocument(input.taskPath, input.taskDocument);
    verifyPersistedTaskDocument({
        taskPath: input.taskPath,
        taskId: input.taskId,
        expectedStatus: nextStatus,
        action: input.action
    });
    return transition.eventPath;
}
