import {
  advanceTaskQueueHead,
  createOrRefreshTaskQueue,
  findActiveTaskQueue,
  type TaskDirectionTask
} from '../task-direction.ts';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listActiveBatchRuns, readBatchRunById, writeBatchRun } from '../work-channels.ts';

function fail(message: string): never {
  console.error(`[task-direction-queue.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function task(overrides: Partial<TaskDirectionTask> & Pick<TaskDirectionTask, 'workItemId' | 'title'>): TaskDirectionTask {
  return {
    workItemId: overrides.workItemId,
    title: overrides.title,
    dependencies: overrides.dependencies ?? [],
    taskPath: overrides.taskPath ?? `.atm/history/tasks/${overrides.workItemId}.json`,
    sourcePlanPath: overrides.sourcePlanPath ?? null,
    nearbyPlanPaths: overrides.nearbyPlanPaths ?? [],
    scopePaths: overrides.scopePaths ?? ['docs/**'],
    targetRepo: overrides.targetRepo ?? 'AI-Atomic-Framework',
    allowPlanningMirror: overrides.allowPlanningMirror ?? false,
    outOfScope: overrides.outOfScope ?? []
  };
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-task-direction-queue-'));

const reordered = createOrRefreshTaskQueue({
  cwd: repo,
  sourcePrompt: 'SKL batch ordering regression',
  tasks: [
    task({ workItemId: 'TASK-SKL-0005', title: 'tool-first migration', dependencies: ['TASK-SKL-0007'] }),
    task({ workItemId: 'TASK-SKL-0007', title: 'shared growth contract' }),
    task({ workItemId: 'TASK-SKL-0008', title: 'team role contract', dependencies: ['TASK-SKL-0005', 'TASK-SKL-0007'] })
  ]
});
assert(
  JSON.stringify(reordered.taskIds) === JSON.stringify(['TASK-SKL-0007', 'TASK-SKL-0005', 'TASK-SKL-0008']),
  'queue should place in-queue dependencies before dependents while preserving stable order'
);
assert(reordered.currentIndex === 0, 'new dependency-ordered queue must start at index 0');

const cyclic = createOrRefreshTaskQueue({
  cwd: mkdtempSync(path.join(os.tmpdir(), 'atm-task-direction-queue-cycle-')),
  sourcePrompt: 'SKL cyclic ordering regression',
  tasks: [
    task({ workItemId: 'TASK-A', title: 'A', dependencies: ['TASK-B'] }),
    task({ workItemId: 'TASK-B', title: 'B', dependencies: ['TASK-A'] })
  ]
});
assert(
  JSON.stringify(cyclic.taskIds) === JSON.stringify(['TASK-A', 'TASK-B']),
  'cyclic dependencies should fall back to original order instead of corrupting the queue'
);

const ghostRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-task-direction-queue-ghost-'));
const ghostTaskRoot = path.join(ghostRepo, '.atm', 'history', 'tasks');
mkdirSync(ghostTaskRoot, { recursive: true });
const ghostQueue = createOrRefreshTaskQueue({
  cwd: ghostRepo,
  sourcePrompt: 'ghost closed task regression',
  tasks: [
    task({ workItemId: 'TASK-GHOST-0001', title: 'current' }),
    task({ workItemId: 'TASK-GHOST-0002', title: 'closed ghost' }),
    task({ workItemId: 'TASK-GHOST-0003', title: 'next real task' })
  ],
  taskIds: ['TASK-GHOST-0001', 'TASK-GHOST-0002', 'TASK-GHOST-0003'],
  batchId: 'batch-ghost'
});
writeFileSync(
  path.join(ghostTaskRoot, 'TASK-GHOST-0002.json'),
  `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-GHOST-0002',
    status: 'blocked',
    closedAt: '2026-07-17T05:11:07.307Z',
    closedByActor: 'codex-atm-gov-0156',
    closeReason: 'Superseded by canonical ATM-GOV-0155 after planning card rename.'
  }, null, 2)}\n`,
  'utf8'
);
const advancedPastGhost = advanceTaskQueueHead(ghostRepo, 'TASK-GHOST-0001', { batchId: ghostQueue.batchId });
assert(advancedPastGhost?.currentIndex === 2, 'queue advance should skip ledger-closed ghost tasks');
assert(advancedPastGhost?.taskIds[advancedPastGhost.currentIndex] === 'TASK-GHOST-0003', 'queue head should land on the next real task after a closed ghost');
const terminalOnlyQueue = createOrRefreshTaskQueue({
  cwd: ghostRepo,
  sourcePrompt: 'terminal-only ghost queue regression',
  tasks: [
    task({ workItemId: 'TASK-GHOST-0002', title: 'closed ghost' })
  ],
  taskIds: ['TASK-GHOST-0002'],
  batchId: 'batch-terminal-only'
});
assert(terminalOnlyQueue.status === 'completed', 'new queues containing only terminal ledger tasks should be completed immediately');
assert(findActiveTaskQueue(ghostRepo, null, { batchId: 'batch-terminal-only' }) === null, 'terminal-only ghost queues must not remain active');
const terminalOnlyBatch = writeBatchRun({
  cwd: ghostRepo,
  actorId: 'validator',
  sourcePrompt: 'terminal-only ghost batch regression',
  tasks: [task({ workItemId: 'TASK-GHOST-0002', title: 'closed ghost' })],
  queue: terminalOnlyQueue
});
assert(listActiveBatchRuns(ghostRepo).every((entry) => entry.batchId !== terminalOnlyBatch.batchId), 'terminal-only ghost batches must not remain active');
assert(readBatchRunById(ghostRepo, terminalOnlyBatch.batchId)?.status === 'completed', 'terminal-only ghost batches should be completed when normalized');

const unfinishedBlockedRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-task-direction-queue-blocked-'));
const unfinishedTaskRoot = path.join(unfinishedBlockedRepo, '.atm', 'history', 'tasks');
mkdirSync(unfinishedTaskRoot, { recursive: true });
writeFileSync(
  path.join(unfinishedTaskRoot, 'TASK-BLOCKED-0002.json'),
  `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-BLOCKED-0002',
    status: 'blocked'
  }, null, 2)}\n`,
  'utf8'
);
const unfinishedQueue = createOrRefreshTaskQueue({
  cwd: unfinishedBlockedRepo,
  sourcePrompt: 'unfinished blocked task regression',
  tasks: [
    task({ workItemId: 'TASK-BLOCKED-0001', title: 'current' }),
    task({ workItemId: 'TASK-BLOCKED-0002', title: 'blocked but not closed' }),
    task({ workItemId: 'TASK-BLOCKED-0003', title: 'later task' })
  ],
  taskIds: ['TASK-BLOCKED-0001', 'TASK-BLOCKED-0002', 'TASK-BLOCKED-0003'],
  batchId: 'batch-blocked'
});
const advancedToBlocked = advanceTaskQueueHead(unfinishedBlockedRepo, 'TASK-BLOCKED-0001', { batchId: unfinishedQueue.batchId });
assert(advancedToBlocked?.currentIndex === 1, 'queue advance must not skip genuinely unfinished blocked tasks');

console.log('[task-direction-queue.test] ok');
