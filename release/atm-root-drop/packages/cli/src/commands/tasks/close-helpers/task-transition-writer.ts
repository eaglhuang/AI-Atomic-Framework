// TASK-RFT-0013 — extracted verbatim from packages/cli/src/commands/tasks.ts.
// Task-transition writer cluster: persist a task document with a governed
// transition event. Re-exports the transition-command builder and the closure
// metadata builder from the existing task-transition-helpers module so all
// four close-transition symbols now live under close-helpers/.

import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CliError, parseJsonText } from '../../shared.ts';
import { appendTaskTransitionEvent, createTaskTransitionId, type TaskTransitionClosureMetadata } from '../../task-ledger.ts';
import { normalizeTaskDocumentId } from '../normalize-task-document-id-helper.ts';
import { taskIdsEqual } from '../task-import-validators.ts';

function writeTaskDocument(taskPath: string, document: Record<string, unknown>) {
  mkdirSync(path.dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

export {
  buildTaskTransitionCommand,
  createClosureTransitionMetadata
} from '../task-transition-helpers.ts';

function verifyPersistedTaskDocument(input: {
  readonly taskPath: string;
  readonly taskId: string;
  readonly expectedStatus: string | null;
  readonly action: string;
}) {
  let persisted: Record<string, unknown>;
  try {
    persisted = parseJsonText(readFileSync(input.taskPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
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

export function writeTaskDocumentWithTransition(input: {
  readonly cwd: string;
  readonly taskPath: string;
  readonly taskId: string;
  readonly taskDocument: Record<string, unknown>;
  readonly action: string;
  readonly actorId: string | null;
  readonly sessionId?: string | null;
  readonly previousStatus: string | null;
  readonly closureMetadata?: TaskTransitionClosureMetadata | null;
  readonly command?: string;
}) {
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
