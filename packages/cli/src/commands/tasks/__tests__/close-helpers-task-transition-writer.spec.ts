// TASK-RFT-0013 spec — task-transition-writer surface.

import {
  writeTaskDocumentWithTransition,
  buildTaskTransitionCommand,
  createClosureTransitionMetadata
} from '../close-helpers/task-transition-writer.ts';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function fail(msg: string): never {
  console.error(`[close-helpers-task-transition-writer.spec] ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}
function assert(cond: unknown, msg: string) { if (!cond) fail(msg); }

// happy path — buildTaskTransitionCommand exports a function.
assert(typeof buildTaskTransitionCommand === 'function', 'buildTaskTransitionCommand exported');
const cmd = buildTaskTransitionCommand({
  action: 'close',
  taskId: 'TASK-RFT-0013',
  actorId: 'test-actor',
  status: 'done'
});
assert(cmd.includes('tasks close') && cmd.includes('TASK-RFT-0013'), 'command string contains action + task');

// failure — createClosureTransitionMetadata returns null when all inputs are empty.
const empty = createClosureTransitionMetadata(null, null, null, null);
assert(empty === null, 'empty inputs -> null metadata');

// rollback / recovery — metadata builder tolerates minimal input.
const meta = createClosureTransitionMetadata('some/path', null, 'BATCH-1', 'SESS-1');
assert(meta !== null && meta.batchId === 'BATCH-1', 'metadata built from batchId');

// surface — writeTaskDocumentWithTransition is a function.
assert(typeof writeTaskDocumentWithTransition === 'function', 'writeTaskDocumentWithTransition exported');

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-task-transition-writer-'));
try {
  const taskPath = path.join(root, '.atm', 'history', 'tasks', 'TASK-WRITER-0001.json');
  const eventPath = writeTaskDocumentWithTransition({
    cwd: root,
    taskPath,
    taskId: 'TASK-WRITER-0001',
    taskDocument: { id: 'TASK-WRITER-0001', status: 'running' },
    action: 'claim',
    actorId: 'test-actor',
    previousStatus: 'ready'
  });
  assert(existsSync(taskPath), 'atomic writer persisted task document');
  assert(existsSync(path.join(root, eventPath)), 'transition event persisted with task document');
  const persisted = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
  assert(persisted.status === 'running' && typeof persisted.lastTransitionId === 'string', 'persisted task carries transition identity');

  const blockedParent = path.join(root, 'blocked-parent');
  writeFileSync(blockedParent, 'not-a-directory', 'utf8');
  const failedEventDirectory = path.join(root, '.atm', 'history', 'task-events', 'TASK-WRITER-0002');
  let failure: unknown = null;
  try {
    writeTaskDocumentWithTransition({
      cwd: root,
      taskPath: path.join(blockedParent, 'TASK-WRITER-0002.json'),
      taskId: 'TASK-WRITER-0002',
      taskDocument: { id: 'TASK-WRITER-0002', status: 'running' },
      action: 'claim',
      actorId: 'test-actor',
      previousStatus: 'ready'
    });
  } catch (error) {
    failure = error;
  }
  assert((failure as { code?: string } | null)?.code === 'ATM_TASK_LEDGER_WRITE_FAILED', 'write failure is structured');
  assert(!existsSync(failedEventDirectory) || readdirSync(failedEventDirectory).length === 0, 'write failure rolls back transition event');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('[close-helpers-task-transition-writer.spec] ok (8 branches)');
